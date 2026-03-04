const express = require('express');
const router = express.Router();
const path = require('path');
const authController = require('../controllers/auth.controller');
const configController = require('../controllers/config.controller');
const seriesController = require('../controllers/series.controller');

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

module.exports = router;
