const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const open = require('open');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const env = require('../config/env');
const { connectDB } = require('../config/database');
const Manga = require('../models/Manga');
const User = require('../models/User'); // User Model
const bcrypt = require('bcryptjs'); // Bcrypt
const socketIoLib = require('./socket-lib'); // Inlined Socket.IO Client

// Services
const { uploadSeries } = require('../services/upload.service');
const { verifySeries } = require('../services/verify.service');
const { repairSeries } = require('../services/repair.service');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve Socket.IO Client Library explicitly (Fixes pkg/injection issues)
app.get('/socket-lib.js', (req, res) => {
    res.type('application/javascript');
    res.send(socketIoLib);
});

// INLINED HTML CONTENT (To avoid pkg file system issues)
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeoManga Tools</title>
    <style>
        :root {
            --bg-color: #1e1e1e;
            --sidebar-color: #252526;
            --accent-color: #007acc;
            --text-color: #cccccc;
            --term-bg: #101010;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            margin: 0;
            display: flex;
            height: 100vh;
            overflow: hidden;
        }
        
        /* Login Screen */
        #login-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: var(--bg-color);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .login-box {
            background-color: var(--sidebar-color);
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            width: 300px;
            text-align: center;
        }
        .login-box h2 {
            margin-top: 0;
            color: #fff;
            margin-bottom: 20px;
        }
        .login-input {
            width: 100%;
            padding: 10px;
            margin-bottom: 15px;
            background-color: #3c3c3c;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            box-sizing: border-box;
        }
        .login-btn {
            width: 100%;
            padding: 10px;
            background-color: var(--accent-color);
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .login-btn:hover { filter: brightness(1.1); }
        .error-msg { color: #f48771; font-size: 0.9em; margin-top: 10px; display: none; }

        /* Main Layout */
        #app-layout {
            display: none; /* Hidden by default */
            width: 100%;
            height: 100%;
            display: flex;
        }
        
        /* Sidebar */
        .sidebar {
            width: 250px;
            background-color: var(--sidebar-color);
            padding: 20px;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #333;
        }
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #fff;
            margin-bottom: 30px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .nav-btn {
            background: none;
            border: none;
            color: var(--text-color);
            padding: 12px;
            text-align: left;
            cursor: pointer;
            border-radius: 5px;
            transition: 0.2s;
            margin-bottom: 5px;
        }
        .nav-btn:hover, .nav-btn.active {
            background-color: #37373d;
            color: #fff;
        }
        .nav-btn.active {
            border-left: 3px solid var(--accent-color);
        }
        .user-info {
            margin-top: auto;
            padding-top: 20px;
            border-top: 1px solid #333;
            font-size: 0.9rem;
            color: #888;
        }

        /* Main Content */
        .main {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 20px;
        }
        .header {
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        /* Controls */
        .controls {
            background-color: var(--sidebar-color);
            padding: 15px;
            border-radius: 8px;
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 20px;
        }
        select {
            background-color: #3c3c3c;
            color: white;
            padding: 8px;
            border: 1px solid #555;
            border-radius: 4px;
            flex: 1;
        }
        button {
            background-color: var(--accent-color);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        button:hover {
            filter: brightness(1.1);
        }
        button:disabled {
            background-color: #555;
            cursor: not-allowed;
        }

        /* Terminal */
        .terminal {
            flex: 1;
            background-color: var(--term-bg);
            border-radius: 8px;
            padding: 15px;
            font-family: 'Consolas', 'Courier New', monospace;
            overflow-y: auto;
            white-space: pre-wrap;
            font-size: 0.9rem;
            border: 1px solid #333;
        }
        .log-line { margin: 2px 0; }
        .log-info { color: #cccccc; }
        .log-error { color: #f48771; }
        .log-success { color: #89d185; }
        .log-warn { color: #cca700; }
        .log-title { color: #569cd6; font-weight: bold; margin-top: 10px; border-bottom: 1px solid #333; padding-bottom: 5px; }

    </style>
</head>
<body>

    <!-- LOGIN SCREEN -->
    <div id="login-screen">
        <div class="login-box">
            <h2>🔐 Iniciar Sesión</h2>
            <input type="email" id="email" class="login-input" placeholder="Correo electrónico" required>
            <input type="password" id="password" class="login-input" placeholder="Contraseña" required>
            <button class="login-btn" onclick="login()">Entrar</button>
            <div id="login-error" class="error-msg">Credenciales incorrectas</div>
        </div>
    </div>

    <!-- APP LAYOUT -->
    <div id="app-layout" style="display: none;">
        <div class="sidebar">
            <div class="logo">🚀 NeoManga</div>
            <button class="nav-btn active" onclick="setMode('upload')">☁️ Upload</button>
            <button class="nav-btn" onclick="setMode('verify')">🔍 Verificar</button>
            <button class="nav-btn" onclick="setMode('repair')">🔧 Reparar</button>
            
            <div class="user-info">
                👤 <span id="user-display">Usuario</span>
            </div>
        </div>

        <div class="main">
            <div class="header">
                <h2 id="page-title">Upload Manager</h2>
                <div id="status-indicator" style="display:none">⏳ Ejecutando...</div>
            </div>

            <div class="controls">
                <select id="series-select">
                    <option value="" disabled selected>Cargando series...</option>
                </select>
                <button id="action-btn" onclick="runAction()">Iniciar Upload</button>
                <button onclick="clearTerm()" style="background-color: #444;">Limpiar</button>
            </div>

            <div class="terminal" id="terminal">
                <div class="log-line log-info">Bienvenido a NeoManga Tools v2.8</div>
                <div class="log-line log-info">Selecciona una serie y una acción para comenzar.</div>
            </div>
        </div>
    </div>

    <script src="/socket-lib.js?v=${Date.now()}"></script>
    <script>
        // 1. Variable Declarations (Top Level to avoid TDZ)
        let currentMode = 'upload';
        let isRunning = false;
        let socket = null;

        // 2. DOM Elements
        const term = document.getElementById('terminal');
        const select = document.getElementById('series-select');
        const actionBtn = document.getElementById('action-btn');
        const pageTitle = document.getElementById('page-title');

        // 3. Initialize Socket.IO safely
        try {
            if (typeof io !== 'undefined') {
                socket = io();
            } else {
                console.error('Socket.IO library not loaded!');
                log('Error crítico: No se pudo cargar Socket.IO', 'error');
            }
        } catch (e) {
            console.error('Error initializing socket:', e);
        }

        // --- AUTH PERSISTENCE LOGIC ---
        document.addEventListener('DOMContentLoaded', () => {
            const storedUser = localStorage.getItem('neomanga_user');
            if (storedUser) {
                try {
                    const user = JSON.parse(storedUser);
                    // Validate basic structure
                    if (user && user.username) {
                        showApp(user);
                    } else {
                        localStorage.removeItem('neomanga_user'); // Invalid data
                    }
                } catch (e) {
                    localStorage.removeItem('neomanga_user');
                }
            }
        });

        function showApp(user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-layout').style.display = 'flex';
            document.getElementById('user-display').innerHTML = 
                user.username + 
                ' <button onclick="logout()" style="background:none; border:none; color:#f48771; cursor:pointer; font-size:0.8em; margin-left:10px;">(Salir)</button>';
            loadSeries(); // Load series immediately
        }

        function logout() {
            localStorage.removeItem('neomanga_user');
            location.reload();
        }

        // Login Logic
        async function login() {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const errorMsg = document.getElementById('login-error');
            const btn = document.querySelector('.login-btn');

            if (!email || !password) {
                errorMsg.textContent = "Por favor completa todos los campos";
                errorMsg.style.display = 'block';
                return;
            }

            btn.disabled = true;
            btn.textContent = "Verificando...";
            errorMsg.style.display = 'none';

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await res.json();

                if (res.ok) {
                    // Success & Save to LocalStorage
                    localStorage.setItem('neomanga_user', JSON.stringify({
                        username: data.username,
                        roles: data.roles
                    }));
                    
                    showApp(data);
                } else {
                    // Error
                    errorMsg.textContent = data.error || "Error de autenticación";
                    errorMsg.style.display = 'block';
                }
            } catch (err) {
                errorMsg.textContent = "Error de conexión con el servidor";
                errorMsg.style.display = 'block';
            } finally {
                btn.disabled = false;
                btn.textContent = "Entrar";
            }
        }

        // Load Series
        function loadSeries() {
            // Visual feedback
             select.innerHTML = '<option value="" disabled selected>Cargando series...</option>';
             select.disabled = true;
 
             // AbortController for fetch timeout (5 seconds)
             const controller = new AbortController();
             const timeoutId = setTimeout(() => controller.abort(), 5000);

             fetch('/api/series', { signal: controller.signal })
                 .then(res => {
                     clearTimeout(timeoutId);
                     if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
                     return res.json();
                 })
                .then(data => {
                    select.innerHTML = '<option value="" disabled selected>Selecciona una serie...</option>';
                    select.innerHTML += '<option value="ALL">--- TODAS LAS SERIES ---</option>';
                    
                    if (!data || data.length === 0) {
                        select.innerHTML = '<option value="" disabled>No se encontraron series locales</option>';
                    } else {
                        data.forEach(s => {
                            const value = s.id || s;
                            const label = s.title || s;
                            const option = document.createElement('option');
                            option.value = value;
                            option.textContent = label;
                            select.appendChild(option);
                        });
                    }
                    select.disabled = false;
                })
                .catch(err => {
                    log('Error cargando series: ' + err.message, 'error');
                    select.innerHTML = '<option value="" disabled>Error de carga (Ver Terminal)</option>';
                    select.disabled = false;
                });
        }

        // Socket Events
        if (socket) {
            socket.on('log', (data) => {
                log(data.message, data.type);
            });

            socket.on('status', (data) => {
                isRunning = data.running;
                document.getElementById('status-indicator').style.display = isRunning ? 'block' : 'none';
                actionBtn.disabled = isRunning;
                select.disabled = isRunning;
            });
        }

        function setMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');

            if (mode === 'upload') {
                pageTitle.textContent = 'Upload Manager';
                actionBtn.textContent = 'Iniciar Upload';
                actionBtn.style.backgroundColor = '#007acc';
            } else if (mode === 'verify') {
                pageTitle.textContent = 'Verificación de Integridad';
                actionBtn.textContent = 'Iniciar Verificación';
                actionBtn.style.backgroundColor = '#d7ba7d';
                actionBtn.style.color = '#1e1e1e';
            } else if (mode === 'repair') {
                pageTitle.textContent = 'Reparación de Series';
                actionBtn.textContent = 'Iniciar Reparación';
                actionBtn.style.backgroundColor = '#ce9178';
                actionBtn.style.color = '#fff';
            }
        }

        function runAction() {
            if (!socket) return log('Error: No hay conexión Socket.IO', 'error');

            const series = select.value;
            if (!series) return alert('Selecciona una serie');
            
            clearTerm();
            if (currentMode === 'upload') socket.emit('start-upload', { series });
            if (currentMode === 'verify') socket.emit('start-verify', { series });
            if (currentMode === 'repair') socket.emit('start-repair', { series });
        }

        function log(msg, type = 'info') {
            const div = document.createElement('div');
            div.className = 'log-line log-' + type;
            div.textContent = msg; // Text content escapes HTML
            term.appendChild(div);
            term.scrollTop = term.scrollHeight;
        }

        function clearTerm() {
            term.innerHTML = '';
        }

        // Handle Enter key in password field
        document.getElementById('password').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                login();
            }
        });
    </script>
</body>
</html>
`;

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

// Manual Route for index.html using INLINED content
app.get('/', (req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(HTML_CONTENT);
});

app.use(express.json());

// API: LOGIN ENDPOINT
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`[AUTH] Intento de login: ${email}`);

        // 1. Find User
        // Normalize email to match backend logic (lowercase)
        const user = await User.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            console.log(`[AUTH] Usuario no encontrado: ${email}`);
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        // 2. Check Password
        // Handle cases where passwordHash might not be set or empty
        if (!user.passwordHash) {
             console.log(`[AUTH] Usuario sin contraseña: ${email}`);
             return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        
        if (!isMatch) {
            console.log(`[AUTH] Contraseña incorrecta para: ${email}`);
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        // 3. Optional: Check Role
        if (!user.roles || (!user.roles.includes('admin') && !user.roles.includes('owner'))) {
             console.log(`[AUTH] Rol insuficiente: ${user.roles}`);
             // Uncomment if you want to restrict access to admins/owners
             // return res.status(403).json({ error: 'No tienes permisos de administrador' });
        }

        console.log(`[AUTH] Login exitoso: ${user.username}`);
        res.json({ 
            success: true, 
            username: user.username,
            roles: user.roles 
        });

    } catch (error) {
        console.error('[AUTH] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// API Endpoints
app.get('/api/series', async (req, res) => {
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
        // Since the DB is small (~44 entries), fetching all titles is efficient enough
        // and allows for easy case-insensitive matching in memory.
        let allMangas = [];
        try {
            // Create a promise that rejects after 3 seconds
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('DB Timeout')), 3000)
            );

            // Race between DB query and timeout
            allMangas = await Promise.race([
                Manga.find({}, 'title folderPath _id').lean(),
                timeoutPromise
            ]);
            
            console.log(`[API] Total series en BD: ${allMangas.length}`);
        } catch (dbErr) {
            console.error('[API] Error consultando BD (continuando solo con local):', dbErr.message);
            // Continue with empty DB list to at least show folders
        }

        // 3. Map Local Folders to DB Entries
        const seriesList = localFolders.map(folderName => {
            // Match Logic: Check if Folder Name matches DB Title (Case Insensitive)
            const match = allMangas.find(m => m.title.toLowerCase().trim() === folderName.toLowerCase().trim());

            if (match) {
                return {
                    id: folderName, // Use the Folder Name as the identifier for the action
                    title: match.title, // Display official title
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

        // Sort by Title
        seriesList.sort((a, b) => a.title.localeCompare(b.title));

        res.json(seriesList);
    } catch (error) {
        console.error('[API] Error general:', error);
        res.status(500).json({ error: error.message });
    }
});

// Socket.IO Events
io.on('connection', (socket) => {
    // console.log('Web Client Connected');

    // Subscribe to logger events
    const logHandler = (data) => {
        socket.emit('log', data);
    };
    logger.on('log', logHandler);

    socket.on('disconnect', () => {
        logger.removeListener('log', logHandler);
    });

    // Commands
    socket.on('start-upload', async ({ series }) => {
        socket.emit('status', { running: true });
        try {
            if (series === 'ALL') {
                const dirs = await fs.readdir(env.CONTENT_DIR);
                const allSeries = dirs.filter(d => fs.statSync(`${env.CONTENT_DIR}/${d}`).isDirectory());
                for (const s of allSeries) {
                    await uploadSeries(s);
                }
            } else {
                await uploadSeries(series);
            }
            logger.success('🏁 Proceso Finalizado');
        } catch (e) {
            logger.error(`Error Fatal: ${e.message}`);
        } finally {
            socket.emit('status', { running: false });
        }
    });

    socket.on('start-verify', async ({ series }) => {
        socket.emit('status', { running: true });
        try {
            if (series === 'ALL') {
                const dirs = await fs.readdir(env.CONTENT_DIR);
                const allSeries = dirs.filter(d => fs.statSync(`${env.CONTENT_DIR}/${d}`).isDirectory());
                for (const s of allSeries) {
                    await verifySeries(s);
                }
            } else {
                await verifySeries(series);
            }
            logger.success('🏁 Verificación Finalizada');
        } catch (e) {
            logger.error(`Error Fatal: ${e.message}`);
        } finally {
            socket.emit('status', { running: false });
        }
    });

    socket.on('start-repair', async ({ series }) => {
        socket.emit('status', { running: true });
        try {
            await repairSeries(series);
            logger.success('🏁 Reparación Finalizada');
        } catch (e) {
            logger.error(`Error Fatal: ${e.message}`);
        } finally {
            socket.emit('status', { running: false });
        }
    });
});

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
                console.log(`👉 Por favor abre ${url} manualmente en tu navegador.`);
            }
        });
    } catch (error) {
        console.error('❌ Error fatal al iniciar servidor:', error);
        process.exit(1);
    }
}

module.exports = { startServer };