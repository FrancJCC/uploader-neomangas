const fs = require('fs-extra');
const path = require('path');
const { PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const s3Client = require('../config/s3');
const env = require('../config/env');
const { getActiveBucket, setActiveBucket, BUCKETS } = require('../config/storage'); // Multi-bucket
const Manga = require('../models/Manga');
const Chapter = require('../models/Chapter');
const logger = require('../utils/logger'); // New Logger
const colors = require('colors');
const prompter = require('../utils/prompter'); // Wrapper para Inquirer/Socket
const mongoose = require('mongoose');

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Cache for approved folders to avoid repeated prompts in the same session
const approvedFolders = new Set();

// Helper to get next bucket
function getNextBucket(currentBucket) {
    if (currentBucket.id === 'PRIMARY') return BUCKETS.SECONDARY;
    if (currentBucket.id === 'SECONDARY') return BUCKETS.TERTIARY;
    return null; // No more buckets
}

// Escape regex special characters
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function checkFolderExists(client, bucketName, folderPath) {
    // If we already approved this folder in this session, return true
    if (approvedFolders.has(`${bucketName}:${folderPath}`)) return true;

    try {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: `${folderPath}/`,
            MaxKeys: 1
        });
        const result = await client.send(command);
        return result.Contents && result.Contents.length > 0;
    } catch (error) {
        // Handle Access Denied: Warn but return FALSE to trigger user prompt
        if (error.name === 'AccessDenied' || error.$metadata?.httpStatusCode === 403 || error.message.includes('Access Denied')) {
            logger.warn(`⚠️ No se pudo verificar la carpeta (Acceso Denegado). Se requerirá confirmación manual.`.yellow);
            return false;
        }
        logger.warn(`⚠️ Error checking folder existence: ${error.message}`);
        return false; 
    }
}

