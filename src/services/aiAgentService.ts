/**
 * AI Agent Service - Simplified
 * Manages KYC conversation flow with Azure backend
 */

import { websocketService } from './websocketService';

export type ConversationState = 
  | 'greeting'
  | 'asking_document'
  | 'waiting_document'
  | 'verifying_document'
  | 'asking_face'
  | 'verifying_face'
  | 'completion'
  | 'idle';

export interface AgentMessage {
  text: string;
  state: ConversationState;
  timestamp: Date;
  isError?: boolean;
}

class AIAgentService {
  private currentState: ConversationState = 'idle';
  private onMessageCallback: ((message: AgentMessage) => void) | null = null;
  private onStateChangeCallback: ((state: ConversationState) => void) | null = null;
  private sessionId: string | null = null;
  
  // Audio management
  private currentAudio: HTMLAudioElement | null = null;
  private audioQueue: string[] = [];
  private isPlayingAudio: boolean = false;
  private onAudioCompleteCallback: (() => void) | null = null;
  
  // Speech recognition
  private recognition: any = null;
  private isListening: boolean = false;
  private isInitialized: boolean = false;

  /**
   * Initialize AI agent
   */
  async initialize(sessionId: string, userId: string, mobileNumber: string): Promise<void> {
    if (this.isInitialized) {
      console.log('AI Agent already initialized');
      return;
    }

    this.sessionId = sessionId;

    try {
      await websocketService.connect();

      websocketService.onMessage((text) => {
        const message: AgentMessage = { text, state: this.currentState, timestamp: new Date() };
        this.onMessageCallback?.(message);
      });

      websocketService.onStateChange((state) => {
        this.currentState = state;
        this.onStateChangeCallback?.(state);
      });

      websocketService.onAudio((audioBase64) => {
        this.playAudio(audioBase64);
      });

      websocketService.startSession(sessionId, userId, mobileNumber);
      this.startSpeechRecognition();
      
      this.isInitialized = true;
      console.log('AI Agent initialized');
    } catch (error) {
      console.error('Failed to initialize AI agent:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Start speech recognition
   */
  private startSpeechRecognition(): void {
    if (this.isListening) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Speech recognition not supported');
      return;
    }

    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) {}
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.lang = 'en-US';

    this.recognition.onstart = () => {
      this.isListening = true;
      console.log('Listening for speech...');
    };

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript.trim();
      console.log('User said:', transcript);
      websocketService.sendText(transcript);
    };

    this.recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('Speech error:', event.error);
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        setTimeout(() => {
          if (this.isListening && this.recognition) {
            try { this.recognition.start(); } catch (e) {}
          }
        }, 100);
      }
    };

    try {
      this.recognition.start();
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }
  }

  /**
   * Stop speech recognition
   */
  private stopSpeechRecognition(): void {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
        this.recognition = null;
      } catch (e) {}
    }
  }

  /**
   * Play audio from base64
   */
  private playAudio(audioBase64: string): void {
    this.audioQueue.push(audioBase64);
    if (!this.isPlayingAudio) {
      this.playNextAudio();
    }
  }

  /**
   * Play next audio in queue
   */
  private playNextAudio(): void {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      this.onAudioCompleteCallback?.();
      return;
    }

    this.isPlayingAudio = true;
    const audioBase64 = this.audioQueue.shift()!;

    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }

    const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
    this.currentAudio = audio;

    audio.onended = () => {
      this.currentAudio = null;
      setTimeout(() => this.playNextAudio(), 500);
    };

    audio.onerror = () => {
      console.error('Audio playback error');
      this.currentAudio = null;
      this.playNextAudio();
    };

    audio.play().catch(error => {
      console.error('Audio play failed:', error);
      this.currentAudio = null;
      this.playNextAudio();
    });
  }

  /**
   * Wait for audio to complete
   */
  waitForAudioComplete(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isPlayingAudio && this.audioQueue.length === 0) {
        resolve();
        return;
      }
      this.onAudioCompleteCallback = () => {
        this.onAudioCompleteCallback = null;
        resolve();
      };
    });
  }

  /**
   * Register message callback
   */
  onMessage(callback: (message: AgentMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: ConversationState) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Get current state
   */
  getCurrentState(): ConversationState {
    return this.currentState;
  }

  /**
   * Check if audio is playing
   */
  isAudioPlaying(): boolean {
    return this.isPlayingAudio || this.audioQueue.length > 0;
  }

  /**
   * Manual document confirmation
   */
  manualConfirmDocument(): void {
    if (this.currentState === 'waiting_document' || this.currentState === 'asking_document') {
      websocketService.sendText('ready');
      websocketService.updateState('verifying_document');
    }
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.stopSpeechRecognition();
    
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    
    this.audioQueue = [];
    this.isPlayingAudio = false;
    this.currentState = 'idle';
    this.isInitialized = false;
    
    websocketService.disconnect();
  }

  /**
   * Reset
   */
  reset(): void {
    this.stop();
  }
}

export const aiAgentService = new AIAgentService();
