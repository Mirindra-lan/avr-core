const { EventEmitter } = require('events');
const { toUUID } = require('to-uuid');
const alawmulaw = require('alawmulaw');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Import des modules locaux
const { VAD } = require('./vad');
const { Asr } = require('./asr');
const { Llm } = require('./llm');
const { Tts } = require('./tts');
const { Sts } = require('./sts');
// const { StsWs } = require('./stsws');
const logger = require('./logger');

// Constantes de protocole
const TERMINATE_PACKET = 0x00;
const UUID_PACKET = 0x01;
const AUDIO_PACKET = 0x10;
const ERROR_PACKET = 0xff;
const TERMINATE_PACKET_LENGTH = 3;
const MAX_CHUNK_SIZE = 320; // 0x140

class ClientHandler extends EventEmitter {
    constructor(socket) {
        super();
        this.buffer = Buffer.alloc(0);
        this.socket = socket;
        this.uuid = null;
        this.messages = [];
        this.audioQueue = [];
        this.isSendingAudio = false;
        this.stoppingAudio = false;

        // Initialisation des moteurs
        this.asr = new Asr();
        this.llm = new Llm();
        this.tts = new Tts();

        // Choix du moteur STS (WebSocket ou Standard)
        const stsUrl = process.env.STS_URL;
        if (stsUrl && stsUrl.startsWith('ws')) {
            this.sts = new StsWs();
        } else {
            this.sts = new Sts();
        }

        this.vad = new VAD();
        this.ambientNoiseBuffer = null;
        this.ambientNoiseIndex = 0;

        this.setupSocket();
        this.setupEvents();
        this.loadAmbientNoise();
    }

    /**
     * Configuration des écouteurs du socket client
     */
    setupSocket() {
        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('close', this.handleSocketDisconnect.bind(this));
        this.socket.on('error', this.handleError.bind(this));
    }

    /**
     * Liaison des événements entre les différents services (ASR -> LLM -> TTS)
     */
    setupEvents() {
        // ASR vers LLM
        this.asr.on('transcript', this.handleTranscript.bind(this));
        this.asr.on('end', () => logger.info('ASR streaming ended'));
        this.asr.on('error', (err) => this.handleAsrError(err));

        // LLM vers TTS
        this.llm.on('text', this.handleLlmText.bind(this));
        this.llm.on('audio', this.handleLlmAudio.bind(this));
        this.llm.on('end', () => logger.info('LLM streaming ended'));
        this.llm.on('error', (err) => this.handleLlmError(err));

        // TTS vers Sortie Audio
        this.tts.on('audio', this.handleTtsAudio.bind(this));
        this.tts.on('end', () => logger.info('TTS streaming ended'));
        this.tts.on('error', (err) => this.handleTtsError(err));

        // STS (Speech to Speech)
        this.sts.on('audio', this.handleStsAudio.bind(this));
        this.sts.on('interruption', this.handleStsInterruption.bind(this));
        this.sts.on('end', this.handleStsEnd.bind(this));
        this.sts.on('error', this.handleStsError.bind(this));

        // VAD (Voice Activity Detection)
        this.vad.on('speechStart', this.handleVadSpeechStart.bind(this));
        this.vad.on('speechEnd', this.handleVadSpeechEnd.bind(this));
    }

    processPacket(type, length, data) {
        switch(type) {
        case TERMINATE_PACKET:
            this.handleTerminatePacket();
            break;
        case UUID_PACKET:
            this.handleUuidPacket(data, length);
            break;
        case AUDIO_PACKET:
            this.handleAudioPacket(data, length);
            break;
        case ERROR_PACKET:
            this.handleErrorPacket(data, length);
            break;
        default:
            logger.error('Unknown packet type: ' + type);
            break;
    }
    }
    /**
     * Analyse des paquets entrants selon le protocole binaire
     */
    async handleData(data) {
        // 1️⃣ Ajoute les nouveaux octets au buffer
        this.buffer = Buffer.concat([this.buffer, data]);

        // 2️⃣ Boucle tant qu’on a au moins un header
        while (this.buffer.length >= TERMINATE_PACKET_LENGTH) { // 3 = taille du header
            const type = this.buffer.readUInt8(0);
            const length = this.buffer.readUInt16BE(1);

            // On attend d’avoir tout le payload
            if (this.buffer.length < TERMINATE_PACKET_LENGTH + length) break;

            // Extraction du paquet complet
            const packet = this.buffer.slice(0, TERMINATE_PACKET_LENGTH + length);

            // Mise à jour du buffer
            this.buffer = this.buffer.slice(TERMINATE_PACKET_LENGTH + length);

            // 3️⃣ Traitement du paquet
            this.processPacket(type, length, packet);
        }
    }