async function uploadFileToS3(filePath, key, client, bucketConfig) {
    const fileContent = fs.createReadStream(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    if (ext === '.webp') contentType = 'image/webp';

    try {
        const upload = new Upload({
            client: client,
            params: {
                Bucket: bucketConfig.name,
                Key: key,
                Body: fileContent,
                ContentType: contentType
            }
        });

        await upload.done();
        // Use configured Public URL (Worker) or fallback to active bucket endpoint
        const baseUrl = env.S3.PUBLIC_URL || `https://${bucketConfig.name}.${bucketConfig.endpoint}`;
        return `${baseUrl}/${key}`;
    } catch (error) {
        logger.error(`❌ Error uploading ${key}: ${error.message}`);
        throw error;
    }
}

async function processChapter(manga, chapterPath, chapterNum, options = {}) {
    const { force = false } = options;
    
    // 1. Check DB
    let chapter = await Chapter.findOne({ seriesId: manga._id, number: chapterNum });
    
    if (chapter && chapter.pages && chapter.pages.length > 0 && !force) {
        logger.warn(`⚠️ El capítulo ${chapterNum} ya existe en la base de datos con ${chapter.pages.length} páginas.`.yellow);
        
        const shouldOverwrite = await prompter.confirm(
            `El capítulo ${chapterNum} ya existe. ¿Desea sobrescribirlo?`,
            false
        );

        if (!shouldOverwrite) {
            return { status: 'skipped', reason: 'exists', updated: false };
        }
        
        logger.info(`🔄 Sobrescribiendo capítulo ${chapterNum}...`.cyan);
    }

    // 2. Read Local Files
    const files = await fs.readdir(chapterPath);
    const imageFiles = files
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .sort(naturalSort);

    if (imageFiles.length === 0) {
        return { status: 'skipped', reason: 'empty_local', updated: false };
    }

    logger.info(`   ⬆️ Subiendo Capítulo ${chapterNum} (${imageFiles.length} págs)...`.white);

    // 3. Configure Target Bucket & Client
    let targetBucketConfig = getActiveBucket();
    let client = s3Client.createS3Client(targetBucketConfig);
    const safeTitle = manga.folderPath;

    if (!safeTitle) {
        throw new Error(`CRITICAL: manga.folderPath is missing for ${manga.title}. Cannot upload.`);
    }

    const safeChapter = `Capitulo ${chapterNum}`;

    logger.info(`      📍 Destino: ${targetBucketConfig.name} | Ruta: ${safeTitle}/${safeChapter}/`.gray);

    // 4. Check Folder Existence (Safety Check)
    let folderExists = await checkFolderExists(client, targetBucketConfig.name, safeTitle);
    
    if (folderExists) {
             // Folder exists, all good
        } else if (!approvedFolders.has(`${targetBucketConfig.name}:${safeTitle}`)) {
            logger.warn(`\n⚠️ La carpeta NO se detectó en el bucket: ${targetBucketConfig.name}`.yellow);
            logger.warn(`   Ruta buscada: ${safeTitle}/`.yellow);
            
            const confirm = await prompter.confirm(
                `¿Desea CREAR (o usar si ya existe) esta carpeta en el bucket '${targetBucketConfig.name}'?`,
                false
            );
            
            if (!confirm) {
                logger.error('❌ Subida cancelada por el usuario.'.red);
                throw new Error('Subida cancelada por el usuario.');
            }
            approvedFolders.add(`${targetBucketConfig.name}:${safeTitle}`);
        }

    // 5. Upload to S3
    const uploadedUrls = [];
    const concurrencyLimit = 3; // Reduced for RAM safety

    for (let i = 0; i < imageFiles.length; i += concurrencyLimit) {
        const batch = imageFiles.slice(i, i + concurrencyLimit);
        let batchSuccess = false;

        while (!batchSuccess) {
            // Process batch sequentially to ensure memory release
            const batchResults = await Promise.allSettled(batch.map(async (filename) => {
                const fullPath = path.join(chapterPath, filename);
                const safeFilename = filename.replace(/[^a-zA-Z0-9\-_.]/g, '');
                const key = `${safeTitle}/${safeChapter}/${safeFilename}`;
                
                // Retry logic
                let retries = 3;
                while (retries > 0) {
                    try {
                        return await uploadFileToS3(fullPath, key, client, targetBucketConfig);
                    } catch (err) {
                        // Check for storage cap exceeded immediately
                        if (err.message && (err.message.includes('storage cap exceeded') || err.message.includes('CapExceeded'))) {
                            throw err; // Stop retrying, escalate to failover
                        }
                        retries--;
                        if (retries === 0) throw err;
                        await new Promise(res => setTimeout(res, 2000)); // Wait 2s
                        logger.warn(`      ⚠️ Reintentando subida: ${filename}`);
                    }
                }
            }));

            // Check for critical errors (Storage Cap)
            const capExceededError = batchResults.find(r => 
                r.status === 'rejected' && 
                r.reason && 
                (r.reason.message.includes('storage cap exceeded') || r.reason.message.includes('CapExceeded'))
            );

            if (capExceededError) {
                const nextBucket = getNextBucket(targetBucketConfig);
                
                if (!nextBucket) {
                    logger.error('❌ Todos los buckets están llenos o no configurados.'.red);
                    throw new Error('Storage cap exceeded on all buckets.');
                }

                logger.warn(`\n⚠️ ALERTA: Límite de almacenamiento excedido en ${targetBucketConfig.name}`.yellow);
                logger.warn(`   Error: ${capExceededError.reason.message}`.gray);

                const confirmSwitch = await prompter.confirm(
                    `¿Desea cambiar al siguiente bucket (${nextBucket.name}) y continuar la subida?`,
                    true
                );

                if (confirmSwitch) {
                    logger.info(`🔄 Cambiando a bucket: ${nextBucket.name}`.cyan);
                    
                    // Switch Config GLOBALLY for future chapters
                    setActiveBucket(nextBucket);

                    // Switch Config locally for retry
                    targetBucketConfig = nextBucket;
                    client = s3Client.createS3Client(targetBucketConfig);

                    // Verify Folder in New Bucket
                    const folderExistsNew = await checkFolderExists(client, targetBucketConfig.name, safeTitle);
                    if (!folderExistsNew && !approvedFolders.has(`${targetBucketConfig.name}:${safeTitle}`)) {
                        const confirmCreate = await prompter.confirm(
                            `La carpeta no existe en ${nextBucket.name}. ¿Crearla/Usarla?`,
                            true
                        );
                        
                        if (confirmCreate) {
                            approvedFolders.add(`${targetBucketConfig.name}:${safeTitle}`);
                        } else {
                            throw new Error('Cambio de bucket cancelado por falta de carpeta.');
                        }
                    }

                    // Retry the SAME batch with the new bucket
                    logger.info(`   Reintentando lote actual en ${targetBucketConfig.name}...`.white);
                    continue; 
                } else {
                    throw new Error('Subida cancelada por límite de almacenamiento.');
                }
            }

            // Handle normal results (Success or Non-Critical Errors)
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    uploadedUrls.push(result.value);
                } else {
                    logger.error(`      ❌ Falló archivo: ${result.reason}`);
                }
            }

            batchSuccess = true; // Exit while loop
        }
        
        if (global.gc) global.gc(); // Optional: Force GC if available
    }

    if (uploadedUrls.length === 0) {
        return { status: 'failed', reason: 'no_files_uploaded', updated: false };
    }

    // 6. Update DB
    if (chapter) {
        chapter.pages = uploadedUrls;
        chapter.updatedAt = new Date(); // Update chapter timestamp
        await chapter.save();
    } else {
        chapter = new Chapter({
            seriesId: manga._id,
            number: chapterNum,
            title: `Capítulo ${chapterNum}`,
            pages: uploadedUrls,
            releaseDate: new Date()
        });
        await chapter.save();
    }

    return { status: 'uploaded', pages: uploadedUrls.length, updated: true };
}

