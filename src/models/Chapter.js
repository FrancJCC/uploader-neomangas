const mongoose = require('mongoose');

const ChapterSchema = new mongoose.Schema({
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: 'Manga', required: true },
    number: { type: Number, required: true },
    title: String,
    volumeNumber: Number,
    language: String,
    pages: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
    releaseDate: Date
}, { timestamps: true });

module.exports = mongoose.model('Chapter', ChapterSchema);