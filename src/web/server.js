const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const open = require('open');
const logger = require('../utils/logger');
const { connectDB } = require('../config/database');
const routes = require('./routes');
const setupSockets = require('./sockets/events');
const socketIoLib = require('./socket-lib'); // Inlined Socket.IO Client

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Security Middleware - Completely Permissive for Local Tool
app.use((req, res, next) => {
    // Force permissive headers for ALL requests
    res.setHeader(
        "Content-Security-Policy", 
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; style-src * 'unsafe-inline';"
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
});

// JSON Body Parser
app.use(express.json());

// Serve Static Assets from src/web/public
app.use('/public', express.static(path.join(__dirname, 'public')));

// Serve Socket.IO Client Library explicitly (Fixes pkg/injection issues)
app.get('/socket-lib.js', (req, res) => {
    res.type('application/javascript');
    res.send(socketIoLib);
});

// Modular Routes
app.use(routes);

// Socket.IO Logic
setupSockets(io);

async function startServer() {
    console.log(`⏳ Iniciando servidor web (v2.8 - ${new Date().toLocaleTimeString()})...`);
    try {
        await connectDB();
        console.log('✅ Base de datos conectada');
        
        const PORT = 3459;
        server.listen(PORT, async () => {
            const url = `http://localhost:${PORT}`;
            console.log(`🚀 Web GUI running at ${url}`);
            try {
                await open(url);
                console.log('🌐 Navegador abierto automáticamente');
            } catch (err) {
                console.error('⚠️ No se pudo abrir el navegador automáticamente:', err.message);
            }
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar el servidor:', error.message);
        process.exit(1);
    }
}

module.exports = { startServer };
