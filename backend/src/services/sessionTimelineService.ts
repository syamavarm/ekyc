/**
 * Session Timeline Service
 * Manages session recording data: video chunks, UI events, and backend decisions
 * Provides merged timeline for admin replay
 */

import * as fs from 'fs';
import * as path from 'path';

// Storage directories
const RECORDINGS_DIR = path.join(__dirname, '../../recordings');
const VIDEOS_DIR = path.join(__dirname, '../../videos');

// Ensure directories exist
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

export type TimelineEventType = 
  | 'video_chunk'
  | 'ui_event'
  | 'backend_decision'
  | 'recording_started'
  | 'recording_ended';

export interface VideoChunkMetadata {
  sessionId: string;
  chunkIndex: number;
  timestamp: number;
  duration: number;
  filename: string;
  size: number;
}

export interface UIEvent {
  sessionId: string;
  eventId: string;
  type: string;
  payload: Record<string, any>;
  timestamp: number;
  sequenceNumber: number;
}

export interface BackendDecision {
  sessionId: string;
  decisionId: string;
  type: 'face_match' | 'liveness_check' | 'ocr_result' | 'location_check' | 'form_result' | 'session_complete';
  result: boolean;
  score?: number;
  confidence?: number;
  details?: Record<string, any>;
  timestamp: number;
}

export interface TimelineEntry {
  id: string;
  timestamp: number;
  type: TimelineEventType;
  subType?: string;
  data: VideoChunkMetadata | UIEvent | BackendDecision | RecordingMetadata;
}

export interface RecordingMetadata {
  sessionId: string;
  totalChunks: number;
  totalDuration: number;
  startTime: number;
  endTime: number;
  merged: boolean;
  mergedVideoPath?: string;
}

export interface SessionTimeline {
  sessionId: string;
  recordingMetadata?: RecordingMetadata;
  timeline: TimelineEntry[];
  videoChunks: VideoChunkMetadata[];
  uiEvents: UIEvent[];
  backendDecisions: BackendDecision[];
}

// In-memory storage (replace with database in production)
const sessionRecordings: Map<string, {
  metadata?: RecordingMetadata;
  chunks: VideoChunkMetadata[];
  uiEvents: UIEvent[];
  backendDecisions: BackendDecision[];
}> = new Map();

class SessionTimelineService {
  
