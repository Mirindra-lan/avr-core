const axios = require('axios');
const EventEmitter = require('events');
const logger = require('./logger');
require('dotenv').config();

/**
 * Classe Llm
 * Gère l'interaction avec le service d'intelligence artificielle
 */
class Llm extends EventEmitter {
    constructor() {
        super();
        // Stocke les fragments de texte en attendant d'avoir une phrase complète
        this.accumulatedContent = '';
        this.uuid = null;
    }

    /**
     * Envoie une requête au service LLM et traite la réponse en flux (stream)
     * @param {string} uuid - ID de session
     * @param {string} userMessage - Message de l'utilisateur
     * @param {Array} history - Historique de la conversation
     */
    async sendToLlm(uuid, userMessage, history) {
        try {
            const url = process.env.LLM_URL || 'http://localhost:6009/prompt-stream';
            this.uuid = uuid
            const response = await axios({
                method: 'post',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: {
                    uuid: uuid,
                    message: userMessage,
                    messages: history
                },
                responseType: 'stream'
            });

            // Traitement du flux de données entrant
            response.data.on('data', (chunk) => {
                const rawData = chunk.toString();
                this.log('Received data from LLM service: ' + rawData)

                try {
                    const parsed = JSON.parse(rawData);

                    if (parsed.type === 'text') {
                        this.handleText(parsed.content);
                    } else if (parsed.type === 'audio') {
                        this.handleAudio(parsed.audio);
                    } else {
                        logger.error('Unknown data type: ' + parsed.type);
                    }
                } catch (err) {
                    logger.error('Error parsing LLM service response: ' + err);
                    this.emit('error', err);
                }
            });

            // Fin du flux
            response.data.on('end', () => {
                
                logger.info('LLM streaming complete');
                
                // Si du texte reste dans le tampon à la fin, on le nettoie et on l'envoie
                if (this.accumulatedContent) {
                    const cleaned = this.cleanText(this.accumulatedContent);
                    logger.info('Cleaned text content on end');
                    this.emitCompleteSentences(cleaned);
                    this.accumulatedContent = '';
                }
                this.emit('end');
            });

            response.data.on('error', (err) => {
                logger.error('Error during LLM streaming: ' + err);
                this.emit('error', err);
            });

        } catch (err) {
            logger.error('Error sending data to LLM service: ' + err.message);
            this.emit('error', err);
        }
    }

    /**
     * Gère la réception de fragments de texte et découpe en phrases
     */
    handleText(text) {
        this.log('Handling text content: ' + text)
        this.accumulatedContent += text;

        // On ignore ce qui se trouve entre les balises de réflexion/système (ex: <think>...</think>)
        let tempContent = this.accumulatedContent.replace(/<think>.*<\/think>/g, '');
        
        // Recherche des phrases complètes (se terminant par . ! ou ?)
        const sentences = tempContent.match(/[^.!?]*[.!?]/g);

        if (sentences) {
            sentences.forEach(sentence => {
                const cleanedSentence = this.cleanText(sentence);
                this.log('Cleaned text content: ' + cleanedSentence)
                this.emit('text', cleanedSentence);
            });

            // Mise à jour du tampon pour ne garder que le résidu (la phrase en cours)
            let remaining = this.accumulatedContent;
            remaining = remaining.replace(/<think>.*<\/think>/g, '');
            remaining = remaining.replace(/[^.!?]*[.!?]/g, '');
            this.accumulatedContent = remaining;
        }
    }

    /**
     * Émet les phrases complètes à partir d'un bloc de texte
     */
    emitCompleteSentences(text) {
        const sentences = text.match(/[^.!?]*[.!?]/g);
        if (sentences) {
            sentences.forEach(sentence => {
                this.log('Emitting complete sentence: ' + sentence)
                this.emit('text', sentence);
            });
        }
    }

    /**
     * Gère les morceaux d'audio si l'IA répond directement en audio
     */
    handleAudio(audioChunk) {
        this.log('Handling audio chunk: ' + audioChunk)
        this.emit('audio', audioChunk);
    }

    /**
     * Nettoie le texte des caractères spéciaux, emojis et formatage Markdown
     */
    cleanText(text) {
        return text
            .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{M}\s]/gu, '') // Supprime emojis/symboles bizarres
            .replace(/\*+/g, '')                             // Supprime le gras/italique Markdown
            .replace(/\n+/g, ' ')                            // Remplace sauts de ligne par espaces
            .replace(/#+/g, '')                              // Supprime les titres Markdown
            .trim();
    }
    log(message) {
        this.uuid == null ? logger.info(`[UUID not defined] ${message}`)
        : logger.info(`[${this.uuid}] ${message}`)
    }
}

module.exports = { Llm };