const { verifySeries } = require('./verify.service');
const { processChapter } = require('./upload.service');
const path = require('path');
const env = require('../config/env');
const fs = require('fs-extra');
const logger = require('../utils/logger');

async function repairSeries(seriesName) {
    // 1. Run Verification
    const result = await verifySeries(seriesName);
    if (!result || !result.manga) return;

    const { manga } = result;
    const seriesPath = path.join(env.CONTENT_DIR, seriesName);
    
    logger.title(`🔧 Iniciando Reparación para: ${manga.title}`);

    const chapterFolders = await fs.readdir(seriesPath);
    
    for (const chapterName of chapterFolders) {
        const chapterPath = path.join(seriesPath, chapterName);
        if (!(await fs.stat(chapterPath)).isDirectory()) continue;
        const chapterNum = parseFloat(chapterName.match(/[\d.]+/)?.[0]);
        if (isNaN(chapterNum)) continue;

        // Re-run specific checks
        const chapter = await require('../models/Chapter').findOne({ seriesId: manga._id, number: chapterNum });
        
        let needsRepair = false;
        if (!chapter) needsRepair = true;
        else if (!chapter.pages || chapter.pages.length === 0) needsRepair = true;

        if (needsRepair) {
            logger.info(`   🔨 Reparando Cap ${chapterNum}...`);
            try {
                await processChapter(manga, chapterPath, chapterNum, { force: true });
            } catch (e) {
                logger.error(`   ❌ Falló reparación Cap ${chapterNum}: ${e.message}`);
            }
        }
    }
}

module.exports = { repairSeries };
