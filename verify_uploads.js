require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const colors = require('colors');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const CONTENT_DIR = process.env.CONTENT_DIR;

if (!EMAIL || !PASSWORD || !CONTENT_DIR) {
    console.error('❌ Error: Configura el archivo .env'.red);
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
        // Permitir admin, owner o editor
        const hasPermission = userRoles.some(role => ['admin', 'owner', 'editor'].includes(role));
        
        console.log(`✅ Login exitoso. Roles: ${userRoles.join(', ')}`.green);
        
        if (!hasPermission) {
             console.warn('⚠️ ADVERTENCIA: Este usuario no tiene permisos suficientes (Owner, Admin o Editor).'.red.bold);
        }
    } catch (error) {
        console.error('❌ Error en login:'.red, error.message);
        process.exit(1);
    }
}

async function getMangas() {
    try {
        const response = await axios.get(`${API_URL}/manga`);
        return response.data;
    } catch (error) {
        return [];
    }
}

async function getSeriesChapters(seriesId) {
    try {
        // OPTIMIZATION: No necesitamos pages para verificar existencia, solo números.
        const response = await axios.get(`${API_URL}/chapters/series/${seriesId}`);
        return response.data.map(c => c.number); // Retorna solo los números
    } catch (error) {
        return [];
    }
}

// Natural sort for filenames
const naturalSort = (a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

async function main() {
    await login();

    if (!fs.existsSync(CONTENT_DIR)) {
        console.error(`❌ Directorio ${CONTENT_DIR} no existe`.red);
        process.exit(1);
    }

    console.log(`\n🔍 ESCANEANDO CONTENIDO LOCAL vs NUBE...\n`.cyan.bold);

    const mangasInDb = await getMangas();
    const seriesFolders = await fs.readdir(CONTENT_DIR);
    let totalMissingChapters = 0;

    for (const seriesName of seriesFolders) {
        const seriesPath = path.join(CONTENT_DIR, seriesName);
        if (!(await fs.stat(seriesPath)).isDirectory()) continue;

        const manga = mangasInDb.find(m => m.title.toLowerCase() === seriesName.toLowerCase());

        if (!manga) {
            console.log(`❌ SERIE NO ENCONTRADA EN WEB: ${seriesName}`.red.bold);
            console.log(`   (Toda la serie falta por subir)`.gray);
            continue;
        }

        const remoteChapters = await getSeriesChapters(manga._id);
        const remoteSet = new Set(remoteChapters);
        
        const localChaptersFiles = await fs.readdir(seriesPath);
        const localChapters = [];

        for (const chapterName of localChaptersFiles) {
            const chapterPath = path.join(seriesPath, chapterName);
            if (!(await fs.stat(chapterPath)).isDirectory()) continue;

            // Extraer número
            const chapterNum = parseFloat(chapterName.match(/[\d.]+/)?.[0]);
            if (!isNaN(chapterNum)) {
                localChapters.push(chapterNum);
            }
        }

        localChapters.sort((a, b) => a - b);
        
        // 1. Verificar qué falta subir (Local vs Remoto)
        const missingInRemote = localChapters.filter(num => !remoteSet.has(num));

        // 2. Verificar huecos en la secuencia Remota (Discontinuidades)
        const remoteGaps = [];
        if (remoteChapters.length > 0) {
            remoteChapters.sort((a, b) => a - b);
            for (let i = 0; i < remoteChapters.length - 1; i++) {
                const current = remoteChapters[i];
                const next = remoteChapters[i+1];
                // Si la diferencia es mayor a 1, hay un hueco (ej: 1, 3 -> falta 2)
                // Ignoramos decimales complejos, asumimos saltos enteros simples como warning
                if (next - current > 1.1) { 
                     // Generar rango faltante
                     for (let j = Math.floor(current) + 1; j < Math.ceil(next); j++) {
                         remoteGaps.push(j);
                     }
                }
            }
        }

        if (missingInRemote.length > 0 || remoteGaps.length > 0) {
            console.log(`📂 ${seriesName}`.cyan.bold);
            
            if (missingInRemote.length > 0) {
                console.log(`   ⚠️  FALTAN POR SUBIR (Están en local pero no en web):`.yellow);
                console.log(`      Capítulos: ${missingInRemote.join(', ')}`.yellow.bold);
                totalMissingChapters += missingInRemote.length;
            }

            if (remoteGaps.length > 0) {
                console.log(`   ❓ HUECOS EN NUMERACIÓN WEB (Posibles faltantes no detectados en local):`.magenta);
                // Limitamos la salida de gaps por si son muchos
                const gapStr = remoteGaps.length > 20 ? remoteGaps.slice(0, 20).join(', ') + '...' : remoteGaps.join(', ');
                console.log(`      Faltan en secuencia: ${gapStr}`.magenta);
            }
            console.log(''); // Espacio
        }
    }

    console.log('---------------------------------------------------');
    if (totalMissingChapters > 0) {
        console.log(`❌ SE ENCONTRARON ${totalMissingChapters} CAPÍTULOS FALTANTES QUE DEBEN SUBIRSE.`.red.bold);
        console.log(`   Ejecuta el uploader nuevamente; saltará los que ya existen y subirá los faltantes.`.white);
    } else {
        console.log(`✅ ¡TODO PERFECTO! No se detectaron capítulos locales pendientes de subir.`.green.bold);
    }
}

main().catch(console.error);
