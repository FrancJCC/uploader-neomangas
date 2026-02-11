# Guía de Actualización Automática (NeoManga Tools)

Hemos implementado un sistema de **Auto-Update** para la herramienta CLI `neomanga-tools.exe`.
Esto permite que los usuarios externos detecten y descarguen nuevas versiones automáticamente al abrir la aplicación.

## 1. ¿Cómo funciona?

1. Al abrir la app, consulta un archivo `version.json` remoto.
2. Si la versión remota es mayor a la local, pregunta al usuario si quiere actualizar.
3. Si acepta, descarga el nuevo `.exe`, reemplaza el actual y reinicia la aplicación.

## 2. Configuración (Tu parte)

Para que esto funcione, necesitas alojar 2 archivos en internet (GitHub Releases, GitHub Raw, S3, o tu propio servidor):

### A. El archivo de control (`version.json`)
Este archivo le dice a la app cuál es la última versión.
Súbelo a una URL pública (ej: GitHub Raw o tu backend).

**Ejemplo de contenido:**
```json
{
  "version": "2.1.0",
  "url": "https://github.com/FrancJCC/uploader-neomangas/releases/download/v2.1.0/neomanga-tools.exe",
  "notes": "✨ Agregado soporte para auto-update y corrección de errores."
}
```

### B. El ejecutable (`neomanga-tools.exe`)
Es el archivo compilado de la nueva versión.

## 3. Pasos para lanzar una actualización

Cuando hagas cambios en el código y quieras distribuirlos:

1. **Incrementa la versión** en `package.json` (ej: de `2.0.0` a `2.1.0`).
2. **Compila el ejecutable**:
   ```bash
   npm run build
   ```
   Esto generará `neomanga-tools.exe`.
3. **Sube el nuevo `.exe`** a tu servidor o hosting de archivos.
4. **Actualiza el archivo `version.json`** con la nueva versión y la URL del nuevo exe.

## 4. Cambiar la URL del `version.json`

Por defecto, la app busca en:
`https://raw.githubusercontent.com/FrancJCC/neomanga-tools/main/version.json`

Si quieres cambiar esto, edita `src/services/updater.service.js` o establece la variable de entorno `UPDATE_URL` en el archivo `.env` del usuario (aunque distribuir .env actualizados es difícil, mejor hardcodear la URL correcta en el código antes de compilar).