    handleErrorPacket(data, length) {
        logger.error(`Error packet received: ${data}, ${length}`);
    }
    
    async handleUuidPacket(data, length) {
        this.uuid = toUUID(data.slice(TERMINATE_PACKET_LENGTH, TERMINATE_PACKET_LENGTH + length).toString('hex'));
        // this.uuid = uuid
        logger.info('UUID packet received: ' + this.uuid);
        
        await this.vad.initialize();
        this.startAudioProcessing();

        if (process.env.SYSTEM_MESSAGE) {
            logger.info('Sends transcript from ASR to LLM: ' + process.env.SYSTEM_MESSAGE);
            this.handleLlmText(process.env.SYSTEM_MESSAGE);
            // this.handleLlmText("Salut, je vais traiter vos requetes")
        } else {
            const welcomeMsg = {
                'role': 'system',
                'content': 'You are ' + (process.env.SYSTEM_NAME || 'an AI assistant') + '. You must introduce yourself quickly and concisely.'
            };
            this.messages.push(welcomeMsg);
        }
    }

    async handleAudioPacket(data, length) {
        let audioBuffer = data.slice(TERMINATE_PACKET_LENGTH, TERMINATE_PACKET_LENGTH + length);

        // Décodage mulaw si nécessaire (basé sur la taille arbitraire de 160)
        if (audioBuffer.length <= 160) {
            const decoded = alawmulaw.mulaw.decode(audioBuffer);
            audioBuffer = Buffer.from(decoded.buffer);
        }

        if (process.env.STS_URL) {
            this.sts.write(this.uuid, audioBuffer);
        } else if (process.env.INTERRUPT_LISTENING === 'true') {
            this.stoppingAudio ? this.asr.stopStreaming() : this.asr.write(this.uuid, audioBuffer);
        } else {
            await this.vad.write(audioBuffer);
            this.asr.write(this.uuid, audioBuffer);
        }
    }

    handleTerminatePacket() {
        this.log('Terminate packet received')
        this.interruptAudioOutput();
        this.asr.stopStreaming();
        this.tts.clearTextQueue();
        this.sts.stopStreaming();
        this.vad.reset();
    }

    /**
     * Boucle principale de traitement audio (Timing haute précision)
     */
    async startAudioProcessing() {
        const frameDurationNs = BigInt(20000000); // 20ms en nanosecondes
        let nextTick = process.hrtime.bigint();

        const audioLoop = async () => {
            while (!this.socket.destroyed) {
                const now = process.hrtime.bigint();
                
                if (now < nextTick) {
                    const waitMs = Number((nextTick - now) / BigInt(1000000));
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                }

                let chunk;
                if (this.audioQueue.length > 0) {
                    chunk = this.audioQueue.shift();
                    this.isSendingAudio = true;
                } else {
                    chunk = this.generateNaturalSilence(MAX_CHUNK_SIZE);
                    this.isSendingAudio = false;
                }

                await this.sendAudioPacket(chunk);
                nextTick += frameDurationNs;
            }
        };

        audioLoop().catch(err => {
            logger.error('Errore nel loop audio:', err);
            this.handleTerminatePacket();
        });
    }

    async sendAudioPacket(audioData) {
        let payload = audioData;

        // Compléter avec du silence si le chunk est trop petit
        if (audioData.length < MAX_CHUNK_SIZE) {
            const silence = this.generateNaturalSilence(MAX_CHUNK_SIZE - audioData.length);
            payload = Buffer.concat([audioData, silence]);
        }

        const header = Buffer.alloc(3);
        header.writeUInt8(AUDIO_PACKET, 0);
        header.writeUInt16BE(payload.length, 1);

        const packet = Buffer.concat([header, payload]);

        if (this.socket.writable && !this.stoppingAudio) {
            if (!this.socket.write(packet)) {
                await new Promise(resolve => this.socket.once('drain', resolve));
            }
        }
    }

    normalizeChunks(buffer) {
        const chunks = [];
        for (let i = 0; i < buffer.length; i += MAX_CHUNK_SIZE) {
            let chunk = buffer.slice(i, i + MAX_CHUNK_SIZE);
            if (chunk.length < MAX_CHUNK_SIZE) {
                const padding = this.generateNaturalSilence(MAX_CHUNK_SIZE - chunk.length);
                chunk = Buffer.concat([chunk, padding]);
            }
            chunks.push(chunk);
        }
        return chunks;
    }

