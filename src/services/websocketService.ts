/**
 * WebSocket Service - Connects to AI Agent Backend
 */

import { ConversationState } from './aiAgentService';

export interface WSMessage {
  type: string;
  sessionId?: string;
  data?: any;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private messageCallbacks: ((message: any) => void)[] = [];
  private stateCallbacks: ((state: ConversationState) => void)[] = [];
  private audioCallbacks: ((audioBase64: string) => void)[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private backendUrl: string;

  constructor(backendUrl: string = 'ws://localhost:3001') {
    this.backendUrl = backendUrl;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.backendUrl);

        this.ws.onopen = () => {
          console.log('✅ Connected to AI Agent Backend');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('📨 Received from backend:', message.type);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('🔌 WebSocket connection closed');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        this.connect().catch(console.error);
      }, 2000 * this.reconnectAttempts);
    } else {
      console.error('❌ Max reconnect attempts reached');
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'agent_response':
        // Notify message callbacks
        this.messageCallbacks.forEach(cb => cb(message.data.text));
        
        // Notify state callbacks
        if (message.data.state) {
          this.stateCallbacks.forEach(cb => cb(message.data.state));
        }
        
        // Notify audio callbacks
        if (message.data.audio) {
          this.audioCallbacks.forEach(cb => cb(message.data.audio));
        }
        break;

      case 'state_updated':
        this.stateCallbacks.forEach(cb => cb(message.data.state));
        break;

      case 'error':
        console.error('Backend error:', message.data);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * Start a new session
   */
  startSession(sessionId: string, userId: string, mobileNumber: string): void {
    this.sessionId = sessionId;
    this.send({
      type: 'start',
      sessionId,
      data: {
        sessionId,
        userId,
        mobileNumber,
      },
    });
  }

  /**
   * Send text message
   */
  sendText(text: string): void {
    if (!this.sessionId) {
      console.error('No active session');
      return;
    }

    this.send({
      type: 'text',
      sessionId: this.sessionId,
      data: { text },
    });
  }

  /**
   * Update state
   */
  updateState(state: ConversationState): void {
    if (!this.sessionId) {
      console.error('No active session');
      return;
    }

    this.send({
      type: 'state',
      sessionId: this.sessionId,
      data: { state },
    });
  }

  /**
   * Send message to backend
   */
  private send(message: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected');
    }
  }

  /**
   * Register callback for agent messages
   */
  onMessage(callback: (text: string) => void): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (state: ConversationState) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Register callback for audio responses
   */
  onAudio(callback: (audioBase64: string) => void): void {
    this.audioCallbacks.push(callback);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.messageCallbacks = [];
    this.stateCallbacks = [];
    this.audioCallbacks = [];
  }
}

export const websocketService = new WebSocketService();