  /**
   * Initialize storage for a session
   */
  initializeSession(sessionId: string): void {
    if (!sessionRecordings.has(sessionId)) {
      sessionRecordings.set(sessionId, {
        chunks: [],
        uiEvents: [],
        backendDecisions: [],
      });
      
      // Create session recording directory
      const sessionDir = path.join(RECORDINGS_DIR, sessionId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      
      console.log(`[SessionTimeline] Initialized session: ${sessionId}`);
    }
  }

  /**
   * Save a video chunk
   */
  async saveVideoChunk(
    sessionId: string,
    chunkIndex: number,
    timestamp: number,
    duration: number,
    chunkBuffer: Buffer
  ): Promise<VideoChunkMetadata> {
    this.initializeSession(sessionId);
    
    const sessionDir = path.join(RECORDINGS_DIR, sessionId);
    const filename = `chunk-${chunkIndex.toString().padStart(4, '0')}.webm`;
    const filepath = path.join(sessionDir, filename);
    
    // Save chunk to disk
    fs.writeFileSync(filepath, chunkBuffer);
    
    const metadata: VideoChunkMetadata = {
      sessionId,
      chunkIndex,
      timestamp,
      duration,
      filename,
      size: chunkBuffer.length,
    };
    
    // Add to session storage
    const session = sessionRecordings.get(sessionId)!;
    session.chunks.push(metadata);
    
    console.log(`[SessionTimeline] Saved chunk ${chunkIndex} for session ${sessionId}: ${(metadata.size / 1024).toFixed(2)} KB`);
    
    return metadata;
  }

  /**
   * Save UI events (batch)
   */
  saveUIEvents(sessionId: string, events: UIEvent[]): void {
    this.initializeSession(sessionId);
    
    const session = sessionRecordings.get(sessionId)!;
    session.uiEvents.push(...events);
    
    console.log(`[SessionTimeline] Saved ${events.length} UI events for session ${sessionId}`);
  }

  /**
   * Save a backend decision
   */
  saveBackendDecision(
    sessionId: string,
    type: BackendDecision['type'],
    result: boolean,
    details?: {
      score?: number;
      confidence?: number;
      additionalData?: Record<string, any>;
    }
  ): BackendDecision {
    this.initializeSession(sessionId);
    
    const decision: BackendDecision = {
      sessionId,
      decisionId: `dec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      result,
      score: details?.score,
      confidence: details?.confidence,
      details: details?.additionalData,
      timestamp: Date.now(),
    };
    
    const session = sessionRecordings.get(sessionId)!;
    session.backendDecisions.push(decision);
    
    console.log(`[SessionTimeline] Saved backend decision: ${type} = ${result} for session ${sessionId}`);
    
    return decision;
  }

  /**
   * Mark recording as complete
   */
  completeRecording(
    sessionId: string,
    totalChunks: number,
    totalDuration: number,
    startTime: number,
    endTime: number
  ): RecordingMetadata {
    this.initializeSession(sessionId);
    
    const metadata: RecordingMetadata = {
      sessionId,
      totalChunks,
      totalDuration,
      startTime,
      endTime,
      merged: false,
    };
    
    const session = sessionRecordings.get(sessionId)!;
    session.metadata = metadata;
    
    // Save metadata to disk
    const metadataPath = path.join(RECORDINGS_DIR, sessionId, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`[SessionTimeline] Recording completed for session ${sessionId}: ${totalChunks} chunks, ${(totalDuration / 1000).toFixed(2)}s`);
    
    return metadata;
  }

  /**
   * Get merged timeline for a session
   */
  getSessionTimeline(sessionId: string): SessionTimeline | null {
    const session = sessionRecordings.get(sessionId);
    
    if (!session) {
      // Try to load from disk
      const metadataPath = path.join(RECORDINGS_DIR, sessionId, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
          return this.buildTimelineFromDisk(sessionId, metadata);
        } catch (error) {
          console.error(`[SessionTimeline] Failed to load session ${sessionId} from disk:`, error);
          return null;
        }
      }
      return null;
    }
    
    // Build merged timeline
    const timeline: TimelineEntry[] = [];
    
    // Add recording start event
    if (session.metadata) {
      timeline.push({
        id: `rec_start_${sessionId}`,
        timestamp: session.metadata.startTime,
        type: 'recording_started',
        data: session.metadata,
      });
    }
    
    // Add video chunks
    for (const chunk of session.chunks) {
      timeline.push({
        id: `chunk_${chunk.chunkIndex}`,
        timestamp: chunk.timestamp,
        type: 'video_chunk',
        data: chunk,
      });
    }
    
    // Add UI events
    for (const event of session.uiEvents) {
      timeline.push({
        id: event.eventId,
        timestamp: event.timestamp,
        type: 'ui_event',
        subType: event.type,
        data: event,
      });
    }
    
    // Add backend decisions
    for (const decision of session.backendDecisions) {
      timeline.push({
        id: decision.decisionId,
        timestamp: decision.timestamp,
        type: 'backend_decision',
        subType: decision.type,
        data: decision,
      });
    }
    
    // Add recording end event
    if (session.metadata) {
      timeline.push({
        id: `rec_end_${sessionId}`,
        timestamp: session.metadata.endTime,
        type: 'recording_ended',
        data: session.metadata,
      });
    }
    
    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    
    return {
      sessionId,
      recordingMetadata: session.metadata,
      timeline,
      videoChunks: session.chunks,
      uiEvents: session.uiEvents,
      backendDecisions: session.backendDecisions,
    };
  }

  /**
   * Build timeline from disk storage
   */
  private buildTimelineFromDisk(sessionId: string, metadata: RecordingMetadata): SessionTimeline {
    const sessionDir = path.join(RECORDINGS_DIR, sessionId);
    const timeline: TimelineEntry[] = [];
    const chunks: VideoChunkMetadata[] = [];
    
    // Read chunks
    const files = fs.readdirSync(sessionDir).filter(f => f.startsWith('chunk-') && f.endsWith('.webm'));
    for (const file of files) {
      const chunkIndex = parseInt(file.replace('chunk-', '').replace('.webm', ''));
      const filepath = path.join(sessionDir, file);
      const stat = fs.statSync(filepath);
      
      const chunk: VideoChunkMetadata = {
        sessionId,
        chunkIndex,
        timestamp: metadata.startTime + (chunkIndex * 3000), // Estimate timestamp
        duration: 3000,
        filename: file,
        size: stat.size,
      };
      
      chunks.push(chunk);
      timeline.push({
        id: `chunk_${chunkIndex}`,
        timestamp: chunk.timestamp,
        type: 'video_chunk',
        data: chunk,
      });
    }
    
    // Load events if saved
    const eventsPath = path.join(sessionDir, 'events.json');
    let uiEvents: UIEvent[] = [];
    if (fs.existsSync(eventsPath)) {
      uiEvents = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
      for (const event of uiEvents) {
        timeline.push({
          id: event.eventId,
          timestamp: event.timestamp,
          type: 'ui_event',
          subType: event.type,
          data: event,
        });
      }
    }
    
    // Load decisions if saved
    const decisionsPath = path.join(sessionDir, 'decisions.json');
    let backendDecisions: BackendDecision[] = [];
    if (fs.existsSync(decisionsPath)) {
      backendDecisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf-8'));
      for (const decision of backendDecisions) {
        timeline.push({
          id: decision.decisionId,
          timestamp: decision.timestamp,
          type: 'backend_decision',
          subType: decision.type,
          data: decision,
        });
      }
    }
    
    // Sort timeline
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    
    return {
      sessionId,
      recordingMetadata: metadata,
      timeline,
      videoChunks: chunks,
      uiEvents,
      backendDecisions,
    };
  }

  /**
   * Get video chunks for a session
   */
  getVideoChunks(sessionId: string): VideoChunkMetadata[] {
    const session = sessionRecordings.get(sessionId);
    return session?.chunks || [];
  }

  /**
   * Get chunk file path
   */
  getChunkFilePath(sessionId: string, chunkIndex: number): string | null {
    const filename = `chunk-${chunkIndex.toString().padStart(4, '0')}.webm`;
    const filepath = path.join(RECORDINGS_DIR, sessionId, filename);
    
    if (fs.existsSync(filepath)) {
      return filepath;
    }
    return null;
  }

  /**
   * Get merged video path
   */
  getMergedVideoPath(sessionId: string): string | null {
    const filepath = path.join(VIDEOS_DIR, `${sessionId}.mp4`);
    
    if (fs.existsSync(filepath)) {
      return filepath;
    }
    return null;
  }

  /**
   * Mark video as merged
   */
  markVideoMerged(sessionId: string, mergedPath: string): void {
    const session = sessionRecordings.get(sessionId);
    if (session?.metadata) {
      session.metadata.merged = true;
      session.metadata.mergedVideoPath = mergedPath;
      
      // Update metadata on disk
      const metadataPath = path.join(RECORDINGS_DIR, sessionId, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(session.metadata, null, 2));
    }
  }

  /**
   * Get all sessions with recordings
   */
  getAllRecordedSessions(): string[] {
    const sessions: string[] = [];
    
    // From memory
    for (const sessionId of sessionRecordings.keys()) {
      sessions.push(sessionId);
    }
    
    // From disk
    if (fs.existsSync(RECORDINGS_DIR)) {
      const dirs = fs.readdirSync(RECORDINGS_DIR);
      for (const dir of dirs) {
        if (!sessions.includes(dir) && fs.statSync(path.join(RECORDINGS_DIR, dir)).isDirectory()) {
          sessions.push(dir);
        }
      }
    }
    
    return sessions;
  }

  /**
   * Save session data to disk (for persistence)
   */
  persistSession(sessionId: string): void {
    const session = sessionRecordings.get(sessionId);
    if (!session) return;
    
    const sessionDir = path.join(RECORDINGS_DIR, sessionId);
    
    // Save events
    if (session.uiEvents.length > 0) {
      fs.writeFileSync(
        path.join(sessionDir, 'events.json'),
        JSON.stringify(session.uiEvents, null, 2)
      );
    }
    
    // Save decisions
    if (session.backendDecisions.length > 0) {
      fs.writeFileSync(
        path.join(sessionDir, 'decisions.json'),
        JSON.stringify(session.backendDecisions, null, 2)
      );
    }
    
    console.log(`[SessionTimeline] Persisted session ${sessionId} to disk`);
  }

  /**
   * Get recordings directory
   */
  getRecordingsDir(): string {
    return RECORDINGS_DIR;
  }

  /**
   * Get videos directory
   */
  getVideosDir(): string {
    return VIDEOS_DIR;
  }
}

// Singleton instance
export const sessionTimelineService = new SessionTimelineService();
export default sessionTimelineService;

