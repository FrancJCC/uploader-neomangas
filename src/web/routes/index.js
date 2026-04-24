const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const authController = require('../controllers/auth.controller');
const configController = require('../controllers/config.controller');
const seriesController = require('../controllers/series.controller');

// Multer for temp storage during cover upload
const upload = multer({ dest: 'temp/' });

// View Route
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/index.html'));
});

// Auth Routes
router.post('/api/login', authController.login);

// Config Routes
router.get('/api/config', configController.getConfig);
router.post('/api/config/folder', configController.updateFolder);

// Series Routes
router.get('/api/series', seriesController.getSeries);
router.get('/api/genres', seriesController.getGenres);
router.post('/api/series', upload.single('cover'), seriesController.createSeries);
router.get('/api/db-series', seriesController.listDbSeries);
router.get('/api/series/:id', seriesController.getSeriesDetails);
router.put('/api/series/:id', upload.single('cover'), seriesController.updateSeries);

module.exports = router;
