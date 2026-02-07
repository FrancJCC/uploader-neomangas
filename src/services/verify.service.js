const Manga = require('../models/Manga');
const Chapter = require('../models/Chapter');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const env = require('../config/env');

async function verifySeries(seriesName) {
    const seriesPath = path.join(env.CONTENT_DIR, seriesName);
    if (!(await fs.stat(seriesPath)).isDirectory()) return;

    logger.title(`🔍 Verificando: ${seriesName}`);

    let manga = null;
    if (require('mongoose').Types.ObjectId.isValid(seriesName)) {
        manga = await Manga.findById(seriesName);
    }
    // Escape regex special characters
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (!manga) {
        manga = await Manga.findOne({ 
            $or: [
                { title: new RegExp(`^${escapeRegExp(seriesName)}$`, 'i') },
                { folderPath: seriesName }
            ]
        });
    }

    if (!manga) {
        logger.error(`   ❌ No existe en BD`);
        return;
    }

    const chapterFolders = await fs.readdir(seriesPath);
    let missingInDb = 0;
    let emptyInDb = 0;
    let ok = 0;

    for (const chapterName of chapterFolders) {
        const chapterPath = path.join(seriesPath, chapterName);
        if (!(await fs.stat(chapterPath)).isDirectory()) continue;
        const chapterNum = parseFloat(chapterName.match(/[\d.]+/)?.[0]);
        if (isNaN(chapterNum)) continue;

        const chapter = await Chapter.findOne({ seriesId: manga._id, number: chapterNum });

        if (!chapter) {
            logger.warn(`   ⚠️ Cap ${chapterNum}: Falta en BD`);
            missingInDb++;
        } else if (!chapter.pages || chapter.pages.length === 0) {
            logger.warn(`   ⚠️ Cap ${chapterNum}: Existe pero SIN PÁGINAS`);
            emptyInDb++;
        } else {
            // Optional: Verify S3 links (too slow for quick check)
            ok++;
        }
    }

    logger.info(`   Resumen: OK: ${ok} | Faltan: ${missingInDb} | Vacíos: ${emptyInDb}`);
    return { ok, missingInDb, emptyInDb, manga };
}

module.exports = { verifySeries };
