# Agent Voice Response (AVR) Core #
Agent Voice Response is a real-time AI voice system that handles live audio calls, transcribes speech, generates intelligent responses using large language models, and converts replies back into natural-sounding speech to enable seamless, automated voice conversations over telephony, SIP, or web-based audio connections

## Overview ##
AVR Core manages real-time voice communication between customers and a VoIP PBX system (like Asterisk) and interacts with various AI services:

1. ASR (Automatic Speech Recognition): Transcribes the incoming audio stream from the customer into text.
2. LLM (Large Language Model): Interprets the text and generates an appropriate response.
3. TTS (Text-to-Speech): Converts the generated text response back into speech, which is then played to the customer.

AVR Core is designed to be flexible, allowing users to integrate any ASR, LLM, and TTS services by interacting via HTTP API Streams. This modularity allows you to develop your own middleware between AVR Core and the services of your choice.

## Work flow ##
1. Audio Input
The client (microphone, SIP, Asterisk, or custom TCP/WebSocket client) streams live audio to AVR-Core.
Supports TCP sockets and WebSocket connections for flexible integration.

2. Speech-to-Text (ASR)
The incoming audio is sent to an Automatic Speech Recognition (ASR) service.
Converts spoken words into text in real time.
.env: **ASR_URL=http://localhost:6001/speech-to-text-stream**

3. Text Processing (LLM)
The transcribed text is sent to a Large Language Model (LLM).
The LLM analyzes the text, understands context, and generates an intelligent response.
.env: **LLM_URL=http://localhost:6001/prompt-stream**

4. Text-to-Speech (TTS)
The LLM’s text response is converted back into audio using a Text-to-Speech engine.
Produces natural-sounding speech ready for streaming.
.env: **TTS_URL=http://localhost:6001/to-text-speech-stream**

5. Audio Output
The generated audio is streamed back to the client over TCP or WebSocket.
Enables low-latency, bidirectional voice interaction.