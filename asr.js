const axios = require('axios');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const logger = require('./logger');
require('dotenv').config();

/**
 * Classe Asr (Automatic Speech Recognition)
 * Gère l'envoi de flux audio vers un service externe de transcription
 */
class Asr extends EventEmitter {
    constructor() {
        super();
        this.audioStream = null;     // Le flux sortant (PassThrough)
        this.responseStream = null;  // Le flux entrant venant du service ASR
    }

    /**
     * Initialise la connexion HTTP vers le service ASR externe
     * @param {string} uuid - Identifiant unique de la session
     */
    async startStreaming(uuid) {
        // Initialisation d'un nouveau flux PassThrough pour envoyer l'audio
        this.audioStream = new PassThrough();

        try {
            const url = process.env.ASR_URL || 'http://localhost:6010/speech-to-text-stream';
            
            // Requête POST en streaming vers le service ASR
            const response = await axios({
                method: 'post',
                url: url,
                headers: {
                    'Content-Type': 'audio/l16',
                    'Transfer-Encoding': 'chunked',
                    'X-UUID': uuid
                },
                data: this.audioStream, // On injecte le flux PassThrough comme corps de requête
                responseType: 'stream'
            });

            this.responseStream = response.data;

            // Ecoute des résultats de transcription (Data)
            this.responseStream.on('data', (chunk) => {
                const transcript = chunk.toString();
                logger.info('Received data from external asr service: ' + transcript);
                this.emit('transcript', transcript);
            });

            // Ecoute de la fin du flux (End)
            this.responseStream.on('end', () => {
                logger.info('Streaming complete');
                this.emit('end');
            });

            // Ecoute des erreurs du flux (Error)
            this.responseStream.on('error', (error) => {
                logger.error('Error during external service streaming: ' + error);
                this.emit('error', error);
            });

        } catch (err) {
            logger.error('Error starting streaming to external asr service: ' + err.message);
            this.emit('error', err);
        }
    }

    /**
     * Reçoit les morceaux d'audio et les écrit dans le flux de streaming
     * @param {string} uuid - Identifiant de session
     * @param {Buffer} audioBuffer - Données audio brutes
     */
    async write(uuid, audioBuffer) {
        // Si le flux n'est pas encore initialisé, on le lance
        if (!this.audioStream) {
            await this.startStreaming(uuid);
        } else {
            this.audioStream.write(audioBuffer);
        }
    }

    /**
     * Arrête proprement le flux audio
     */
    stopStreaming() {
        if (this.audioStream) {
            this.audioStream.end();
            this.audioStream = null;
            logger.info('Streaming stopped');
        }
    }
}

module.exports = { Asr };