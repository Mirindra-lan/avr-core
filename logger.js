const { createLogger, format, transports } = require('winston');

// Création d'un logger Winston
const logger = createLogger({
    level: 'info', // Niveau minimum de log
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Ajoute un timestamp
        format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
    ),
    transports: [
        new transports.Console() // Affiche les logs dans la console
    ]
});

module.exports = logger;