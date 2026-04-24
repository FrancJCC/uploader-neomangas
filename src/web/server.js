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

// INLINED JS CLIENT (Fallback for PKG path issues)
const JS_CLIENT_CONTENT = `
// 1. Variable Declarations
let currentMode = 'upload';
let isRunning = false;
let socket = null;
var selectedGenres = new Set();
var dbSeriesCache = [];

// 2. Initialize Socket.IO safely
try {
    if (typeof io !== 'undefined') {
        socket = io();
    }
} catch (e) { console.error('Error socket:', e); }

// --- AUTH PERSISTENCE LOGIC ---
document.addEventListener('DOMContentLoaded', function() {
    var storedUser = localStorage.getItem('neomanga_user');
    if (storedUser) {
        try {
            var user = JSON.parse(storedUser);
            if (user && user.username) showApp(user);
        } catch (e) { localStorage.removeItem('neomanga_user'); }
    }
});

function showApp(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-layout').style.display = 'flex';
    document.getElementById('user-display').textContent = user.username;
    loadConfig();
    loadSeries();
}

async function login() {
    var email = document.getElementById('email').value;
    var password = document.getElementById('password').value;
    var errorMsg = document.getElementById('login-error');
    var btn = document.querySelector('.login-btn');

    if (!email || !password) {
        errorMsg.textContent = "Completa todos los campos";
        errorMsg.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = "Verificando...";
    errorMsg.style.display = 'none';

    try {
        var res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        });
        var data = await res.json();
        if (res.ok) {
            localStorage.setItem('neomanga_user', JSON.stringify({ username: data.username, roles: data.roles }));
            showApp(data);
        } else {
            errorMsg.textContent = data.error || "Error de acceso";
            errorMsg.style.display = 'block';
        }
    } catch (err) {
        errorMsg.textContent = "Error de conexión";
        errorMsg.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = "Entrar";
    }
}

function logout() {
    localStorage.removeItem('neomanga_user');
    location.reload();
}

async function loadConfig() {
    try {
        var res = await fetch('/api/config');
        var data = await res.json();
        document.getElementById('current-folder').textContent = data.contentDir || 'No definida';
    } catch (err) {}
}

async function loadSeries() {
    var select = document.getElementById('series-select');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Cargando series...</option>';
    try {
        var res = await fetch('/api/series');
        var data = await res.json();
        select.innerHTML = '<option value="" disabled selected>Selecciona una serie...</option>';
        select.innerHTML += '<option value="ALL">--- TODAS LAS SERIES ---</option>';
        data.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.title;
            select.appendChild(opt);
        });
    } catch (err) {
        select.innerHTML = '<option value="" disabled>Error de carga</option>';
    }
}

async function promptChangeFolder() {
    var current = document.getElementById('current-folder').textContent;
    var newPath = prompt("Ingresa la ruta completa de la carpeta:", current);
    if (newPath && newPath !== current) {
        try {
            var res = await fetch('/api/config/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newPath })
            });
            if (res.ok) {
                document.getElementById('current-folder').textContent = newPath;
                loadSeries();
            }
        } catch (err) { alert('Error al cambiar carpeta'); }
    }
}

if (socket) {
    socket.on('log', function(data) { log(data.message, data.type); });
    socket.on('status', function(data) {
        isRunning = data.running;
        var indicator = document.getElementById('status-indicator');
        if (indicator) indicator.style.display = isRunning ? 'block' : 'none';
        var btn = document.getElementById('action-btn');
        if (btn) btn.disabled = isRunning;
    });
    socket.on('request-confirm', function(data) { showConfirm(data.message); });
}

function setMode(mode, event) {
    currentMode = mode;
    document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
    
    var target = event ? event.currentTarget : null;
    if (target) target.classList.add('active');

    var title = document.getElementById('page-title');
    var btn = document.getElementById('action-btn');
    var standardControls = document.getElementById('standard-controls');
    var createSection = document.getElementById('create-series-section');
    var listSection = document.getElementById('series-list-section');
    var editSection = document.getElementById('edit-series-section');

    if (standardControls) standardControls.style.display = 'none';
    if (createSection) createSection.style.display = 'none';
    if (listSection) listSection.style.display = 'none';
    if (editSection) editSection.style.display = 'none';

    if (mode === 'create') {
        if (title) title.textContent = 'Crear Nueva Serie';
        if (createSection) createSection.style.display = 'flex';
        generateNewId();
        loadGenres();
    } else if (mode === 'list') {
        if (title) title.textContent = 'Listado de Series';
        if (listSection) listSection.style.display = 'flex';
        loadDbSeries();
    } else if (mode === 'edit') {
        if (title) title.textContent = 'Editar Serie';
        if (editSection) editSection.style.display = 'flex';
    } else {
        if (standardControls) standardControls.style.display = 'flex';
        if (mode === 'upload') { if (title) title.textContent = 'Upload Manager'; if (btn) btn.textContent = 'Iniciar Upload'; }
        if (mode === 'verify') { if (title) title.textContent = 'Verificación'; if (btn) btn.textContent = 'Iniciar Verificación'; }
        if (mode === 'repair') { if (title) title.textContent = 'Reparación'; if (btn) btn.textContent = 'Iniciar Reparación'; }
    }
}

async function loadDbSeries() {
    var grid = document.getElementById('series-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px;">Cargando catálogo...</div>';
    
    try {
        var res = await fetch('/api/db-series');
        dbSeriesCache = await res.json();
        renderSeriesGrid(dbSeriesCache);
    } catch (err) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--error-color);">Error al cargar series</div>';
    }
}

function renderSeriesGrid(series) {
    var grid = document.getElementById('series-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (series.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No se encontraron series</div>';
        return;
    }

    series.forEach(function(s) {
        var card = document.createElement('div');
        card.className = 'series-card';
        card.innerHTML = '\
            <img src="' + (s.coverUrl || '/public/logo-header.png') + '" alt="' + s.title + '" onerror="this.src=\'/public/logo-header.png\'">\
            <div class="series-card-content">\
                <div class="series-card-title">' + s.title + '</div>\
                <div class="series-card-meta">' + s.type + ' • ' + s.status + '</div>\
                <div class="series-card-id">' + s.folderPath + '</div>\
                <button class="btn-small" style="margin-top: 10px; background: var(--accent-color);" onclick="openEditSeries(\'' + s._id + '\')">✏️ Editar Serie</button>\
            </div>\
        ';
        grid.appendChild(card);
    });
}

var searchInput = document.getElementById('series-search');
if (searchInput) {
    searchInput.addEventListener('input', function(e) {
        var term = e.target.value.toLowerCase();
        var filtered = dbSeriesCache.filter(function(s) { return s.title.toLowerCase().includes(term); });
        renderSeriesGrid(filtered);
    });
}

async function openEditSeries(id) {
    try {
        var response = await fetch('/api/series/' + id);
        var s = await response.json();
        
        document.getElementById('edit-id').value = s._id;
        document.getElementById('edit-title').value = s.title;
        document.getElementById('edit-slug').value = s.folderPath;
        document.getElementById('edit-type').value = s.type;
        document.getElementById('edit-status').value = s.status;
        document.getElementById('edit-author').value = s.author || '';
        document.getElementById('edit-year').value = s.releaseYear || '';
        document.getElementById('edit-description').value = s.description || '';
        document.getElementById('edit-cover-url').value = s.coverUrl || '';
        
        var preview = document.getElementById('edit-cover-preview');
        if (s.coverUrl) {
            preview.src = s.coverUrl;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }

        selectedGenres = new Set(s.genres || []);
        loadEditGenres();
        setMode('edit');
    } catch (err) {
        alert('Error al cargar detalles de la serie');
    }
}

async function loadEditGenres() {
    var container = document.getElementById('edit-genres-container');
    if (!container) return;
    try {
        var res = await fetch('/api/genres');
        var genres = await res.json();
        container.innerHTML = '';
        
        var allSet = new Set(genres);
        selectedGenres.forEach(function(g) { allSet.add(g); });
        
        allSet.forEach(function(genre) {
            var span = document.createElement('span');
            span.className = 'genre-pill';
            span.textContent = genre;
            span.onclick = function() { toggleGenre(genre, span); };
            if (selectedGenres.has(genre)) span.classList.add('selected');
            container.appendChild(span);
        });
    } catch (err) {}
}

function handleEditFileSelect(event) {
    var file = event.target.files[0];
    var display = document.getElementById('edit-file-name');
    if (file) {
        display.textContent = '📄 Nuevo archivo: ' + file.name;
        display.style.display = 'block';
        document.getElementById('edit-cover-url').disabled = true;
        document.getElementById('edit-cover-url').style.opacity = '0.5';
    }
}

async function submitUpdateSeries() {
    var id = document.getElementById('edit-id').value;
    var title = document.getElementById('edit-title').value;
    var type = document.getElementById('edit-type').value;
    var status = document.getElementById('edit-status').value;
    var author = document.getElementById('edit-author').value;
    var year = document.getElementById('edit-year').value;
    var description = document.getElementById('edit-description').value;
    var coverUrl = document.getElementById('edit-cover-url').value;
    var coverFile = document.getElementById('edit-cover-file').files[0];

    if (!title) return alert('El título es obligatorio');

    var btn = document.getElementById('update-btn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando Cambios...';

    var formData = new FormData();
    formData.append('title', title);
    formData.append('type', type);
    formData.append('status', status);
    formData.append('author', author);
    formData.append('releaseYear', year);
    formData.append('description', description);
    
    if (coverFile) {
        formData.append('cover', coverFile);
    } else {
        formData.append('coverUrl', coverUrl);
    }
    
    selectedGenres.forEach(function(g) { formData.append('genres', g); });

    try {
        var response = await fetch('/api/series/' + id, {
            method: 'PUT',
            body: formData
        });
        if (response.ok) {
            log('✅ Serie actualizada: ' + title, 'success');
            setMode('list');
            loadSeries();
        } else {
            var data = await response.json();
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function generateNewId() {
    var timestamp = Math.floor(Date.now() / 1000).toString(16);
    var random = 'xxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
        return (Math.random() * 16 | 0).toString(16);
    });
    var newId = timestamp + random;
    var input = document.getElementById('create-slug');
    if (input) input.value = newId;
    return newId;
}

async function loadGenres() {
    var container = document.getElementById('genres-container');
    if (!container) return;
    try {
        var res = await fetch('/api/genres');
        var genres = await res.json();
        container.innerHTML = '';
        genres.forEach(function(genre) {
            var span = document.createElement('span');
            span.className = 'genre-pill';
            span.textContent = genre;
            span.onclick = function() { toggleGenre(genre, span); };
            if (selectedGenres.has(genre)) span.classList.add('selected');
            container.appendChild(span);
        });
    } catch (err) {}
}

function toggleGenre(genre, element) {
    if (selectedGenres.has(genre)) {
        selectedGenres.delete(genre);
        element.classList.remove('selected');
    } else {
        selectedGenres.add(genre);
        element.classList.add('selected');
    }
}

var newGenreInput = document.getElementById('new-genre');
if (newGenreInput) {
    newGenreInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            var val = e.target.value.trim();
            if (val && !selectedGenres.has(val)) {
                selectedGenres.add(val);
                var container = document.getElementById('genres-container');
                var span = document.createElement('span');
                span.className = 'genre-pill selected';
                span.textContent = val;
                span.onclick = function() { toggleGenre(val, span); };
                container.appendChild(span);
                e.target.value = '';
            }
        }
    });
}

var editGenreInput = document.getElementById('edit-new-genre');
if (editGenreInput) {
    editGenreInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            var val = e.target.value.trim();
            if (val && !selectedGenres.has(val)) {
                selectedGenres.add(val);
                var container = document.getElementById('edit-genres-container');
                var span = document.createElement('span');
                span.className = 'genre-pill selected';
                span.textContent = val;
                span.onclick = function() { toggleGenre(val, span); };
                container.appendChild(span);
                e.target.value = '';
            }
        }
    });
}

function handleFileSelect(event) {
    var file = event.target.files[0];
    var display = document.getElementById('file-name-display');
    if (file) {
        display.textContent = '📄 Archivo seleccionado: ' + file.name;
        display.style.display = 'block';
        document.getElementById('create-cover-url').disabled = true;
        document.getElementById('create-cover-url').style.opacity = '0.5';
    }
}

async function submitCreateSeries() {
    var title = document.getElementById('create-title').value;
    var type = document.getElementById('create-type').value;
    var status = document.getElementById('create-status').value;
    var author = document.getElementById('create-author').value;
    var year = document.getElementById('create-year').value;
    var description = document.getElementById('create-description').value;
    var coverUrl = document.getElementById('create-cover-url').value;
    var coverFile = document.getElementById('create-cover-file').files[0];
    var customId = document.getElementById('create-slug').value;

    if (!title) return alert('El título es obligatorio');

    var btn = document.getElementById('create-btn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creando Serie...';

    var formData = new FormData();
    formData.append('title', title);
    formData.append('type', type);
    formData.append('status', status);
    formData.append('author', author);
    formData.append('releaseYear', year);
    formData.append('description', description);
    if (coverFile) {
        formData.append('cover', coverFile);
    } else {
        formData.append('coverUrl', coverUrl);
    }
    formData.append('customId', customId);
    
    selectedGenres.forEach(function(g) { formData.append('genres', g); });

    try {
        var res = await fetch('/api/series', {
            method: 'POST',
            body: formData
        });
        var data = await res.json();
        if (res.ok) {
            log('✅ Serie creada con éxito: ' + title, 'success');
            resetCreateForm();
            setMode('upload');
            loadSeries();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function resetCreateForm() {
    document.getElementById('create-title').value = '';
    generateNewId();
    document.getElementById('create-author').value = '';
    document.getElementById('create-year').value = '';
    document.getElementById('create-description').value = '';
    document.getElementById('create-cover-url').value = '';
    document.getElementById('create-cover-url').disabled = false;
    document.getElementById('create-cover-url').style.opacity = '1';
    document.getElementById('create-cover-file').value = '';
    document.getElementById('file-name-display').style.display = 'none';
    selectedGenres.clear();
    loadGenres();
}

function runAction() {
    var series = document.getElementById('series-select').value;
    if (!series) return alert('Selecciona una serie');
    document.getElementById('terminal').innerHTML = '';
    socket.emit('start-' + currentMode, { series: series });
}

function showConfirm(msg) {
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
}

function resolveConfirm(result) {
    document.getElementById('confirm-modal').style.display = 'none';
    socket.emit('resolve-confirm', { result: result });
}

function log(msg, type) {
    var term = document.getElementById('terminal');
    if (!term) return;
    var div = document.createElement('div');
    div.className = 'log-line log-' + (type || 'info');
    var icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : (type === 'warn' ? '⚠️' : 'ℹ️'));
    div.innerHTML = '<span style="margin-right:10px; opacity:0.7">' + icon + '</span> <span>' + msg + '</span>';
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

function clearTerm() { var term = document.getElementById('terminal'); if (term) term.innerHTML = ''; }
function resetUI() { location.reload(); }
`;

