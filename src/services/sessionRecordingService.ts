/**
 * Session Recording Service
 * Handles camera video/audio recording using MediaRecorder
 * Records in chunks and uploads to backend for session replay
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export interface RecordingChunk {
  sessionId: string;
  chunkIndex: number;
  timestamp: number;
  data: Blob;
  duration: number;
}

export interface RecordingConfig {
  chunkDurationMs: number; // Duration of each chunk (default 3000ms = 3 seconds)
  mimeType: string;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}

const DEFAULT_CONFIG: RecordingConfig = {
  chunkDurationMs: 3000, // 3 second chunks
  mimeType: 'video/webm;codecs=vp8,opus',
  videoBitsPerSecond: 1000000, // 1 Mbps
  audioBitsPerSecond: 128000, // 128 kbps
};

class SessionRecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private chunkIndex: number = 0;
  private sessionId: string | null = null;
  private config: RecordingConfig;
  private isRecording: boolean = false;
  private startTime: number = 0;
  private chunkStartTime: number = 0;
  private uploadQueue: RecordingChunk[] = [];
  private isUploading: boolean = false;
  private stream: MediaStream | null = null;

  constructor(config: Partial<RecordingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if MediaRecorder is supported
   */
  static isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm');
  }

  /**
   * Get supported MIME type
   */
  private getSupportedMimeType(): string {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('[SessionRecording] Using MIME type:', type);
        return type;
      }
    }

    console.warn('[SessionRecording] No supported MIME type found, using default');
    return 'video/webm';
  }

  /**
   * Start recording the session
   */
  async startRecording(sessionId: string, existingStream?: MediaStream): Promise<boolean> {
    if (this.isRecording) {
      console.warn('[SessionRecording] Already recording');
      return false;
    }

    if (!SessionRecordingService.isSupported()) {
      console.error('[SessionRecording] MediaRecorder not supported');
      return false;
    }

    try {
      this.sessionId = sessionId;
      this.chunkIndex = 0;
      this.recordedChunks = [];
      this.uploadQueue = [];
      this.startTime = Date.now();

      // Use existing stream or create new one with audio
      if (existingStream) {
        // Clone tracks to avoid conflicts with existing usage
        const videoTrack = existingStream.getVideoTracks()[0];
        
        // Request audio separately
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.stream = new MediaStream([
            videoTrack,
            ...audioStream.getAudioTracks()
          ]);
        } catch (audioErr) {
          console.warn('[SessionRecording] Could not get audio, recording video only');
          this.stream = new MediaStream([videoTrack]);
        }
      } else {
        // Request both video and audio
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: true
        });
      }

      const mimeType = this.getSupportedMimeType();
      
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond: this.config.videoBitsPerSecond,
        audioBitsPerSecond: this.config.audioBitsPerSecond,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.handleChunk(event.data);
        }
      };

      this.mediaRecorder.onerror = (event: any) => {
        console.error('[SessionRecording] MediaRecorder error:', event.error);
      };

      this.mediaRecorder.onstop = () => {
        console.log('[SessionRecording] MediaRecorder stopped');
        this.isRecording = false;
      };

      // Start recording with chunk intervals
      this.chunkStartTime = Date.now();
      this.mediaRecorder.start(this.config.chunkDurationMs);
      this.isRecording = true;

      console.log(`[SessionRecording] Started recording session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('[SessionRecording] Failed to start recording:', error);
      return false;
    }
  }

  /**
   * Handle a recorded chunk
   */
  private handleChunk(data: Blob): void {
    const now = Date.now();
    const chunk: RecordingChunk = {
      sessionId: this.sessionId!,
      chunkIndex: this.chunkIndex,
      timestamp: this.chunkStartTime,
      data,
      duration: now - this.chunkStartTime,
    };

    this.chunkIndex++;
    this.chunkStartTime = now;

    console.log(`[SessionRecording] Chunk ${chunk.chunkIndex} captured: ${(data.size / 1024).toFixed(2)} KB`);

    // Add to upload queue
    this.uploadQueue.push(chunk);
    this.processUploadQueue();
  }

  /**
   * Process the upload queue
   */
  private async processUploadQueue(): Promise<void> {
    if (this.isUploading || this.uploadQueue.length === 0) {
      return;
    }

    this.isUploading = true;

    while (this.uploadQueue.length > 0) {
      const chunk = this.uploadQueue.shift()!;
      try {
        await this.uploadChunk(chunk);
      } catch (error) {
        console.error(`[SessionRecording] Failed to upload chunk ${chunk.chunkIndex}:`, error);
        // Re-queue failed chunk at the beginning
        this.uploadQueue.unshift(chunk);
        break;
      }
    }

    this.isUploading = false;
  }

  /**
   * Upload a chunk to the backend
   */
  private async uploadChunk(chunk: RecordingChunk): Promise<void> {
    const formData = new FormData();
    formData.append('sessionId', chunk.sessionId);
    formData.append('chunkIndex', chunk.chunkIndex.toString());
    formData.append('timestamp', chunk.timestamp.toString());
    formData.append('duration', chunk.duration.toString());
    formData.append('chunk', chunk.data, `chunk-${chunk.chunkIndex}.webm`);

    const response = await fetch(`${API_BASE_URL}/admin/session/recording/chunk`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    console.log(`[SessionRecording] Chunk ${chunk.chunkIndex} uploaded successfully`);
  }

  /**
   * Stop recording
   */
  async stopRecording(): Promise<{ totalChunks: number; totalDuration: number }> {
    if (!this.isRecording || !this.mediaRecorder) {
      console.warn('[SessionRecording] Not recording');
      return { totalChunks: 0, totalDuration: 0 };
    }

    return new Promise((resolve) => {
      const originalOnStop = this.mediaRecorder!.onstop;
      
      this.mediaRecorder!.onstop = async (event: Event) => {
        if (originalOnStop && this.mediaRecorder) {
          originalOnStop.call(this.mediaRecorder, event);
        }

        // Wait for all chunks to upload
        while (this.uploadQueue.length > 0) {
          await new Promise(r => setTimeout(r, 100));
        }

        // Notify backend that recording is complete
        try {
          await this.notifyRecordingComplete();
        } catch (error) {
          console.error('[SessionRecording] Failed to notify recording complete:', error);
        }

        const totalDuration = Date.now() - this.startTime;
        
        console.log(`[SessionRecording] Recording stopped. Total chunks: ${this.chunkIndex}, Duration: ${(totalDuration / 1000).toFixed(2)}s`);

        // Cleanup
        this.cleanup();

        resolve({
          totalChunks: this.chunkIndex,
          totalDuration,
        });
      };

      this.mediaRecorder!.stop();
    });
  }

  /**
   * Notify backend that recording is complete
   */
  private async notifyRecordingComplete(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/admin/session/recording/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: this.sessionId,
        totalChunks: this.chunkIndex,
        totalDuration: Date.now() - this.startTime,
        startTime: this.startTime,
        endTime: Date.now(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to notify complete: ${response.statusText}`);
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.stream) {
      // Only stop audio tracks (video tracks may be shared)
      this.stream.getAudioTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.isRecording = false;
    this.sessionId = null;
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get recording stats
   */
  getStats(): { chunksRecorded: number; duration: number; isRecording: boolean } {
    return {
      chunksRecorded: this.chunkIndex,
      duration: this.isRecording ? Date.now() - this.startTime : 0,
      isRecording: this.isRecording,
    };
  }
}

// Singleton instance
export const sessionRecordingService = new SessionRecordingService();
export { SessionRecordingService };
export default sessionRecordingService;

