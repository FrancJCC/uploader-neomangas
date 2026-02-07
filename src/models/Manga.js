const mongoose = require('mongoose');

const MangaSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: String,
    description: String,
    coverUrl: String,
    status: { type: String, default: 'Ongoing' },
    releaseYear: Number,
    type: { type: String, required: true, enum: ['Manga', 'Manhwa', 'Manhua', 'Novel'] },
    folderPath: { type: String, required: true },
    genres: [String],
    views: { type: Number, default: 0 },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    ratings: [{
        userId: { type: String, required: true },
        value: { type: Number, required: true, min: 1, max: 5 },
        _id: false
    }],
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Manga', MangaSchema);