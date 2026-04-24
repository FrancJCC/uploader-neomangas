// 1. Variable Declarations
let currentMode = 'upload';
let isRunning = false;
let socket = null;

// 2. Initialize Socket.IO safely
try {
    if (typeof io !== 'undefined') {
        socket = io();
    }
} catch (e) { console.error('Error socket:', e); }

// --- AUTH PERSISTENCE LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const storedUser = localStorage.getItem('neomanga_user');
    if (storedUser) {
        try {
            const user = JSON.parse(storedUser);
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
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMsg = document.getElementById('login-error');
    const btn = document.querySelector('.login-btn');

    if (!email || !password) {
        errorMsg.textContent = "Completa todos los campos";
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
        const res = await fetch('/api/config');
        const data = await res.json();
        document.getElementById('current-folder').textContent = data.contentDir || 'No definida';
    } catch (err) {}
}

async function loadSeries() {
    const select = document.getElementById('series-select');
    if (!select) return;
    select.innerHTML = '<option value="" disabled selected>Cargando series...</option>';
    try {
        const res = await fetch('/api/series');
        const data = await res.json();
        select.innerHTML = '<option value="" disabled selected>Selecciona una serie...</option>';
        select.innerHTML += '<option value="ALL">--- TODAS LAS SERIES ---</option>';
        data.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.title;
            select.appendChild(opt);
        });
    } catch (err) {
        select.innerHTML = '<option value="" disabled>Error de carga</option>';
    }
}

