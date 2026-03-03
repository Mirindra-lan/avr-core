const net = require('net');
const { ClientHandler } = require('./clientHandler');
const logger = require('./logger');

/**
 * Calcule la durée écoulée depuis un point donné en secondes
 * @param {number} startTime - Résultat de performance.now()
 * @returns {string} Durée formatée avec 2 décimales
 */
function calculateDurationInSeconds(startTime) {
    const durationMs = performance.now() - startTime;
    return (durationMs / 1000).toFixed(2);
}

// Création du serveur TCP
const server = net.createServer((socket) => {
    logger.info('Client connected');
    
    const startTime = performance.now();
    const handler = new ClientHandler(socket);

    // Événement déclenché lors de la déconnexion du client
    handler.on('disconnect', () => {
        const duration = calculateDurationInSeconds(startTime);
        logger.info(`Client connection duration: ${duration} seconds`);
    });

    // Événement déclenché en cas d'erreur au niveau du handler
    handler.on('error', (err) => {
        logger.error('Handling socket error: ' + err);
        const duration = calculateDurationInSeconds(startTime);
        logger.info(`Client connection duration: ${duration} seconds`);
    });
});

// Définition du port (via variable d'environnement ou 5001 par défaut)
const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
    logger.info('Server listening on port ' + PORT);
});

// Gestion des erreurs globales du serveur
server.on('error', (err) => {
    logger.error('Server error: ' + err);
});