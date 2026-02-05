# NeoMangas Uploader

Herramienta automatizada para subir capítulos de manga al backend de NeoMangas. Soporta subida por lotes y verificación de integridad.

## 🚀 Características

- **Subida Interactiva:** Solicita credenciales y configuración al iniciar si no están definidas en el entorno.
- **Modo Seguro:** No almacena contraseñas en texto plano.
- **Soporte de Buckets Múltiples:** Sigue la lógica de llenado del backend (Viejo -> Intermedio -> Nuevo).
- **Verificación de Integridad:** Comprueba que todos los capítulos locales existan en el servidor remoto.

## 📋 Requisitos

- Sistema Operativo: Windows (x64) para el ejecutable.
- Node.js v18+ (solo si se ejecuta desde el código fuente).

## 🛠️ Instalación y Uso

### Opción 1: Usar el Ejecutable (Recomendado)

1.  Ubica el archivo `uploader.exe` en la carpeta `uploader`.
2.  Haz doble clic o ejecútalo desde la terminal:
    ```powershell
    .\uploader.exe
    ```
3.  El programa te pedirá los siguientes datos si no los encuentra en el archivo `.env`:
    -   **URL del Backend:** (ej. `https://tu-backend.onrender.com`)
    -   **Email de Administrador:** Tu correo de acceso.
    -   **Contraseña:** Tu contraseña (se ocultará al escribir).
    -   **Directorio de Mangas:** La ruta absoluta donde están tus carpetas de manga (ej. `E:\NeoManga\downloader\downloads`).

### Opción 2: Ejecutar desde Código Fuente

1.  Instala las dependencias:
    ```bash
    npm install
    ```
2.  Inicia la aplicación:
    ```bash
    npm start
    ```

## ⚙️ Configuración (Opcional)

Puedes crear un archivo `.env` en la raíz para predefinir valores y saltar las preguntas interactivas (útil para automatización), aunque **se recomienda usar el modo interactivo por seguridad**.

Variables soportadas:
```env
API_URL=https://tu-backend.onrender.com
ADMIN_EMAIL=tu@email.com
ADMIN_PASSWORD=tu_password
CONTENT_DIR=E:\ruta\a\tus\descargas
```

## 📦 Crear Ejecutable

Si modificas el código y quieres generar un nuevo `.exe`:

```bash
# Instalar dependencias
npm install

# Generar ejecutable (requiere pkg instalado globalmente o vía npx)
npx pkg index.js --targets node18-win-x64 --output uploader.exe
```

## 🔍 Verificación de Subidas

Para verificar si faltan capítulos en el servidor que sí tienes localmente:

```bash
npm run verify
```
O si usas el ejecutable, esta funcionalidad está integrada en el flujo principal o se puede implementar como comando adicional en futuras versiones.
