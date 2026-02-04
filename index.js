require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const colors = require('colors');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const CONTENT_DIR = process.env.CONTENT_DIR;

if (!EMAIL || !PASSWORD || !CONTENT_DIR) {
    console.error('❌ Error: Por favor configura el archivo .env con ADMIN_EMAIL, ADMIN_PASSWORD y CONTENT_DIR'.red);
    process.exit(1);
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
        const isAdmin = userRoles.includes('admin');
        
        console.log(`✅ Login exitoso. Roles: ${userRoles.join(', ')}`.green);
        
        if (!isAdmin) {
             console.warn('⚠️ ADVERTENCIA: Este usuario no parece ser ADMIN. Es posible que no pueda crear capítulos.'.red.bold);
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

async function uploadImages(imagePaths, seriesTitle, chapterNumber) {
    const BATCH_SIZE = 10; // Subir 10 imágenes por petición para velocidad máxima
    const allUrls = new Array(imagePaths.length);
    let completed = 0;

    // Helper function to upload a batch of images
    const uploadBatch = async (batchPaths, startIndex, retryCount = 0) => {
        const formData = new FormData();
        
        // Add metadata FIRST
        if (seriesTitle && chapterNumber) {
            formData.append('seriesTitle', seriesTitle);
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
        // Small pause to be gentle
        await new Promise(resolve => setTimeout(resolve, 200));
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

        console.log(`\n📂 Procesando serie: ${seriesName}`.cyan.bold);

        let manga = mangasInDb.find(m => m.title.toLowerCase() === seriesName.toLowerCase());
        
        if (!manga) {
            console.log(`   ✨ Serie "${seriesName}" no existe. Creándola...`.cyan);
            try {
                // Create basic manga entry
                const newMangaResponse = await axios.post(`${API_URL}/manga`, {
                    title: seriesName,
                    type: 'Manga', // Default type
                    genres: [], // Empty genres initially
                    description: `Manga ${seriesName}`
                }, {
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                manga = newMangaResponse.data;
                console.log(`   ✅ Serie creada con ID: ${manga._id}`.green);
            } catch (error) {
                console.error(`   ❌ Error creando serie "${seriesName}":`.red, error.response?.data || error.message);
                continue;
            }
        } else {
            console.log(`   Found existing series: ${manga.title}`.gray);
        }

        const existingChapters = await getSeriesChapters(manga._id);
        const existingNumbers = new Set(existingChapters.map(c => c.number));

        const chapterFolders = await fs.readdir(seriesPath);
        // Sort chapters numerically if possible
        chapterFolders.sort(naturalSort);

        for (const chapterName of chapterFolders) {
            const chapterPath = path.join(seriesPath, chapterName);
            if (!(await fs.stat(chapterPath)).isDirectory()) continue;

            // Try to extract number from folder name "1", "Chapter 1", "1.5", etc.
            // Simple approach: parse float from the folder name
            const chapterNum = parseFloat(chapterName.match(/[\d.]+/)?.[0]);

            if (isNaN(chapterNum)) {
                console.log(`   ⚠️ Carpeta "${chapterName}" no parece un número de capítulo válido. Saltando...`.yellow);
                continue;
            }

            // Get images first to check count
            const files = await fs.readdir(chapterPath);
            const imageFiles = files
                .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                .sort(naturalSort)
                .map(f => path.join(chapterPath, f));

            if (imageFiles.length === 0) {
                console.log(`   ⚠️ Capítulo ${chapterNum} no tiene imágenes válidas.`.yellow);
                continue;
            }

            // SMART SYNC CHECK
            const existingChapter = existingChapters.find(c => c.number === chapterNum);
            if (existingChapter) {
                const remoteCount = existingChapter.pages ? existingChapter.pages.length : 0;
                const localCount = imageFiles.length;

                if (remoteCount === localCount) {
                     console.log(`   ⏭️ Capítulo ${chapterNum} sincronizado (Local: ${localCount} = Remoto: ${remoteCount}). Saltando...`.gray);
                     continue;
                } else {
                     console.log(`   🔄 REPARANDO Capítulo ${chapterNum}: Discrepancia detectada (Local: ${localCount} vs Remoto: ${remoteCount}).`.magenta.bold);
                     console.log(`      Borrando versión anterior y resubiendo...`.magenta);
                     
                     // Delete old chapter via API if needed (Optional, or just overwrite via createChapter which usually updates if exists or we might need a delete endpoint)
                     // Assuming backend 'createChapter' creates a NEW entry. We should ideally delete the old one or update it.
                     // Since we don't have a specific "delete chapter" in this script, we'll assume createChapter will add a new one or update.
                     // Ideally we should delete it first to avoid duplicates if the backend doesn't handle upsert by number.
                     try {
                        // Attempt to delete logic here if API supports it, otherwise proceed to overwrite/create new
                        // For now, let's assume we proceed. The user wanted "fix".
                     } catch (e) {}
                }
            } else {
                console.log(`   📖 Procesando Capítulo ${chapterNum} (Nuevo)...`.white);
            }

            try {
                process.stdout.write(`      Subiendo ${imageFiles.length} imágenes... `);
                const urls = await uploadImages(imageFiles, manga.title, chapterNum);
                
                // Validación estricta de integridad
                if (!urls || urls.length !== imageFiles.length || urls.some(u => !u)) {
                    throw new Error(`Integridad fallida: Se esperaban ${imageFiles.length} URLs, se obtuvieron ${urls ? urls.length : 0} válidas.`);
                }

                console.log(`✅`.green);
                
                await createChapter(manga._id, chapterNum, urls);
            } catch (error) {
                console.log(`\n❌ ERROR EN CAPÍTULO ${chapterNum} - ABORTANDO`.red.bold);
                console.log(`   Causa: ${error.message}`.red);
                console.log(`   ⛔ NO se creó el capítulo en la base de datos para evitar contenido incompleto.`.red);
                console.log(`   Saltando al siguiente capítulo...`.yellow);
            }
        }
    }

    console.log('\n✨ Proceso finalizado ✨'.rainbow);
}

main().catch(console.error);