// INLINED CSS (Fallback for PKG path issues)
const CSS_CONTENT = `
:root {
    --bg-color: #020617;
    --sidebar-color: #0f172a;
    --accent-color: #3b82f6;
    --accent-glow: rgba(59, 130, 246, 0.4);
    --accent-gradient: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    --text-color: #f8fafc;
    --text-muted: #64748b;
    --term-bg: #000000;
    --card-bg: #1e293b;
    --border-color: rgba(255, 255, 255, 0.08);
    --success-color: #10b981;
    --error-color: #ef4444;
    --warning-color: #f59e0b;
    --panel-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.2);
}

* {
    box-sizing: border-box;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

body {
    font-family: 'Inter', -apple-system, sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    margin: 0;
    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* Login Screen - Ultra Modern */
#login-screen {
    position: fixed;
    inset: 0;
    background: radial-gradient(circle at center, #1e293b 0%, #020617 100%);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 3000;
}
.login-box {
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(20px);
    padding: 48px;
    border-radius: 32px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    width: 420px;
    text-align: center;
    border: 1px solid var(--border-color);
}
.login-box h2 {
    font-size: 2.2rem;
    margin-bottom: 32px;
    font-weight: 900;
    letter-spacing: -0.05em;
    background: linear-gradient(to bottom, #fff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
.login-input {
    width: 100%;
    padding: 16px 20px;
    margin-bottom: 16px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-color);
    color: #fff;
    border-radius: 16px;
    font-size: 1rem;
}
.login-input:focus {
    outline: none;
    border-color: var(--accent-color);
    background: rgba(0, 0, 0, 0.5);
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
}
.login-btn {
    width: 100%;
    padding: 16px;
    background: var(--accent-gradient);
    color: #fff;
    border: none;
    border-radius: 16px;
    cursor: pointer;
    font-weight: 800;
    font-size: 1.1rem;
    box-shadow: 0 8px 20px -6px var(--accent-glow);
    margin-top: 10px;
}
.login-btn:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 12px 24px -6px var(--accent-glow); }
.login-btn:active { transform: translateY(0) scale(0.98); }

/* App Layout */
#app-layout {
    display: none; /* Controlled by JS */
    flex: 1;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
}

/* Sidebar - Sleek & Refined */
.sidebar {
    width: 300px;
    min-width: 300px;
    background-color: var(--sidebar-color);
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color);
    position: relative;
    height: 100%;
    z-index: 100;
}
.logo {
    margin-bottom: 48px;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 10px;
}
.logo img {
    width: 140px;
    height: auto;
    border-radius: 20px;
    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.5));
    transition: transform 0.3s ease;
}
.logo img:hover {
    transform: scale(1.05);
}
.nav-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: 14px 20px;
    text-align: left;
    cursor: pointer;
    border-radius: 16px;
    margin-bottom: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    position: relative;
    overflow: hidden;
}
.nav-btn:hover {
    background-color: rgba(255, 255, 255, 0.03);
    color: #fff;
    transform: translateX(4px);
}
.nav-btn.active {
    background-color: rgba(59, 130, 246, 0.1);
    color: var(--accent-color);
    box-shadow: inset 4px 0 0 var(--accent-color);
    border-radius: 16px;
}

/* Dynamic Config Card */
.config-section {
    margin-top: 40px;
    padding: 24px;
    background: linear-gradient(to bottom right, rgba(255,255,255,0.03), transparent);
    border-radius: 20px;
    border: 1px solid var(--border-color);
}
.config-label {
    color: var(--accent-color);
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 14px;
    display: block;
    opacity: 0.8;
}
.config-value {
    color: #cbd5e1;
    font-size: 0.85rem;
    word-break: break-all;
    margin-bottom: 20px;
    display: block;
    line-height: 1.6;
    font-family: 'JetBrains Mono', monospace;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 12px;
}
.btn-small {
    padding: 10px;
    font-size: 0.8rem;
    background-color: rgba(255,255,255,0.05);
    border-radius: 10px;
    border: 1px solid var(--border-color);
    color: #fff;
    font-weight: 700;
    width: 100%;
    cursor: pointer;
}
.btn-small:hover { background-color: var(--accent-color); border-color: transparent; }

.user-info {
    margin-top: auto;
    padding: 20px;
    background: rgba(0,0,0,0.3);
    border-radius: 20px;
    border: 1px solid var(--border-color);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

/* Main Viewport */
.main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 40px;
    gap: 32px;
    background: radial-gradient(at top left, rgba(30, 41, 59, 0.1), transparent);
    overflow-y: auto;
    height: 100%;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    height: 60px;
}
.header .page-logo {
    height: 100%;
    display: flex;
    align-items: center;
}
.header h2 {
    font-size: 2.2rem;
    font-weight: 900;
    letter-spacing: -0.04em;
    margin: 0;
    background: linear-gradient(to right, #fff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

/* Glassmorphism Controls */
.controls-card {
    background-color: rgba(30, 41, 59, 0.4);
    backdrop-filter: blur(10px);
    padding: 28px;
    border-radius: 24px;
    display: flex;
    gap: 20px;
    align-items: center;
    border: 1px solid var(--border-color);
    box-shadow: var(--panel-shadow);
}
select {
    background-color: rgba(0, 0, 0, 0.5);
    color: #fff;
    padding: 14px 20px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    flex: 1;
    font-size: 1rem;
    font-weight: 600;
    appearance: none;
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 16px center;
    background-size: 16px;
    transition: all 0.3s;
}
select:hover {
    background-color: rgba(0, 0, 0, 0.7);
    border-color: var(--accent-color);
    box-shadow: 0 0 15px rgba(59, 130, 246, 0.15);
}
select:focus {
    outline: none;
    border-color: var(--accent-color);
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.25);
}

.action-btns {
    display: flex;
    gap: 12px;
}
.btn-secondary {
    padding: 14px 24px;
    font-size: 0.95rem;
    background-color: rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.btn-secondary:hover { 
    background-color: rgba(255, 255, 255, 0.15); 
    color: #fff;
    border-color: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.btn-secondary:active { transform: translateY(0); }

#action-btn {
    padding: 14px 32px;
    background: var(--accent-gradient);
    border-radius: 14px;
    font-weight: 800;
    color: #fff;
    box-shadow: 0 4px 12px var(--accent-glow);
}
#action-btn:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 8px 20px var(--accent-glow); }

/* Professional Terminal Container */
.terminal-container {
    flex: 1;
    min-height: 0; /* Important for flex child with overflow */
    background-color: var(--term-bg);
    border-radius: 24px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    box-shadow: var(--panel-shadow);
    overflow: hidden;
}
.terminal-header {
    background: linear-gradient(to bottom, rgba(255,255,255,0.05), transparent);
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-color);
}
.terminal {
    padding: 24px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.9rem;
    line-height: 1.7;
    overflow-y: auto;
    color: #e2e8f0;
}
.log-line { margin: 6px 0; border-left: 2px solid transparent; padding-left: 12px; }
.log-line:hover { background: rgba(255,255,255,0.02); border-left-color: var(--accent-color); }

.log-info { color: #94a3b8; }
.log-error { color: #fff; background: rgba(239, 68, 68, 0.2); border-radius: 6px; padding: 4px 12px; border-left: 4px solid var(--error-color); }
.log-success { color: var(--success-color); font-weight: 700; text-shadow: 0 0 10px rgba(16, 185, 129, 0.3); }
.log-warn { color: var(--warning-color); border-left: 4px solid var(--warning-color); }
.log-title { 
    background: linear-gradient(90deg, rgba(59, 130, 246, 0.1), transparent);
    padding: 8px 16px;
    border-radius: 8px;
    color: var(--accent-color);
    margin: 24px 0 12px 0;
}

/* Neon Confirmation Modal */
#confirm-modal {
     display: none;
     position: fixed;
     top: 0;
     left: 0;
     width: 100vw;
     height: 100vh;
     background-color: rgba(2, 6, 23, 0.9);
     backdrop-filter: blur(16px);
     z-index: 9999;
     justify-content: center;
     align-items: center;
     animation: fadeIn 0.3s ease;
 }
.modal-box {
    background-color: #0f172a;
    border: 1px solid rgba(59, 130, 246, 0.3);
    box-shadow: 0 0 50px rgba(59, 130, 246, 0.15), 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    padding: 40px;
    border-radius: 28px;
    max-width: 550px;
    width: 90%;
    text-align: center;
    transform: translateY(0);
    animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-msg {
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 32px;
    color: #fff;
    line-height: 1.5;
}
.modal-btns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.modal-btns button {
    padding: 16px 20px;
    border: none;
    border-radius: 16px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}
.btn-yes { background: #1e293b; color: #fff; border: 1px solid rgba(255,255,255,0.1); }
.btn-no { background: #1e293b; color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); }
.btn-yes:hover { background: var(--success-color); border-color: transparent; transform: translateY(-2px); }
.btn-no:hover { background: var(--error-color); color: #fff; border-color: transparent; transform: translateY(-2px); }

.btn-yes-all { background: var(--accent-gradient); color: #fff; grid-column: span 2; }
.btn-no-all { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); grid-column: span 2; }

.btn-yes-all:hover { transform: translateY(-2px); box-shadow: 0 8px 20px var(--accent-glow); }
.btn-no-all:hover { background: #ef4444; color: #fff; transform: translateY(-2px); }

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
 @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
 .fade-in { animation: fadeIn 0.4s ease; }

#status-indicator {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    box-shadow: 0 0 15px rgba(245, 158, 11, 0.1);
}

/* Custom Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

.genre-pill {
    padding: 6px 12px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-color);
    border-radius: 20px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
    user-select: none;
}
.genre-pill:hover { background: rgba(255, 255, 255, 0.1); border-color: var(--accent-color); }
.genre-pill.selected { background: var(--accent-color); color: #fff; border-color: transparent; box-shadow: 0 0 10px var(--accent-glow); }

.form-group { display: flex; flex-direction: column; gap: 8px; }

/* Series Card Styling */
.series-card {
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid var(--border-color);
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: all 0.3s ease;
}
.series-card:hover {
    transform: translateY(-5px);
    border-color: var(--accent-color);
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
}
.series-card img {
    width: 100%;
    height: 240px;
    object-fit: cover;
    background: #000;
}
.series-card-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.series-card-title {
    font-weight: 800;
    font-size: 1rem;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.series-card-meta {
    font-size: 0.75rem;
    color: var(--accent-color);
    font-weight: 700;
    text-transform: uppercase;
}
.series-card-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.6;
}
`;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Debugging for PKG environment
if (process.pkg) {
    console.log('[DEBUG] Executing inside PKG environment');
    console.log('[DEBUG] __dirname:', __dirname);
}

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

// Serve Socket.IO Client Library explicitly (Fixes pkg/injection issues)
app.get('/socket-lib.js', (req, res) => {
    res.type('application/javascript');
    res.send(socketIoLib);
});

// Serve CSS explicitly (Fixes pkg/injection issues)
app.get('/public/css/style.css', (req, res) => {
    res.type('text/css');
    res.send(CSS_CONTENT);
});

// Serve JS explicitly (Fixes pkg/injection issues)
app.get('/public/js/client.js', (req, res) => {
    res.type('application/javascript');
    res.send(JS_CLIENT_CONTENT);
});

// Serve Static Assets from src/web/public
const publicDir = path.resolve(__dirname, 'public');
app.use('/public', express.static(publicDir));

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
