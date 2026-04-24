const Manga = require('../models/Manga');
const { Upload } = require('@aws-sdk/lib-storage');
const s3Client = require('../config/s3');
const env = require('../config/env');
const { getActiveBucket } = require('../config/storage');
const path = require('path');
const fs = require('fs-extra');
const mongoose = require('mongoose');

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
        coverUrl: providedCoverUrl,
        customId // Optional ID from frontend
    } = data;

    // Use provided ID or generate a new MongoDB ObjectId
    const seriesId = customId && mongoose.Types.ObjectId.isValid(customId) 
        ? new mongoose.Types.ObjectId(customId) 
        : new mongoose.Types.ObjectId();
    
    const folderPath = seriesId.toString();

    // Check if series already exists
    const existing = await Manga.findOne({ $or: [{ _id: seriesId }, { folderPath }] });
    if (existing) {
        throw new Error(`La serie con el ID "${folderPath}" ya existe.`);
    }

    let coverUrl = providedCoverUrl;

    // Handle File Upload if provided
    if (coverFile) {
        coverUrl = await uploadCover(folderPath, coverFile);
    }

    const newManga = new Manga({
        _id: seriesId,
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
