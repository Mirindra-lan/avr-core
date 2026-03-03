const axios = require('axios');
const EventEmitter = require('events');
const logger = require('./logger');
require('dotenv').config();

/**
 * Classe Tts (Text-to-Speech)
 * Transforme le texte en audio en gérant une file d'attente séquentielle
 */
class Tts extends EventEmitter {
    constructor() {
        super();
        this.textQueue = [];        // File d'attente des textes à synthétiser
        this.isSendingText = false; // Verrou pour ne traiter qu'un texte à la fois
    }

    /**
     * Ajoute un texte à la file d'attente et lance le traitement
     * @param {string} text - La phrase à convertir en voix
     */
    async sendToTts(text) {
        this.textQueue.push(text);
        this.processTextQueue();
    }

    /**
     * Traite la file d'attente séquentiellement
     */
    async processTextQueue() {
        // Si déjà en cours ou file vide, on s'arrête
        if (this.isSendingText || this.textQueue.length === 0) {
            return;
        }

        this.isSendingText = true;
        const textToProcess = this.textQueue.shift();
        const audioChunks = [];

        try {
            const url = process.env.TTS_URL || 'http://localhost:6003/text-to-speech-stream';

            const response = await axios({
                method: 'post',
                url: url,
                data: { text: textToProcess },
                responseType: 'stream'
            });

            // Accumulation des morceaux d'audio reçus
            response.data.on('data', (chunk) => {
                audioChunks.push(chunk);
            });

            // Fin de la réception de l'audio pour cette phrase
            response.data.on('end', () => {
                const completeAudioBuffer = Buffer.concat(audioChunks);
                
                logger.info('TTS streaming complete:', completeAudioBuffer.length, 'bytes');
                
                // Émet l'audio complet pour être lu par le client
                this.emit('audio', completeAudioBuffer);
                this.emit('end');

                // Libère le verrou et passe à la phrase suivante
                this.isSendingText = false;
                this.processTextQueue();
            });

            // Gestion des erreurs pendant le flux
            response.data.on('error', (err) => {
                logger.error('Error during TTS streaming: ' + err);
                this.emit('error', err);
                this.isSendingText = false;
                this.processTextQueue();
            });

        } catch (err) {
            logger.error('Error sending text to TTS service: ' + err.message);
            this.emit('error', err);
            this.isSendingText = false;
            this.processTextQueue();
        }
    }

    /**
     * Vide la file d'attente (utile en cas d'interruption par l'utilisateur)
     */
    clearTextQueue() {
        this.textQueue = [];
        this.isSendingText = false;
    }
}

module.exports = { Tts };