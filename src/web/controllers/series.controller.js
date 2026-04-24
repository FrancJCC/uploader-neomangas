const Manga = require('../../models/Manga');
const fs = require('fs-extra');
const path = require('path');
const env = require('../../config/env');
const seriesService = require('../../services/series.service');

exports.getSeries = async (req, res) => {
    try {
        console.log(`[API] Leyendo directorio: ${env.CONTENT_DIR}`);
        
        // 1. Get Local Folders (Potential Titles)
        const dirs = await fs.readdir(env.CONTENT_DIR);
        const localFolders = dirs.filter(d => {
            try {
                return fs.statSync(path.join(env.CONTENT_DIR, d)).isDirectory();
            } catch (e) { return false; }
        });
        
        console.log(`[API] Carpetas locales encontradas: ${localFolders.length}`);

        // 2. Fetch ALL Mangas from DB (Title, FolderPath, ID)
        let allMangas = [];
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DB Timeout')), 3000)
            );

            allMangas = await Promise.race([
                Manga.find({}, 'title folderPath _id').lean(),
                timeoutPromise
            ]);
            
            console.log(`[API] Total series en BD: ${allMangas.length}`);
        } catch (dbErr) {
            console.error('[API] Error consultando BD (continuando solo con local):', dbErr.message);
        }

        // 3. Map Local Folders to DB Entries
        const seriesList = localFolders.map(folderName => {
            const match = allMangas.find(m => m.title.toLowerCase().trim() === folderName.toLowerCase().trim());

            if (match) {
                return {
                    id: folderName,
                    title: match.title,
                    folderPath: match.folderPath,
                    dbId: match._id,
                    match: true
                };
            } else {
                return {
                    id: folderName,
                    title: `${folderName} (⚠️ Sin coincidencia en BD)`,
                    match: false
                };
            }
        });

        seriesList.sort((a, b) => a.title.localeCompare(b.title));
        res.json(seriesList);
    } catch (error) {
        console.error('[API] Error general:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.getGenres = async (req, res) => {
    try {
        const genres = await seriesService.getAllGenres();
        res.json(genres);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createSeries = async (req, res) => {
    try {
        const result = await seriesService.createSeries(req.body, req.file);
        res.json({ success: true, manga: result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
