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
    loadConfig(); // Load current config
    loadSeries(); // Load series immediately
}

// --- CONFIGURATION LOGIC ---
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        document.getElementById('current-folder').textContent = data.contentDir || 'No definida';
    } catch (err) {
        console.error('Error cargando config:', err);
    }
}

async function promptChangeFolder() {
    const current = document.getElementById('current-folder').textContent;
    const newPath = prompt("Ingresa la ruta completa de la carpeta donde están tus series:", current);
    
    if (newPath && newPath !== current) {
        try {
            const res = await fetch('/api/config/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newPath })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                log('📁 Carpeta actualizada: ' + newPath, 'success');
                document.getElementById('current-folder').textContent = newPath;
                loadSeries(); // Recargar series automáticamente
            } else {
                alert('Error: ' + (data.error || 'No se pudo cambiar la carpeta'));
            }
        } catch (err) {
            alert('Error de conexión al cambiar carpeta');
        }
    }
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
             if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        document.getElementById('change-folder-btn').disabled = isRunning;
    });

    // Listen for input requests
    socket.on('request-confirm', (data) => {
        showConfirm(data.message);
    });
}

function resetUI() {
    if (isRunning) return alert('No puedes regresar mientras hay un proceso en ejecución.');
    setMode('upload');
    clearTerm();
    select.value = "";
    log('🏠 Regresado al inicio. Puedes seleccionar otra serie o cambiar la carpeta base.', 'info');
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    // Handle the event correctly if called from HTML onclick
    if (event && event.target) {
        event.target.classList.add('active');
    }

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

// --- CONFIRMATION MODAL LOGIC ---
function showConfirm(msg) {
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
}

function resolveConfirm(result) {
    document.getElementById('confirm-modal').style.display = 'none';
    if (socket) {
        socket.emit('resolve-confirm', { result });
        
        // Visual feedback in terminal
        let text = '';
        let type = 'info';
        
        if (result === true) { text = '✅ Confirmado (Solo este)'; type = 'success'; }
        else if (result === false) { text = '❌ Cancelado (Solo este)'; type = 'error'; }
        else if (result === 'yes_all') { text = '✅✅ Confirmado a TODO'; type = 'success'; }
        else if (result === 'no_all') { text = '❌❌ Cancelado a TODO'; type = 'error'; }
        
        log(text, type);
    }
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
