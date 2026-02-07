const path = require('path');
const fs = require('fs');
const colors = require('colors');

// Intentar cargar .env desde múltiples ubicaciones
const envLocations = [
    path.join(process.cwd(), '.env'), // Junto al ejecutable
    path.join(__dirname, '../../.env'), // En desarrollo
    path.join(process.cwd(), '../.env') // Padre (si está en subcarpeta)
];

let envLoaded = false;
for (const envPath of envLocations) {
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
        envLoaded = true;
        break;
    }
}

// Fallback por defecto si no carga
if (!envLoaded) {
    require('dotenv').config();
}

// Public URL Override (Cloudflare Worker)
if (!process.env.S3_PUBLIC_URL) {
    process.env.S3_PUBLIC_URL = 'https://odd-flower-2048.francisco-jair-dc.workers.dev';
}

const requiredVars = [
    'S3_ENDPOINT',
    'S3_BUCKET'
];

const missing = requiredVars.filter(key => !process.env[key]);

if (missing.length > 0) {
    console.error('\n❌ Error Crítico: Faltan variables de entorno'.red.bold);
    console.error('Asegúrate de tener un archivo .env junto al ejecutable con:'.yellow);
    missing.forEach(key => console.error(`   - ${key}`.gray));
    
    console.log('\nPresiona ENTER para salir...'.white);
    
    // Pausa para que el usuario lea el error
    const fd = process.stdin.fd;
    const buf = Buffer.alloc(1);
    try {
        fs.readSync(fd, buf, 0, 1, null);
    } catch (e) {
        // Ignorar error de lectura si no es TTY
    }
    process.exit(1);
}

module.exports = {
    MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/neomanga',
    CONTENT_DIR: process.env.CONTENT_DIR || 'E:\\NeoManga\\downloader\\downloads',
    S3: {
        ENDPOINT: process.env.S3_ENDPOINT,
        REGION: process.env.S3_REGION || 'auto',
        BUCKET: process.env.S3_BUCKET,
        KEY: process.env.S3_ACCESS_KEY,
        SECRET: process.env.S3_SECRET_KEY,
        PUBLIC_URL: process.env.S3_PUBLIC_URL ? process.env.S3_PUBLIC_URL.replace(/\/$/, '') : '',
        
        // Multi-Bucket Config
        BUCKETS: {
            NEOMANGAS: {
                NAME: process.env.NEOMANGAS_NAME || 'NeoMangas',
                KEY: process.env.NEOMANGAS_KEY || process.env.S3_ACCESS_KEY,
                SECRET: process.env.NEOMANGAS_SECRET || process.env.S3_SECRET_KEY
            },
            NEOMANGAS2: {
                NAME: process.env.NEOMANGAS2_NAME || 'NeoMangas2',
                KEY: process.env.NEOMANGAS2_KEY || process.env.S3_ACCESS_KEY,
                SECRET: process.env.NEOMANGAS2_SECRET || process.env.S3_SECRET_KEY
            },
            NEOMANGAS3: {
                NAME: process.env.NEOMANGAS3_NAME || 'NeoMangas3',
                KEY: process.env.NEOMANGAS3_KEY || process.env.S3_ACCESS_KEY,
                SECRET: process.env.NEOMANGAS3_SECRET || process.env.S3_SECRET_KEY
            }
        }
    }
};
