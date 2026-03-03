const axios = require('axios');
const { PassThrough } = require('stream');
const EventEmitter = require('events');
const logger = require('./logger');
require('dotenv').config();

/**
 * Classe Sts (Speech-to-Speech)
 * Gère le streaming audio bidirectionnel vers un service STS externe
 */
class Sts extends EventEmitter {
    constructor() {
        super();
        this.stream = null;         // Flux audio sortant (votre voix)
        this.responseStream = null; // Flux audio entrant (voix transformée)
    }

    /**
     * Initialise la connexion en streaming vers le service STS
     * @param {string} uuid - Identifiant de la session
     */
    async startStreaming(uuid) {
        this.stream = new PassThrough();

        try {
            const url = process.env.STS_URL || 'http://localhost:6030/speech-to-speech-stream';

            const response = await axios({
                method: 'post',
                url: url,
                headers: {
                    'Content-Type': 'audio/l16',
                    'Transfer-Encoding': 'chunked',
                    'X-UUID': uuid
                },
                data: this.stream, // Envoi du flux en temps réel
                responseType: 'stream'
            });

            this.responseStream = response.data;

            // Réception de l'audio transformé
            this.responseStream.on('data', (audioChunk) => {
                this.emit('audio', audioChunk);
            });

            // Fin du flux
            this.responseStream.on('end', () => {
                logger.info('Streaming complete');
                this.emit('end');
            });

            // Gestion des erreurs de flux
            this.responseStream.on('error', (err) => {
                logger.error('Error during external service streaming: ' + err);
                this.emit('error', err);
            });

        } catch (err) {
            logger.error('Error starting streaming to external asr service: ' + err.message);
            this.emit('error', err);
        }
    }

    /**
     * Écrit les données audio dans le flux STS
     * @param {string} uuid - Identifiant de session
     * @param {Buffer} audioBuffer - Buffer audio brut
     */
    async processAudio(uuid, audioBuffer) {
        if (!this.stream) {
            await this.startStreaming(uuid);
        } else {
            this.stream.write(audioBuffer);
        }
    }

    /**
     * Arrête le streaming proprement
     */
    stopStreaming() {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
            logger.info('Streaming stopped');
        }
    }
}

module.exports = { Sts };