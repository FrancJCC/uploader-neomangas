#!/usr/bin/env node
const inquirer = require('inquirer');
const colors = require('colors');
const fs = require('fs-extra');
const { connectDB, disconnectDB } = require('./src/config/database');
const env = require('./src/config/env');
const { uploadSeries } = require('./src/services/upload.service');
const { verifySeries } = require('./src/services/verify.service');
const { repairSeries } = require('./src/services/repair.service');
const { startServer } = require('./src/web/server'); // Web GUI
const path = require('path');
const updater = require('./src/services/updater.service');
const packageJson = require('./package.json');

// Disable deprecation warning for punycode
process.noDeprecation = true;

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('❌ Error no controlado (uncaughtException):'.red.bold);
    console.error(err);
    // Keep process alive if possible, but warn user
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no controlada (unhandledRejection):'.red.bold);
    console.error(reason);
});

async function getLocalSeries() {
    const dirs = await fs.readdir(env.CONTENT_DIR);
    return dirs.filter(d => fs.statSync(`${env.CONTENT_DIR}/${d}`).isDirectory());
}

async function promptSeriesSelection() {
    const series = await getLocalSeries();
    if (series.length === 0) {
        console.log('No se encontraron carpetas de series en: ' + env.CONTENT_DIR.yellow);
        return null;
    }
    
    const { selected } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selected',
            message: 'Selecciona una serie:',
            choices: series,
            pageSize: 20
        }
    ]);
    return selected;
}

async function mainMenu() {
    console.clear();
    console.log(`
 ███╗   ██╗███████╗ ██████╗     ███╗   ███╗ █████╗ ███╗   ██╗ ██████╗  █████╗ ███████╗
 ████╗  ██║██╔════╝██╔═══██╗    ████╗ ████║██╔══██╗████╗  ██║██╔════╝ ██╔══██╗██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║    ██╔████╔██║███████║██╔██╗ ██║██║  ███╗███████║███████╗
 ██║╚██╗██║██╔══╝  ██║   ██║    ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║╚════██║
 ██║ ╚████║███████╗╚██████╔╝    ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║███████║
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝     ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝


    `.cyan.bold);
        console.log(`
 ██████╗ ███████╗███╗   ███╗ ██████╗ ███╗   ██╗██████╗ ██╗      █████╗  ██████╗██╗  ██╗
 ██╔══██╗██╔════╝████╗ ████║██╔═══██╗████╗  ██║██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝
 ██║  ██║█████╗  ██╔████╔██║██║   ██║██╔██╗ ██║██████╔╝██║     ███████║██║     █████╔╝ 
 ██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══██╗██║     ██╔══██║██║     ██╔═██╗ 
 ██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██████╔╝███████╗██║  ██║╚██████╗██║  ██╗
 ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
              /\_/\ 
             ( ◣_◢ )
              > ^ <
    `.cyan.bold);
    console.log(` v2.3.0 - GUI & CLI`.white.dim);
    console.log(` 📂 Origen: ${env.CONTENT_DIR}`.gray);
    console.log('');

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Selecciona modo:',
            choices: [
                { name: 'Modo Gráfico (Web GUI)', value: 'gui' },
                new inquirer.Separator(),
                { name: 'Cambiar Carpeta de Origen', value: 'change_dir' },
                new inquirer.Separator(),
                { name: 'Subir TODO (Upload All)', value: 'upload_all' },
                { name: 'Subir Serie Específica', value: 'upload_one' },
                new inquirer.Separator(),
                { name: 'Verificar TODO', value: 'verify_all' },
                { name: 'Verificar Serie Específica', value: 'verify_one' },
                new inquirer.Separator(),
                { name: 'Reparar Serie Específica', value: 'repair_one' },
                new inquirer.Separator(),
                { name: 'Salir', value: 'exit' }
            ]
        }
    ]);

    return action;
}

async function run() {
    // Check for updates before anything else
    try {
        await updater.promptAndRun();
    } catch (e) {
        // Ignore update errors
    }

    // Check arguments for auto-gui
    const args = process.argv.slice(2);
    if (args.includes('--gui') || args.includes('-g')) {
        await startServer();
        return; // Server keeps running
    }

    await connectDB();
    
    let loop = true;
    while (loop) {
        try {
            const action = await mainMenu();
            
            if (action === 'exit') {
                loop = false;
                break;
            }

            if (action === 'gui') {
                await disconnectDB(); // GUI handles its own connection
                await startServer();
                return; // Server takes over
            }

            if (action === 'upload_all') {
                const series = await getLocalSeries();
                console.log(`\nIniciando carga de ${series.length} series...`.green);
                for (const s of series) {
                    await uploadSeries(s);
                }
            } else if (action === 'change_dir') {
                const { newDir } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'newDir',
                        message: 'Ingresa la nueva ruta absoluta de la carpeta de Mangas:',
                        default: env.CONTENT_DIR,
                        validate: (input) => {
                            if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
                                return true;
                            }
                            return 'La ruta no existe o no es un directorio válido.';
                        }
                    }
                ]);
                env.CONTENT_DIR = newDir;
                console.log(`✅ Carpeta de origen actualizada a: ${env.CONTENT_DIR}`.green);
            } else if (action === 'upload_one') {
                const s = await promptSeriesSelection();
                if (s) await uploadSeries(s);
            } else if (action === 'verify_all') {
                const series = await getLocalSeries();
                for (const s of series) {
                    await verifySeries(s);
                }
            } else if (action === 'verify_one') {
                const s = await promptSeriesSelection();
                if (s) await verifySeries(s);
            } else if (action === 'repair_one') {
                const s = await promptSeriesSelection();
                if (s) await repairSeries(s);
            }

            if (loop) {
                console.log('\n----------------------------------------'.gray);
                await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona ENTER para volver al menú...' }]);
            }

        } catch (error) {
            console.error('\n❌ Error Inesperado:'.red, error);
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona ENTER para continuar...' }]);
        }
    }

    await disconnectDB();
    console.log('¡Hasta luego! 👋'.rainbow);
    process.exit(0);
}

run();
