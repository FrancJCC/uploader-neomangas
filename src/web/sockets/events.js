const fs = require('fs-extra');
const env = require('../../config/env');
const logger = require('../../utils/logger');
const prompter = require('../../utils/prompter');
const { uploadSeries } = require('../../services/upload.service');
const { verifySeries } = require('../../services/verify.service');
const { repairSeries } = require('../../services/repair.service');

module.exports = (io) => {
    io.on('connection', (socket) => {
        // Registrar este socket como el activo para prompts
        prompter.setSocket(socket);

        // Subscribe to logger events
        const logHandler = (data) => {
            socket.emit('log', data);
        };
        logger.on('log', logHandler);

        socket.on('disconnect', () => {
            logger.removeListener('log', logHandler);
            prompter.clearSocket(socket);
        });

        // Commands
        socket.on('start-upload', async ({ series }) => {
            prompter.reset(); // Resetear respuestas automáticas al inicio
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
            prompter.reset(); // Resetear respuestas automáticas al inicio
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
            prompter.reset(); // Resetear respuestas automáticas al inicio
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

        // Listen for input responses
        socket.on('resolve-confirm', (data) => {
            prompter.resolveConfirm(data.result);
        });
    });
};