async function promptChangeFolder() {
    const current = document.getElementById('current-folder').textContent;
    const newPath = prompt("Ingresa la ruta completa de la carpeta:", current);
    if (newPath && newPath !== current) {
        try {
            const res = await fetch('/api/config/folder', {
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
    socket.on('log', (data) => log(data.message, data.type));
    socket.on('status', (data) => {
        isRunning = data.running;
        const indicator = document.getElementById('status-indicator');
        if (indicator) indicator.style.display = isRunning ? 'block' : 'none';
        const btn = document.getElementById('action-btn');
        if (btn) btn.disabled = isRunning;
    });
    socket.on('request-confirm', (data) => showConfirm(data.message));
}

function setMode(mode, event) {
    currentMode = mode;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Fix: Use currentTarget safely
    const target = event ? event.currentTarget : null;
    if (target) target.classList.add('active');

    const title = document.getElementById('page-title');
    const btn = document.getElementById('action-btn');
    const standardControls = document.getElementById('standard-controls');
    const createSection = document.getElementById('create-series-section');
    const listSection = document.getElementById('series-list-section');
    const editSection = document.getElementById('edit-series-section');

    // Hide all main sections by default
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

let dbSeriesCache = [];

async function loadDbSeries() {
    const grid = document.getElementById('series-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px;">Cargando catálogo...</div>';
    
    try {
        const res = await fetch('/api/db-series');
        dbSeriesCache = await res.json();
        renderSeriesGrid(dbSeriesCache);
    } catch (err) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--error-color);">Error al cargar series</div>';
    }
}

function renderSeriesGrid(series) {
    const grid = document.getElementById('series-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (series.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No se encontraron series</div>';
        return;
    }

    series.forEach(s => {
        const card = document.createElement('div');
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

document.getElementById('series-search')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = dbSeriesCache.filter(s => s.title.toLowerCase().includes(term));
    renderSeriesGrid(filtered);
});

async function openEditSeries(id) {
    try {
        const res = await fetch('/api/series/' + id);
        const s = await res.json();
        
        document.getElementById('edit-id').value = s._id;
        document.getElementById('edit-title').value = s.title;
        document.getElementById('edit-slug').value = s.folderPath;
        document.getElementById('edit-type').value = s.type;
        document.getElementById('edit-status').value = s.status;
        document.getElementById('edit-author').value = s.author || '';
        document.getElementById('edit-year').value = s.releaseYear || '';
        document.getElementById('edit-description').value = s.description || '';
        document.getElementById('edit-cover-url').value = s.coverUrl || '';
        
        const preview = document.getElementById('edit-cover-preview');
        if (s.coverUrl) {
            preview.src = s.coverUrl;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }

        // Setup genres for edit
        selectedGenres = new Set(s.genres || []);
        loadEditGenres();
        
        setMode('edit');
    } catch (err) {
        alert('Error al cargar detalles de la serie');
    }
}

async function loadEditGenres() {
    const container = document.getElementById('edit-genres-container');
    if (!container) return;
    try {
        const res = await fetch('/api/genres');
        const genres = await res.json();
        container.innerHTML = '';
        
        const allPossibleGenres = new Set([...genres, ...selectedGenres]);
        
        allPossibleGenres.forEach(genre => {
            const span = document.createElement('span');
            span.className = 'genre-pill';
            span.textContent = genre;
            span.onclick = () => toggleGenre(genre, span);
            if (selectedGenres.has(genre)) span.classList.add('selected');
            container.appendChild(span);
        });
    } catch (err) {}
}

document.getElementById('edit-new-genre')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val && !selectedGenres.has(val)) {
            selectedGenres.add(val);
            const container = document.getElementById('edit-genres-container');
            const span = document.createElement('span');
            span.className = 'genre-pill selected';
            span.textContent = val;
            span.onclick = () => toggleGenre(val, span);
            container.appendChild(span);
            e.target.value = '';
        }
    }
});

function handleEditFileSelect(event) {
    const file = event.target.files[0];
    const display = document.getElementById('edit-file-name');
    if (file) {
        display.textContent = '📄 Nuevo archivo: ' + file.name;
        display.style.display = 'block';
        document.getElementById('edit-cover-url').disabled = true;
        document.getElementById('edit-cover-url').style.opacity = '0.5';
    }
}

async function submitUpdateSeries() {
    const id = document.getElementById('edit-id').value;
    const title = document.getElementById('edit-title').value;
    const type = document.getElementById('edit-type').value;
    const status = document.getElementById('edit-status').value;
    const author = document.getElementById('edit-author').value;
    const year = document.getElementById('edit-year').value;
    const description = document.getElementById('edit-description').value;
    const coverUrl = document.getElementById('edit-cover-url').value;
    const coverFile = document.getElementById('edit-cover-file').files[0];

    if (!title) return alert('El título es obligatorio');

    const btn = document.getElementById('update-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando Cambios...';

    const formData = new FormData();
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
    
    selectedGenres.forEach(g => formData.append('genres', g));

    try {
        const res = await fetch('/api/series/' + id, {
            method: 'PUT',
            body: formData
        });
        if (res.ok) {
            log('✅ Serie actualizada: ' + title, 'success');
            setMode('list');
            loadSeries(); // Refresh dropdown
        } else {
            const data = await res.json();
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
    const timestamp = Math.floor(Date.now() / 1000).toString(16);
    const random = 'xxxxxxxxxxxxxxxx'.replace(/[x]/g, () => {
        return (Math.random() * 16 | 0).toString(16);
    });
    const newId = timestamp + random;
    const input = document.getElementById('create-slug');
    if (input) input.value = newId;
    return newId;
}

function updateSlug() {}

let selectedGenres = new Set();

async function loadGenres() {
    const container = document.getElementById('genres-container');
    if (!container) return;
    try {
        const res = await fetch('/api/genres');
        const genres = await res.json();
        container.innerHTML = '';
        if (genres.length === 0) {
            container.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">No hay géneros en la BD. Agrega uno abajo.</span>';
        }
        genres.forEach(genre => {
            const span = document.createElement('span');
            span.className = 'genre-pill';
            span.textContent = genre;
            span.onclick = () => toggleGenre(genre, span);
            if (selectedGenres.has(genre)) span.classList.add('selected');
            container.appendChild(span);
        });
    } catch (err) {
        container.innerHTML = '<span style="color: var(--error-color);">Error cargando géneros</span>';
    }
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

document.getElementById('new-genre')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val && !selectedGenres.has(val)) {
            selectedGenres.add(val);
            const container = document.getElementById('genres-container');
            const span = document.createElement('span');
            span.className = 'genre-pill selected';
            span.textContent = val;
            span.onclick = () => toggleGenre(val, span);
            container.appendChild(span);
            e.target.value = '';
        }
    }
});

function handleFileSelect(event) {
    const file = event.target.files[0];
    const display = document.getElementById('file-name-display');
    if (file) {
        display.textContent = '📄 Archivo seleccionado: ' + file.name;
        display.style.display = 'block';
        document.getElementById('create-cover-url').disabled = true;
        document.getElementById('create-cover-url').style.opacity = '0.5';
    }
}

async function submitCreateSeries() {
    const title = document.getElementById('create-title').value;
    const type = document.getElementById('create-type').value;
    const status = document.getElementById('create-status').value;
    const author = document.getElementById('create-author').value;
    const year = document.getElementById('create-year').value;
    const description = document.getElementById('create-description').value;
    const coverUrl = document.getElementById('create-cover-url').value;
    const coverFile = document.getElementById('create-cover-file').files[0];
    const customId = document.getElementById('create-slug').value;

    if (!title) return alert('El título es obligatorio');

    const btn = document.getElementById('create-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creando Serie...';

    const formData = new FormData();
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
    
    selectedGenres.forEach(g => formData.append('genres', g));

    try {
        const res = await fetch('/api/series', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
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
    const series = document.getElementById('series-select').value;
    if (!series) return alert('Selecciona una serie');
    document.getElementById('terminal').innerHTML = '';
    socket.emit('start-' + currentMode, { series });
}

function showConfirm(msg) {
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
}

function resolveConfirm(result) {
    document.getElementById('confirm-modal').style.display = 'none';
    socket.emit('resolve-confirm', { result });
}

function log(msg, type = 'info') {
    const term = document.getElementById('terminal');
    if (!term) return;
    const div = document.createElement('div');
    div.className = 'log-line log-' + type;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warn') icon = '⚠️';
    
    div.innerHTML = '<span style="margin-right:10px; opacity:0.7">' + icon + '</span> <span>' + msg + '</span>';
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
}

function clearTerm() { 
    const term = document.getElementById('terminal');
    if (term) term.innerHTML = ''; 
}
function resetUI() { location.reload(); }
