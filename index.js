require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const colors = require('colors');
const inquirer = require('inquirer');

// Variables globales de configuración
let API_URL = process.env.API_URL || 'http://localhost:3000';
let EMAIL = process.env.ADMIN_EMAIL;
let PASSWORD = process.env.ADMIN_PASSWORD;
let CONTENT_DIR = process.env.CONTENT_DIR;

async function getConfig() {
    // Si ya tenemos todo por variables de entorno, procedemos
    if (EMAIL && PASSWORD && CONTENT_DIR) {
        return;
    }

    console.log('\n📝 Configuración Interactiva (No se detectaron variables de entorno completas)'.cyan.bold);
    
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'API_URL',
            message: 'URL del Backend:',
            default: API_URL
        },
        {
            type: 'input',
            name: 'ADMIN_EMAIL',
            message: 'Email de Administrador:',
            default: EMAIL,
            validate: input => input ? true : 'El email es requerido'
        },
        {
            type: 'password',
            name: 'ADMIN_PASSWORD',
            message: 'Contraseña:',
            mask: '*',
            validate: input => input ? true : 'La contraseña es requerida'
        },
        {
            type: 'input',
            name: 'CONTENT_DIR',
            message: 'Directorio de Mangas (Carpeta donde están las series):',
            default: CONTENT_DIR || 'E:\\NeoManga\\downloader\\downloads',
            validate: async (input) => {
                if (!input) return 'El directorio es requerido';
                // Opcional: validar si existe, pero tal vez el usuario quiera crearlo o corregirlo después
                return true;
            }
        }
    ]);

    API_URL = answers.API_URL;
    EMAIL = answers.ADMIN_EMAIL;
    PASSWORD = answers.ADMIN_PASSWORD;
    CONTENT_DIR = answers.CONTENT_DIR;
    
    console.log('✅ Configuración cargada correctamente.\n'.green);
}

let authToken = null;

