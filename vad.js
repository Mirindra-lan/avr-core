const { RealTimeVAD } = require('avr-vad');
const { EventEmitter } = require('events');
const logger = require('./logger');

const FRAME_SIZE = 512; // 0x200

/**
 * Classe VAD (Voice Activity Detection)
 * Détecte la présence de parole humaine dans un flux audio
 */
class VAD extends EventEmitter {
    constructor() {
        super();
        this.vad = null;
        this.buffer = new Float32Array(FRAME_SIZE);
        this.bufferIndex = 0;
        this.frameCount = 0;
        this.lastProbabilities = [];
    }

    /**
     * Initialise le modèle VAD avec les paramètres de sensibilité
     */
    async initialize() {
        try {
            this.vad = await RealTimeVAD.new({
                positiveSpeechThreshold: process.env.VAD_POSITIVE_SPEECH_THRESHOLD || 0.08,
                negativeSpeechThreshold: process.env.VAD_NEGATIVE_SPEECH_THRESHOLD || 0.03,
                minSpeechFrames: process.env.VAD_MIN_SPEECH_FRAMES || 3,
                preSpeechPadFrames: process.env.VAD_PRE_SPEECH_PAD_FRAMES || 3,
                redemptionFrames: process.env.VAD_REDEMPTION_FRAMES || 8,
                frameSamples: process.env.VAD_FRAME_SAMPLES || 512,
                sampleRate: 8000, // 0x1f40
                model: process.env.VAD_MODEL || 'v5',
                
                // Callback à chaque frame traitée
                onFrameProcessed: (probs, isSpeech) => {
                    this.frameCount++;
                    const isPositive = probs.isSpeech >= 0.08;
                    
                    // Suivi des dernières probabilités pour détecter une corruption
                    this.lastProbabilities.push(probs.isSpeech);
                    if (this.lastProbabilities.length > 20) {
                        this.lastProbabilities.shift();
                    }

                    logger.debug(`Frame ${this.frameCount}: Prob=${probs.isSpeech.toFixed(4)}, Speech=${isPositive}`);

                    // Sécurité : si la probabilité moyenne tombe trop bas, on reset le modèle
                    if (this.frameCount > 50) {
                        const avgProb = this.lastProbabilities.reduce((a, b) => a + b, 0) / this.lastProbabilities.length;
                        if (avgProb < 0.001) {
                            logger.warn('Detected model corruption - resetting');
                            this.reset();
                        }
                    }
                },
                
                onSpeechStart: () => {}, // Non utilisé ici
                
                // Détection réelle du début de parole
                onSpeechRealStart: () => {
                    this.emit('speechStart');
                },
                
                // Détection de la fin de parole (silence détecté)
                onSpeechEnd: (audioBuffer) => {
                    this.emit('speechEnd', audioBuffer);
                }
            });

            this.vad.start();
        } catch (err) {
            logger.error('Failed to initialize VAD:', err);
        }
    }

    /**
     * Reçoit l'audio brut (Int16) et le convertit pour le modèle (Float32)
     * @param {Buffer} audioChunk - Audio venant du socket
     */
    async processAudio(audioChunk) {
        // Conversion Buffer (Uint8) -> Int16Array
        const int16Array = new Int16Array(audioChunk.buffer);
        let offset = 0;

        while (offset < int16Array.length) {
            const spaceInBuffer = FRAME_SIZE - this.bufferIndex;
            const remainingInput = int16Array.length - offset;
            const samplesToCopy = Math.min(spaceInBuffer, remainingInput);

            // Conversion Int16 (-32768, 32767) -> Float32 (-1.0, 1.0)
            for (let i = 0; i < samplesToCopy; i++) {
                this.buffer[this.bufferIndex + i] = int16Array[offset + i] / 32768.0;
            }

            this.bufferIndex += samplesToCopy;
            offset += samplesToCopy;

            // Une fois le buffer de 512 samples plein, on le donne au modèle VAD
            if (this.bufferIndex >= FRAME_SIZE) {
                try {
                    if (this.vad) {
                        await this.vad.processAudio(this.buffer);
                    }
                } catch (err) {
                    logger.error('Error processing frame:', err);
                }
                // Réinitialisation du buffer local
                this.buffer = new Float32Array(FRAME_SIZE);
                this.bufferIndex = 0;
            }
        }
    }

    /**
     * Réinitialise l'état du VAD
     */
    async reset() {
        try {
            if (this.vad) {
                this.vad.reset();
                this.frameCount = 0;
                this.lastProbabilities = [];
            }
        } catch (err) {
            logger.error('Error resetting VAD:', err);
        }
    }

    /**
     * Détruit proprement l'instance
     */
    async destroy() {
        if (this.vad) {
            await this.vad.flush();
            this.vad.destroy();
        }
    }
}

module.exports = { VAD };