const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const colors = require('colors');
const packageJson = require('../../package.json');
const inquirer = require('inquirer');
const ora = require('ora');

// URL por defecto donde se alojará el JSON de versión
// El usuario debe configurar esto en su servidor/bucket
const DEFAULT_UPDATE_URL = 'https://raw.githubusercontent.com/FrancJCC/uploader-neomangas/main/version.json';

class UpdaterService {
    constructor() {
        // En PKG, packageJson.version puede ser inconsistente si no se lee del archivo físico o si pkg inyecta algo
        this.currentVersion = packageJson.version;
        this.updateUrl = process.env.UPDATE_URL || DEFAULT_UPDATE_URL;
    }

    /**
     * Compara versiones semver (simple)
     * Retorna true si remote > local
     */
    isNewer(local, remote) {
        if (!local || !remote) return false;
        
        // Limpiar posibles prefijos 'v'
        const l = local.replace(/^v/, '');
        const r = remote.replace(/^v/, '');
        
        if (l === r) return false;

        const localParts = l.split('.').map(Number);
        const remoteParts = r.split('.').map(Number);
        
        for (let i = 0; i < 3; i++) {
            const rPart = remoteParts[i] || 0;
            const lPart = localParts[i] || 0;
            if (rPart > lPart) return true;
            if (rPart < lPart) return false;
        }
        return false;
    }

    async check() {
        try {
            console.log(`[Updater] Verificando actualizaciones... (Local: v${this.currentVersion})`.gray);
            
            // Forzar no-cache para el check de versión
            const response = await fetch(`${this.updateUrl}?t=${Date.now()}`);
            if (!response.ok) {
                console.log(`[Updater] Error al conectar con el servidor de actualizaciones (${response.status})`.yellow);
                return null;
            }
            
            const data = await response.json();
            console.log(`[Updater] Versión remota encontrada: v${data.version}`.gray);
            
            if (this.isNewer(this.currentVersion, data.version)) {
                console.log(`[Updater] ¡Nueva versión disponible! v${data.version}`.green.bold);
                return data;
            }
            
            console.log(`[Updater] Estás en la versión más reciente.`.gray);
            return null;
        } catch (error) {
            console.log(`[Updater] Error de red al buscar actualizaciones: ${error.message}`.yellow);
            return null;
        }
    }

    async download(url, targetPath) {
        const spinner = ora('Descargando actualización...').start();
        try {
            // No-cache para la descarga del binario también
            const response = await fetch(`${url}?t=${Date.now()}`);
            if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
            
            const buffer = await response.arrayBuffer();
            await fs.writeFile(targetPath, Buffer.from(buffer));
            
            spinner.succeed('Descarga completada.');
            return true;
        } catch (error) {
            spinner.fail(`Error en descarga: ${error.message}`);
            return false;
        }
    }

    async applyUpdate(newFilePath) {
        const currentExe = process.execPath;
        const currentDir = path.dirname(currentExe);
        const exeName = path.basename(currentExe);
        
        // En entorno de desarrollo (node index.js), no podemos auto-actualizarnos igual
        // Pero simulamos para cuando esté compilado
        const isPkg = process.pkg !== undefined;
        
        if (!isPkg) {
            console.log('⚠️  Estás ejecutando en modo desarrollo (node).'.yellow);
            console.log(`   El updater descargó el archivo en: ${newFilePath}`);
            console.log('   En modo compilado (exe), esto se reemplazaría automáticamente.');
            return;
        }

        const batPath = path.join(currentDir, 'update.bat');
        const batContent = `
@echo off
title Actualizando NeoManga Tools...
echo Esperando cierre de la aplicacion...

:DELETE_LOOP
timeout /t 1 /nobreak >nul
del "${exeName}" >nul 2>&1
if exist "${exeName}" (
    echo Archivo bloqueado, reintentando...
    goto DELETE_LOOP
)

echo Archivo anterior eliminado. Aplicando nueva version...
move /Y "${path.basename(newFilePath)}" "${exeName}" >nul

if exist "${exeName}" (
    echo Actualizacion exitosa. Iniciando...
    start "" "${exeName}"
) else (
    echo Error critico: No se pudo mover el nuevo archivo.
    echo Por favor descarga la actualizacion manualmente.
    pause
)

del "%~f0" & exit
`;
        
        await fs.writeFile(batPath, batContent);
        
        console.log('🔄 Reiniciando para aplicar cambios...'.green);
        
        // Ejecutar el bat desconectado del proceso actual
        const child = spawn('cmd.exe', ['/c', batPath], {
            detached: true,
            stdio: 'ignore',
            cwd: currentDir
        });
        
        child.unref();
        process.exit(0);
    }

    async promptAndRun() {
        const update = await this.check();
        
        if (update) {
            console.log(`\n🚀 Nueva versión disponible: ${update.version.green} (Actual: ${this.currentVersion})`);
            if (update.notes) console.log(`📝 Notas: ${update.notes}`);
            
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: '¿Quieres descargar e instalar la actualización ahora?',
                    default: true
                }
            ]);

            if (confirm) {
                const tempFile = 'neomanga-tools.new';
                const success = await this.download(update.url, tempFile);
                if (success) {
                    await this.applyUpdate(tempFile);
                }
            }
        }
    }
}

module.exports = new UpdaterService();