async function login() {
    try {
        console.log('🔐 Iniciando sesión...'.yellow);
        const response = await axios.post(`${API_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });
        authToken = response.data.accessToken;
        const user = response.data.user || {}; 
        const userRoles = user.roles || [];
        // Permitir admin, owner o editor
        const hasPermission = userRoles.some(role => ['admin', 'owner', 'editor'].includes(role));
        
        console.log(`✅ Login exitoso. Roles: ${userRoles.join(', ')}`.green);
        
        if (!hasPermission) {
             console.warn('⚠️ ADVERTENCIA: Este usuario no tiene permisos suficientes (Owner, Admin o Editor). Es probable que falle la subida.'.red.bold);
        }
    } catch (error) {
        console.error('❌ Error en login:'.red, error.response?.data || error.message);
        process.exit(1);
    }
}

async function getMangas() {
    try {
        const response = await axios.get(`${API_URL}/manga`);
        return response.data;
    } catch (error) {
        console.error('❌ Error obteniendo mangas:'.red, error.message);
        return [];
    }
}

async function getSeriesChapters(seriesId) {
    try {
        const response = await axios.get(`${API_URL}/chapters/series/${seriesId}`);
        return response.data;
    } catch (error) {
        return [];
    }
}

const https = require('https');

// Configurar agente HTTPS para mejor manejo de conexiones
const httpsAgent = new https.Agent({ 
    keepAlive: true,
    maxSockets: 1,
    keepAliveMsecs: 10000 
});

async function uploadImages(imagePaths, seriesTitle, chapterNumber, mangaId) {
    const BATCH_SIZE = 5; // Reducido de 10 a 5 para evitar sobrecarga
    const allUrls = new Array(imagePaths.length);
    let completed = 0;

    // Helper function to upload a batch of images
    const uploadBatch = async (batchPaths, startIndex, retryCount = 0) => {
        const formData = new FormData();
        
        // Add metadata FIRST
        if (mangaId) {
            formData.append('mangaId', mangaId);
        }
        if (seriesTitle) {
            formData.append('seriesTitle', seriesTitle);
        }
        if (chapterNumber) {
            formData.append('chapterNumber', chapterNumber.toString());
        }

        // Append all files in this batch
        for (const imgPath of batchPaths) {
             const fileStream = fs.createReadStream(imgPath);
             fileStream.on('error', (err) => console.error(`Error leyendo ${path.basename(imgPath)}`.red));
             formData.append('files', fileStream);
        }
        
        try {
            const headers = formData.getHeaders();
            const response = await axios.post(`${API_URL}/upload/chapter-images`, formData, {
                headers: {
                    ...headers,
                    'Authorization': `Bearer ${authToken}`,
                    'User-Agent': 'Mozilla/5.0 (NodeJS Uploader)'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 300000, // 5 minutos para lotes grandes
                httpsAgent: httpsAgent
            });
            
            // Map results back to allUrls array
            // The backend preserves order of files in the request
            const urls = response.data.urls;
            if (!urls || urls.length !== batchPaths.length) {
                throw new Error(`Mismatch en respuesta de lote: Enviadas ${batchPaths.length}, Recibidas ${urls?.length}`);
            }

            for (let i = 0; i < urls.length; i++) {
                allUrls[startIndex + i] = urls[i];
            }

            completed += batchPaths.length;
            process.stdout.write(`\r      Subiendo imágenes: ${completed}/${imagePaths.length} completadas... `);
        } catch (error) {
            const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT';
            
            if (retryCount < 3) {
                const waitTime = (retryCount + 1) * 3000;
                console.log(`\n      ⚠️ Error en lote (${error.message}). Reintentando en ${waitTime/1000}s...`.yellow);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return uploadBatch(batchPaths, startIndex, retryCount + 1);
            }
            throw error;
        }
    };

    // Process in batches
    for (let i = 0; i < imagePaths.length; i += BATCH_SIZE) {
        const batch = imagePaths.slice(i, i + BATCH_SIZE);
        await uploadBatch(batch, i);
        // Aumentar pausa entre lotes para dar respiro al backend
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log(''); // New line
    return allUrls;
}

async function createChapter(seriesId, chapterNumber, pages) {
    try {
        console.log(`   ⏳ Creando entrada de capítulo ${chapterNumber} en base de datos...`.cyan);
        const response = await axios.post(`${API_URL}/chapters`, {
            seriesId,
            number: parseFloat(chapterNumber),
            title: `Capítulo ${chapterNumber}`,
            pages
        }, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        // 🔍 VERIFICACIÓN DE SUBIDA
        const createdChapter = response.data;
        
        // Si la respuesta incluye las páginas, verificamos directamente
        if (createdChapter && Array.isArray(createdChapter.pages)) {
            if (createdChapter.pages.length === pages.length) {
                console.log(`   ✅ Capítulo ${chapterNumber} creado y verificado correctamente.`.green.bold);
                console.log(`      📄 Páginas esperadas: ${pages.length} | Páginas en servidor: ${createdChapter.pages.length}`.green);
            } else {
                console.warn(`   ⚠️ ADVERTENCIA: El capítulo se creó pero hay discrepancia de páginas.`.yellow.bold);
                console.warn(`      Esperadas: ${pages.length} | Recibidas: ${createdChapter.pages.length}`.yellow);
            }
        } else {
            // Si la respuesta no tiene detalles, hacemos una doble verificación consultando el servidor
            console.log(`   🔎 Realizando doble verificación con el servidor...`.gray);
            const serverChapters = await getSeriesChapters(seriesId);
            const foundChapter = serverChapters.find(c => c.number === parseFloat(chapterNumber));

            if (foundChapter) {
                if (foundChapter.pages && foundChapter.pages.length === pages.length) {
                    console.log(`   ✅ Doble verificación exitosa: Capítulo ${chapterNumber} está online con ${foundChapter.pages.length} páginas.`.green.bold);
                } else {
                    console.error(`   ❌ ERROR CRÍTICO: El capítulo existe pero las páginas están incompletas.`.red.bold);
                    console.error(`      Subidas: ${pages.length} | En base de datos: ${foundChapter.pages ? foundChapter.pages.length : 0}`.red);
                }
            } else {
                console.error(`   ❌ ERROR CRÍTICO: El capítulo ${chapterNumber} no aparece en el listado del servidor tras crearlo.`.red.bold);
            }
        }

    } catch (error) {
        if (error.response?.status === 401) {
            console.log('   🔄 Token expirado. Renovando sesión...'.yellow);
            await login(); // Login again to get fresh token
            
            // Reintentar recursivamente para aprovechar la lógica de verificación
            return createChapter(seriesId, chapterNumber, pages);
        } else {
            console.error(`   ❌ Error creando capítulo ${chapterNumber}:`.red, error.response?.data || error.message);
        }
    }
}

// Natural sort for filenames (1.jpg, 2.jpg, 10.jpg)
const naturalSort = (a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

async function main() {
    await getConfig();
    await login();

    if (!fs.existsSync(CONTENT_DIR)) {
        console.error(`❌ El directorio ${CONTENT_DIR} no existe`.red);
        process.exit(1);
    }

    const mangasInDb = await getMangas();
    const seriesFolders = await fs.readdir(CONTENT_DIR);

    for (const seriesName of seriesFolders) {
        const seriesPath = path.join(CONTENT_DIR, seriesName);
        if (!(await fs.stat(seriesPath)).isDirectory()) continue;

        console.log(`\n📂 Procesando carpeta local: ${seriesName}`.cyan.bold);

        // 1. Intentar match exacto
        let manga = mangasInDb.find(m => m.title.toLowerCase().trim() === seriesName.toLowerCase().trim());
        let confirmed = false;

        if (manga) {
            console.log(`   ✅ Coincidencia exacta encontrada: ${manga.title}`.green);
            console.log(`      ID: ${manga._id} | Carpeta Destino: ${manga.folderPath || manga.title}`.gray);
            confirmed = true;
        } else {
            // 2. Intentar match parcial / fuzzy
            const matches = mangasInDb.filter(m => 
                m.title.toLowerCase().includes(seriesName.toLowerCase()) || 
                seriesName.toLowerCase().includes(m.title.toLowerCase())
            );

            console.log(`   ⚠️ No se encontró coincidencia exacta para "${seriesName}".`.yellow);
            
            const choices = matches.map(m => ({
                name: `Asociar con: "${m.title}" (ID: ${m._id} | Folder: ${m.folderPath || m.title})`,
                value: m
            }));
            
            choices.push(new inquirer.Separator());
            choices.push({ name: '🔍 Buscar manualmente en la lista', value: 'SEARCH' });
            choices.push({ name: `✨ Crear NUEVA serie: "${seriesName}"`, value: 'CREATE' });
            choices.push({ name: '⏭️ Saltar esta carpeta', value: 'SKIP' });

            const answer = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: '¿Qué deseas hacer?',
                choices: choices
            }]);

            if (answer.action === 'SKIP') {
                console.log('   ⏭️ Saltando...'.gray);
                continue;
            } else if (answer.action === 'CREATE') {
                try {
                    console.log(`   ✨ Creando serie "${seriesName}"...`.cyan);
                    const newMangaResponse = await axios.post(`${API_URL}/manga`, {
                        title: seriesName,
                        type: 'Manga',
                        genres: [],
                        description: `Manga ${seriesName}`
                    }, {
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });
                    manga = newMangaResponse.data;
                    console.log(`   ✅ Serie creada con ID: ${manga._id}`.green);
                    mangasInDb.push(manga); // Update local cache
                    confirmed = true;
                } catch (error) {
                    console.error(`   ❌ Error creando serie:`.red, error.response?.data || error.message);
                    continue;
                }
            } else if (answer.action === 'SEARCH') {
                const searchAnswer = await inquirer.prompt([{
                    type: 'input',
                    name: 'query',
                    message: 'Ingresa texto para buscar:'
                }]);
                
                const searchResults = mangasInDb.filter(m => m.title.toLowerCase().includes(searchAnswer.query.toLowerCase()));
                
                if (searchResults.length === 0) {
                    console.log('   ❌ No se encontraron resultados. Saltando carpeta.'.red);
                    continue;
                }

                const searchSelection = await inquirer.prompt([{
                    type: 'list',
                    name: 'manga',
                    message: 'Selecciona la serie:',
                    choices: [
                        ...searchResults.map(m => ({ name: m.title, value: m })),
                        { name: 'Cancelar', value: null }
                    ]
                }]);

                if (searchSelection.manga) {
                    manga = searchSelection.manga;
                    confirmed = true;
                } else {
                    continue;
                }
            } else {
                manga = answer.action;
                confirmed = true;
            }
        }

        if (!confirmed || !manga) continue;

        const existingChapters = await getSeriesChapters(manga._id);
        const chapterFolders = await fs.readdir(seriesPath);
        chapterFolders.sort(naturalSort);

        for (const chapterName of chapterFolders) {
            const chapterPath = path.join(seriesPath, chapterName);
            if (!(await fs.stat(chapterPath)).isDirectory()) continue;

            const chapterNum = parseFloat(chapterName.match(/[\d.]+/)?.[0]);
            if (isNaN(chapterNum)) {
                console.log(`   ⚠️ Carpeta "${chapterName}" no parece un número de capítulo válido. Saltando...`.yellow);
                continue;
            }

            const files = await fs.readdir(chapterPath);
            const imageFiles = files
                .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                .sort(naturalSort)
                .map(f => path.join(chapterPath, f));

            if (imageFiles.length === 0) {
                console.log(`   ⚠️ Capítulo ${chapterNum} no tiene imágenes válidas.`.yellow);
                continue;
            }

            const existingChapter = existingChapters.find(c => c.number === chapterNum);
            if (existingChapter) {
                 const remoteCount = existingChapter.pages ? existingChapter.pages.length : 0;
                 const localCount = imageFiles.length;
 
                 if (remoteCount === localCount) {
                      console.log(`   ⏭️ Capítulo ${chapterNum} sincronizado. Saltando...`.gray);
                      continue;
                 } else {
                      console.log(`   🔄 REPARANDO Capítulo ${chapterNum}: (Local: ${localCount} vs Remoto: ${remoteCount}).`.magenta);
                 }
            } else {
                 console.log(`   📖 Procesando Capítulo ${chapterNum} (Nuevo)...`.white);
            }

            try {
                process.stdout.write(`      Subiendo ${imageFiles.length} imágenes... `);
                // Pass manga._id to ensure correct folder path resolution in backend
                // IMPORTANT: Backend uses manga._id as the root folder name for storage
                const urls = await uploadImages(imageFiles, manga.title, chapterNum, manga._id);
                
                if (!urls || urls.length !== imageFiles.length || urls.some(u => !u)) {
                    throw new Error(`Integridad fallida: Se esperaban ${imageFiles.length} URLs, se obtuvieron ${urls ? urls.length : 0} válidas.`);
                }

                console.log(`✅`.green);
                await createChapter(manga._id, chapterNum, urls);
            } catch (error) {
                console.log(`\n❌ ERROR EN CAPÍTULO ${chapterNum} - ABORTANDO`.red.bold);
                console.log(`   Causa: ${error.message}`.red);
            }
        }
    }

    console.log('\n✨ Proceso finalizado ✨'.rainbow);
}

main().catch(console.error);