    // Gestionnaires de flux
    handleTranscript(text) {
        this.interruptAudioOutput();
        this.messages.push({ role: 'user', content: text });
        this.log('Sends transcript from ASR to LLM: ' + text)
        this.llm.sendToLlm(this.uuid, text, this.messages);
    }

    handleAsrError(err) {
        logger.error('Error during streaming to ASR: ' + err.message);
        this.handleTerminatePacket();
        this.emit('error', err);
    }

    handleLlmText(text) {
        this.messages.push({ role: 'assistant', content: text });
        this.log('Sends text from LLM to TTS: ' + text)
        this.tts.sendToTts(text);
    }

    handleLlmAudio(audio) {
        const chunks = this.normalizeChunks(audio);
        this.audioQueue.push(...chunks);
    }

    handleLlmError(err) {
        logger.error('Error during streaming to LLM: ' + err.message);
        this.handleTerminatePacket();
        this.emit('error', err);
    }

    handleTtsAudio(audio) {
        this.stoppingAudio = false;
        const chunks = this.normalizeChunks(audio);
        this.audioQueue.push(...chunks);
    }

    handleStsAudio(audio) {
        const chunks = this.normalizeChunks(audio);
        this.audioQueue.push(...chunks);
    }

    handleStsInterruption() {
        this.log('STS streaming interrupted')
        this.audioQueue = [];
    }

    handleStsEnd() {
        this.log('STS streaming ended')
        this.handleTerminatePacket();
    }

    handleStsError(err) {
        logger.error('Error during streaming to STS: ' + err.message);
        this.handleTerminatePacket();
        this.emit('error', err);
    }

    handleTtsError(err) {
        logger.error('Error during streaming to TTS: ' + err.message);
        this.handleTerminatePacket();
        this.emit('error', err);
    }

    handleVadSpeechStart() {
        this.log('[VAD] Speech detection started - interrupting audio output')
        this.interruptAudioOutput();
    }

    handleVadSpeechEnd() {
        this.log('[VAD] Speech detection ended')
        this.vad.reset();
    }

    handleSocketDisconnect() {
        this.log('Socket Client disconnected')
        this.handleTerminatePacket();
        this.emit('disconnect');
    }

    handleError(err) {
        if (err instanceof AggregateError) {
            err.errors.forEach(e => logger.error('Socket error: ' + e.message));
        } else {
            logger.error('Socket error: ' + err.message);
        }
        this.handleTerminatePacket();
        this.emit('error', err);
    }

    /**
     * Arrête la sortie audio en cours et vide la file
     */
    interruptAudioOutput() {
        this.stoppingAudio = true;
        this.tts.clearTextQueue();
        this.audioQueue = [];
        this.isSendingAudio = false;
    }

    /**
     * Génère du silence ou du bruit ambiant
     */
    generateNaturalSilence(size) {
        if (this.ambientNoiseBuffer && size >= 320) {
            return this.generateAmbientNoiseFromFile(size);
        }
        const buffer = Buffer.alloc(size);
        buffer.fill(0);
        return buffer;
    }

    generateAmbientNoiseFromFile(size) {
        const noise = Buffer.alloc(size);
        const level = parseFloat(process.env.AMBIENT_NOISE_LEVEL) || 0.9;

        for (let i = 0; i < size; i += 2) {
            if (this.ambientNoiseIndex >= this.ambientNoiseBuffer.length - 1) {
                this.ambientNoiseIndex = 0;
            }
            const sample = this.ambientNoiseBuffer.readInt16LE(this.ambientNoiseIndex);
            const adjustedSample = Math.floor(sample * level);
            noise.writeInt16LE(adjustedSample, i);
            this.ambientNoiseIndex += 2;
        }
        return noise;
    }

    loadAmbientNoise() {
        if (process.env.AMBIENT_NOISE_FILE) {
            const filePath = path.join(__dirname, process.env.AMBIENT_NOISE_FILE);
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath);
                this.ambientNoiseBuffer = Buffer.from(data);
                this.log('Loaded ambient noise from file: ' + process.env.AMBIENT_NOISE_FILE)
            } else {
                logger.warn('Ambient noise file not found at: ' + filePath + '. Falling back to algorithmic noise.');
            }
        } else {
            logger.warn('AMBIENT_NOISE_FILE environment variable not set. Ambient noise disabled.');
        }
    }
    log(message) {
        this.uuid == null ? logger.info(`[UUID not defined] ${message}`)
        : logger.info(`[${this.uuid}] ${message}`)
    }
}

module.exports = { ClientHandler };