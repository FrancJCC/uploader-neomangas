const Manga = require('../models/Manga');
const { Upload } = require('@aws-sdk/lib-storage');
const s3Client = require('../config/s3');
const env = require('../config/env');
const { getActiveBucket } = require('../config/storage');
const path = require('path');
const fs = require('fs-extra');

/**
 * Uploads a cover image to S3 for a specific series.
 */
async function uploadCover(folderPath, file) {
    const bucketConfig = getActiveBucket();
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `${folderPath}/cover${ext}`;
    
    try {
        const upload = new Upload({
            client: s3Client,
            params: {
                Bucket: bucketConfig.name,
                Key: key,
                Body: fs.createReadStream(file.path),
                ContentType: file.mimetype
            }
        });

        await upload.done();
        const baseUrl = env.S3.PUBLIC_URL || `https://${bucketConfig.name}.${bucketConfig.endpoint}`;
        return `${baseUrl}/${key}`;
    } catch (error) {
        throw new Error(`Error subiendo portada a S3: ${error.message}`);
    } finally {
        // Clean up temp file
        if (file.path) await fs.remove(file.path);
    }
}

/**
 * Creates a new series in the database.
 */
async function createSeries(data, coverFile) {
    const { 
        title, 
        author, 
        description, 
        status, 
        releaseYear, 
        type, 
        genres, 
        coverUrl: providedCoverUrl 
    } = data;

    // Generate folderPath (slug)
    const folderPath = title.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // Check if series already exists
    const existing = await Manga.findOne({ folderPath });
    if (existing) {
        throw new Error(`La serie con el ID "${folderPath}" ya existe.`);
    }

    let coverUrl = providedCoverUrl;

    // Handle File Upload if provided
    if (coverFile) {
        coverUrl = await uploadCover(folderPath, coverFile);
    }

    const newManga = new Manga({
        title,
        author,
        description,
        coverUrl,
        status,
        releaseYear: parseInt(releaseYear),
        type,
        folderPath,
        genres: Array.isArray(genres) ? genres : (genres ? genres.split(',').map(g => g.trim()) : [])
    });

    return await newManga.save();
}

/**
 * Gets all unique genres from the database.
 */
async function getAllGenres() {
    return await Manga.distinct('genres');
}

module.exports = {
    createSeries,
    getAllGenres
};
