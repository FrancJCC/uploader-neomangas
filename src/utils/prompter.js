const inquirer = require('inquirer');
const logger = require('./logger');

let currentSocket = null;

module.exports = {
    setSocket: (socket) => {
        logger.info(`🔌 [Prompter] Socket conectado: ${socket.id}`);
        currentSocket = socket;
    },

    clearSocket: (socket) => {
        if (currentSocket === socket) {
            logger.info(`🔌 [Prompter] Socket desconectado y limpiado: ${socket.id}`);
            currentSocket = null;
        } else {
            logger.info(`⚠️ [Prompter] Intento de limpiar socket diferente. Actual: ${currentSocket?.id}, A limpiar: ${socket.id}`);
        }
    },

    /**
     * Pide una confirmación (Sí/No).
     * Funciona tanto en CLI (Inquirer) como en Web (Socket.IO).
     */
    confirm: async (message, defaultValue = false) => {
        // 1. MODO WEB (Si hay un socket activo)
        if (currentSocket) {
            logger.info(`❓ [Prompter] Enviando prompt a Web (Socket ${currentSocket.id}): ${message}`);
            
            return new Promise((resolve) => {
                // Emitir evento al frontend
                currentSocket.emit('request-confirm', { 
                    message, 
                    defaultValue 
                });

                // Escuchar respuesta (una sola vez)
                const listener = (data) => {
                    resolve(!!data.result); // Asegurar booleano
                };

                // Importante: Usar .once para evitar listeners acumulados
                currentSocket.once('resolve-confirm', listener);
            });
        }

        // 2. MODO CLI (Si es una terminal interactiva)
        // Nota: process.stdout.isTTY puede fallar en ciertos entornos, así que priorizamos inquirer si no hay socket.
        try {
            const { result } = await inquirer.prompt([{
                type: 'confirm',
                name: 'result',
                message: message,
                default: defaultValue
            }]);
            return result;
        } catch (error) {
            // 3. MODO NO-INTERACTIVO (Fallback final)
            logger.warn(`⚠️ [NO-TTY] No se puede pedir input. Usando valor por defecto (${defaultValue}) para: "${message}"`);
            return defaultValue;
        }
    }
};
