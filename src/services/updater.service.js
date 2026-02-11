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
        this.currentVersion = packageJson.version;
        this.updateUrl = process.env.UPDATE_URL || DEFAULT_UPDATE_URL;
    }

    /**
     * Compara versiones semver (simple)
     * Retorna true si remote > local
     */
    isNewer(local, remote) {
        const localParts = local.split('.').map(Number);
        const remoteParts = remote.split('.').map(Number);
        
        for (let i = 0; i < 3; i++) {
            if (remoteParts[i] > localParts[i]) return true;
            if (remoteParts[i] < localParts[i]) return false;
        }
        return false;
    }

    async check() {
        try {
            // Usamos fetch nativo de Node 18
            const response = await fetch(this.updateUrl);
            if (!response.ok) return null;
            
            const data = await response.json();
            
            if (this.isNewer(this.currentVersion, data.version)) {
                return data;
            }
            return null;
        } catch (error) {
            // Silenciosamente fallar si no hay internet o url inválida
            return null;
        }
    }

    async download(url, targetPath) {
        const spinner = ora('Descargando actualización...').start();
        try {
            const response = await fetch(url);
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
echo Actualizando NeoManga Tools...
timeout /t 2 /nobreak > NUL
del "${exeName}"
move "${path.basename(newFilePath)}" "${exeName}"
start "" "${exeName}"
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
