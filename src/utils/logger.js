const EventEmitter = require('events');
const colors = require('colors');

class Logger extends EventEmitter {
    constructor() {
        super();
    }

    log(message, type = 'info') {
        // Emit event for Web UI (clean ANSI codes)
        // Regex to strip ANSI escape codes
        const cleanMessage = typeof message === 'string' 
            ? message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') 
            : message;

        this.emit('log', { message: cleanMessage, type, timestamp: new Date().toISOString() });

        // Print to console (CLI fallback) with colors
        if (type === 'error') console.error(message);
        else console.log(message);
    }

    info(msg) { this.log(msg, 'info'); }
    success(msg) { this.log(msg.green, 'success'); }
    warn(msg) { this.log(msg.yellow, 'warn'); }
    error(msg) { this.log(msg.red, 'error'); }
    
    // Helper para formatear títulos
    title(msg) { this.log(`\n${msg}`.cyan.bold, 'title'); }
}

module.exports = new Logger();
