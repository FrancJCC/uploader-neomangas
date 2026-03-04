const env = require('../../config/env');
const fs = require('fs-extra');
const logger = require('../../utils/logger');

exports.getConfig = (req, res) => {
    res.json({
        contentDir: env.CONTENT_DIR
    });
};

exports.updateFolder = async (req, res) => {
    try {
        const { path: newPath } = req.body;
        if (!newPath) return res.status(400).json({ error: 'Ruta no proporcionada' });

        // Validar si la carpeta existe
        const exists = await fs.pathExists(newPath);
        if (!exists) return res.status(400).json({ error: 'La ruta no existe en el disco' });

        // Validar si es un directorio
        const stat = await fs.stat(newPath);
        if (!stat.isDirectory()) return res.status(400).json({ error: 'La ruta no es una carpeta' });

        // Actualizar en memoria
        env.updateContentDir(newPath);
        
        logger.info(`📁 [Config] Carpeta cambiada por el usuario a: ${newPath}`.cyan);
        res.json({ success: true, contentDir: env.CONTENT_DIR });
    } catch (error) {
        console.error('[CONFIG] Error:', error);
        res.status(500).json({ error: error.message });
    }
};
