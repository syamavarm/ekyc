/**
 * UI Event Logger Service
 * Captures UI events and interactions for session timeline replay
 * Instead of screen recording, we capture structured event logs
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export type UIEventType =
  | 'step_started'
  | 'step_completed'
  | 'instruction_shown'
  | 'button_clicked'
  // Document events
  | 'document_captured'
  | 'document_front_captured'
  | 'document_back_captured'
  | 'document_retake'
  | 'document_front_confirmed'
  | 'document_processing_started'
  | 'document_uploaded'
  | 'document_ocr_result'
  | 'document_verified'
  // Face verification events
  | 'face_verification_started'
  | 'face_capture_started'
  | 'face_captured'
  | 'face_check_result_shown'
  | 'face_verification_success'
  | 'face_verification_failed'
  // Liveness events
  | 'liveness_check_started'
  | 'liveness_action'
  | 'liveness_check_completed'
  | 'liveness_passed_starting_otp'
  | 'liveness_failed_escalating'
  // OTP voice verification events
  | 'otp_voice_verification'
  | 'verification_escalated'
  // Location events
  | 'location_capture_started'
  | 'location_check_started'
  | 'location_check_display'
  // Form events
  | 'form_started'
  | 'form_answer_submitted'
  | 'form_completed'
  // Voice input events
  | 'voice_answer_recognized'
  | 'voice_answer_failed'
  // Error & warning events
  | 'error_displayed'
  | 'warning_displayed'
  // Session events
  | 'consent_given'
  | 'audio_instruction_played'
  | 'camera_started'
  | 'camera_stopped'
  | 'user_interaction'
  | 'modal_opened'
  | 'modal_closed'
  | 'session_started'
  | 'session_completed'
  | 'session_failed';

export interface UIEvent {
  sessionId: string;
  eventId: string;
  type: UIEventType;
  payload: Record<string, any>;
  timestamp: number;
  sequenceNumber: number;
}

export interface UIEventPayload {
  // Common fields
  stepName?: string;
  message?: string;
  
  // Step-specific fields
  documentType?: string;
  documentSide?: 'front' | 'back';
  checkType?: string;
  result?: boolean | string;
  score?: number;
  confidence?: number;
  
  // Location fields
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  verified?: boolean;
  
  // Error fields
  errorCode?: string;
  errorMessage?: string;
  
  // Button/interaction fields
  buttonId?: string;
  buttonLabel?: string;
  elementId?: string;
  
  // Any additional data
  [key: string]: any;
}

class UIEventLoggerService {
  private sessionId: string | null = null;
  private sequenceNumber: number = 0;
  private eventQueue: UIEvent[] = [];
  private isProcessing: boolean = false;
  private isEnabled: boolean = true;
  private sendImmediately: boolean = true; // Send events immediately for reliability
  private batchSize: number = 1; // Send each event immediately
  private flushIntervalMs: number = 500; // Frequent flush as backup
  private flushInterval: NodeJS.Timeout | null = null;
  private eventListeners: ((event: UIEvent) => void)[] = [];

  /**
   * Initialize the logger for a session
   * Idempotent - safe to call multiple times for the same session
   */
  initialize(sessionId: string): void {
    // If already initialized for this session, don't re-initialize
    if (this.sessionId === sessionId) {
      console.log(`[UIEventLogger] Already initialized for session: ${sessionId}`);
      return;
    }
    
    // If switching sessions, stop the previous one first
    if (this.sessionId && this.sessionId !== sessionId) {
      console.log(`[UIEventLogger] Switching from session ${this.sessionId} to ${sessionId}`);
      this.flushSync(); // Flush events from previous session
    }
    
    this.sessionId = sessionId;
    this.sequenceNumber = 0;
    this.eventQueue = [];
    
    // Start flush interval (handles if already running)
    this.startFlushInterval();
    
    // Remove existing beforeunload handler before adding new one
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    
    console.log(`[UIEventLogger] ✅ Initialized for session: ${sessionId}`);
  }

  /**
   * Handle page unload - flush remaining events
   */
  private handleBeforeUnload = (): void => {
    this.flushSync();
  };

  /**
   * Start periodic flush interval
   */
  private startFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Stop the logger
   */
  async stop(): Promise<void> {
    console.log(`[UIEventLogger] Stopping... (${this.eventQueue.length} events in queue)`);
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Remove beforeunload handler
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    
    // Flush remaining events
    if (this.eventQueue.length > 0) {
      await this.flush();
    }
    
    const sessionId = this.sessionId;
    this.sessionId = null;
    console.log(`[UIEventLogger] Stopped for session ${sessionId}`);
  }

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log a UI event
   */
  logEvent(type: UIEventType, payload: UIEventPayload = {}): UIEvent | null {
    if (!this.isEnabled || !this.sessionId) {
      console.warn(`[UIEventLogger] Cannot log event - enabled: ${this.isEnabled}, sessionId: ${this.sessionId}`);
      return null;
    }

    const event: UIEvent = {
      sessionId: this.sessionId,
      eventId: this.generateEventId(),
      type,
      payload,
      timestamp: Date.now(),
      sequenceNumber: this.sequenceNumber++,
    };

    this.eventQueue.push(event);

    // Notify listeners
    this.eventListeners.forEach(listener => listener(event));

    console.log(`[UIEventLogger] Event logged: ${type}`, payload);

    // Send immediately for reliability (don't wait for batch)
    if (this.sendImmediately) {
      this.flush();
    } else if (this.eventQueue.length >= this.batchSize) {
      this.flush();
    }

    return event;
  }

  /**
   * Convenience methods for common events
   */
  logStepStarted(stepName: string, metadata?: Record<string, any>): UIEvent | null {
    return this.logEvent('step_started', { stepName, ...metadata });
  }

  logStepCompleted(stepName: string, result?: string, metadata?: Record<string, any>): UIEvent | null {
    return this.logEvent('step_completed', { stepName, result, ...metadata });
  }

  logInstructionShown(message: string, stepName?: string): UIEvent | null {
    return this.logEvent('instruction_shown', { message, stepName });
  }

  logButtonClicked(buttonId: string, buttonLabel?: string, metadata?: Record<string, any>): UIEvent | null {
    return this.logEvent('button_clicked', { buttonId, buttonLabel, ...metadata });
  }

  logDocumentCaptured(documentType: string, side?: 'front' | 'back', metadata?: Record<string, any>): UIEvent | null {
    const eventType = side === 'front' ? 'document_front_captured' : 
                      side === 'back' ? 'document_back_captured' : 'document_captured';
    return this.logEvent(eventType, { documentType, documentSide: side, ...metadata });
  }

  logFaceCheckResult(isMatch: boolean, score: number, confidence: number): UIEvent | null {
    return this.logEvent('face_check_result_shown', { 
      result: isMatch, 
      score, 
      confidence,
      message: isMatch ? 'Face match successful' : 'Face match failed'
    });
  }

  logLivenessCheckResult(passed: boolean, confidence: number, checks?: any[]): UIEvent | null {
    return this.logEvent('liveness_check_completed', { 
      result: passed, 
      confidence,
      checks,
      message: passed ? 'Liveness check passed' : 'Liveness check failed'
    });
  }

  logLocationCheck(verified: boolean, details: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    distanceKm?: number;
    message?: string;
  }): UIEvent | null {
    return this.logEvent('location_check_display', { verified, ...details });
  }

  logError(errorCode: string, errorMessage: string, context?: Record<string, any>): UIEvent | null {
    return this.logEvent('error_displayed', { errorCode, errorMessage, ...context });
  }

  logWarning(message: string, context?: Record<string, any>): UIEvent | null {
    return this.logEvent('warning_displayed', { message, ...context });
  }

  logConsentGiven(consentDetails: Record<string, boolean>): UIEvent | null {
    return this.logEvent('consent_given', consentDetails);
  }

  logSessionStarted(metadata?: Record<string, any>): UIEvent | null {
    return this.logEvent('session_started', metadata);
  }

  logSessionCompleted(success: boolean, verificationResults?: Record<string, any>): UIEvent | null {
    const eventType = success ? 'session_completed' : 'session_failed';
    return this.logEvent(eventType, { success, verificationResults });
  }

  /**
   * Flush events to backend
   */
  async flush(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const eventsToSend = [...this.eventQueue];
    this.eventQueue = [];
    const sessionId = this.sessionId;

    if (!sessionId) {
      console.warn('[UIEventLogger] No sessionId, discarding events');
      this.isProcessing = false;
      return;
    }

    try {
      const payload = JSON.stringify({
        sessionId: sessionId,
        events: eventsToSend,
      });

      const response = await fetch(`${API_BASE_URL}/admin/session/events/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send events: ${response.status} ${errorText}`);
      }

      console.log(`[UIEventLogger] ✅ Flushed ${eventsToSend.length} events for session ${sessionId}`);
    } catch (error) {
      console.error('[UIEventLogger] ❌ Failed to flush events:', error);
      // Re-queue failed events at the front
      this.eventQueue = [...eventsToSend, ...this.eventQueue];
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Synchronous flush using sendBeacon (for page unload)
   */
  flushSync(): void {
    if (this.eventQueue.length === 0 || !this.sessionId) {
      return;
    }

    const payload = JSON.stringify({
      sessionId: this.sessionId,
      events: this.eventQueue,
    });

    // Use sendBeacon for reliable delivery during page unload
    const sent = navigator.sendBeacon(
      `${API_BASE_URL}/admin/session/events/batch`,
      new Blob([payload], { type: 'application/json' })
    );

    if (sent) {
      console.log(`[UIEventLogger] 📤 Beacon sent ${this.eventQueue.length} events`);
      this.eventQueue = [];
    } else {
      console.warn('[UIEventLogger] ⚠️ Beacon failed to send');
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: UIEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: UIEvent) => void): void {
    this.eventListeners = this.eventListeners.filter(l => l !== listener);
  }

  /**
   * Get all events for current session (local only)
   */
  getLocalEvents(): UIEvent[] {
    return [...this.eventQueue];
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.sequenceNumber;
  }
}

// Singleton instance
export const uiEventLoggerService = new UIEventLoggerService();
export default uiEventLoggerService;

