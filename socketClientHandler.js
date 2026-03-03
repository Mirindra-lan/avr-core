const EventEmitter = require('events');
const WebSocket = require('ws');
const logger = require('./logger');
require('dotenv').config();

/**
 * Classe StsWs (Speech-to-Speech via WebSocket)
 * Gère la communication temps réel avec le service STS via WebSockets
 */
class StsWs extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
    }

    /**
     * Initialise la connexion WebSocket
     * @param {string} uuid - Identifiant unique de la session
     */
    async startStreaming(uuid) {
        logger.info('Starting streaming to STS WS: ' + uuid);
        
        try {
            const url = process.env.STS_URL;
            if (!url) {
                throw new Error('STS_URL environment variable is not set');
            }

            logger.info('Connecting to STS WebSocket: ' + url);
            this.ws = new WebSocket(url);

            // Événement : Connexion ouverte
            this.ws.on('open', () => {
                logger.info('STS WebSocket connection opened');
                // Envoi du message d'initialisation avec l'UUID
                this.ws.send(JSON.stringify({
                    type: 'init',
                    uuid: uuid
                }));
            });

            // Événement : Message reçu du serveur
            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());

                    switch (message.type) {
                        case 'interruption':
                            // L'IA a détecté que l'utilisateur a coupé la parole
                            this.emit('interruption');
                            break;

                        case 'transcript':
                            // Réception d'une transcription textuelle intermédiaire
                            logger.info(`[${message.role}]: ${message.text}`);
                            break;

                        case 'audio':
                            // Réception de données audio (encodées en base64 dans le JSON)
                            const audioBuffer = Buffer.from(message.audio, 'base64');
                            this.emit('audio', audioBuffer);
                            break;

                        case 'error':
                            this.emit('error', message.error);
                            break;

                        default:
                            logger.warn('Unknown message type from STS WebSocket: ' + message.type);
                            break;
                    }
                } catch (err) {
                    logger.error('Failed to parse message from STS WebSocket: ' + err);
                    this.emit('error', err);
                }
            });

            // Événement : Erreur réseau
            this.ws.on('error', (err) => {
                logger.error('STS WebSocket error: ' + err);
                this.emit('error', err);
            });

            // Événement : Fermeture de connexion
            this.ws.on('close', (code, reason) => {
                logger.info(`STS WebSocket connection closed: ${code} ${reason.toString()}`);
                this.emit('end');
            });

        } catch (err) {
            logger.error('Failed to start STS WebSocket streaming:', err);
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * Envoie l'audio vers le serveur STS
     * @param {string} uuid - Identifiant de session
     * @param {Buffer} audioBuffer - Données audio brutes
     */
    async processAudio(uuid, audioBuffer) {
        if (this.ws) {
            // Vérifie que la connexion est bien ouverte avant d'envoyer
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'audio',
                    audio: audioBuffer.toString('base64')
                }));
            }
        } else {
            // Si pas de connexion, on tente de l'initialiser
            logger.warn('Start streaming to STS WS');
            await this.startStreaming(uuid);
        }
    }

    /**
     * Ferme proprement la connexion
     */
    stopStreaming() {
        logger.info('Stopping streaming to STS WS');
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

module.exports = { StsWs };