async function uploadSeries(titleOrId, options = {}) {
    logger.info(`🔍 Buscando serie: ${titleOrId}`.cyan);

    // 1. Find Manga
    let manga;
    if (mongoose.isValidObjectId(titleOrId)) {
        manga = await Manga.findById(titleOrId);
    }
    
    // If not found by ID or input is not ID, try by title (case insensitive)
    if (!manga) {
        const regex = new RegExp(`^${escapeRegExp(titleOrId)}$`, 'i');
        manga = await Manga.findOne({ title: regex });
    }

    if (!manga) {
        throw new Error(`Serie no encontrada en BD: ${titleOrId}`);
    }

    logger.info(`✅ Serie encontrada: ${manga.title} (ID: ${manga._id})`.green);
    
    // Determine Folder Name (Title or ID)
    const contentDir = env.CONTENT_DIR;
    const entries = await fs.readdir(contentDir);
    
    // Try to find exact folder match first (case insensitive)
    let seriesFolder = entries.find(e => e.toLowerCase() === manga.title.toLowerCase());
    
    // If not found, try to find by ID (if stored that way) or use titleOrId if it was the folder name
    if (!seriesFolder) {
        seriesFolder = entries.find(e => e.toLowerCase() === titleOrId.toLowerCase());
    }

    if (!seriesFolder) {
         // Fallback: check if manga.folderPath exists
         if (manga.folderPath && entries.includes(manga.folderPath)) {
             seriesFolder = manga.folderPath;
         }
    }

    if (!seriesFolder) {
        throw new Error(`Carpeta local no encontrada para: ${manga.title}`);
    }

    const seriesPath = path.join(contentDir, seriesFolder);
    logger.info(`📂 Directorio local: ${seriesPath}`.gray);

    // Update manga folderPath ONLY if missing (Respect existing S3 paths/IDs)
    if (!manga.folderPath) {
        manga.folderPath = seriesFolder;
        await manga.save();
    }

    // 2. Scan Chapters
    const chapterEntries = await fs.readdir(seriesPath);
    const chaptersToProcess = [];
    
    for (const entry of chapterEntries) {
        const entryPath = path.join(seriesPath, entry);
        if (!(await fs.stat(entryPath)).isDirectory()) continue;

        // Parse number
        const match = entry.match(/(\d+(\.\d+)?)/);
        if (match) {
            const num = parseFloat(match[0]);
            chaptersToProcess.push({
                num,
                path: entryPath,
                name: entry
            });
        }
    }

    // Sort by number
    chaptersToProcess.sort((a, b) => a.num - b.num);

    logger.info(`📚 Capítulos encontrados: ${chaptersToProcess.length}`.cyan);

    let updatedCount = 0;
    let anyUpdated = false;

    // 3. Process Each Chapter
    for (const chap of chaptersToProcess) {
        try {
            const result = await processChapter(manga, chap.path, chap.num, options);
            if (result.status === 'uploaded') {
                updatedCount++;
                anyUpdated = true;
                logger.info(`   ✅ Capítulo ${chap.num} subido exitosamente`.green);
            } else if (result.status === 'skipped') {
                logger.info(`   ⏭️ Capítulo ${chap.num} omitido (${result.reason})`.gray);
            }
        } catch (err) {
            logger.error(`   ❌ Error en Capítulo ${chap.num}: ${err.message}`.red);
        }
    }

    // Update timestamp if any chapter was uploaded
    if (anyUpdated) {
        await Manga.findByIdAndUpdate(manga._id, { updatedAt: new Date() });
        logger.info(`   📅 Serie actualizada: ${manga.title} (Timestamp renovado)`.green);
    }

    return { total: chaptersToProcess.length, uploaded: updatedCount };
}

module.exports = {
    processChapter,
    uploadSeries,
    escapeRegExp
};
