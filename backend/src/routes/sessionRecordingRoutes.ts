/**
 * Session Recording Routes
 * API endpoints for session video/audio recording and timeline management
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { sessionTimelineService } from '../services/sessionTimelineService';
import { videoMergeWorker } from '../workers/videoMergeWorker';

const router = express.Router();

// Configure multer for chunk uploads
const chunkStorage = multer.memoryStorage();
const uploadChunk = multer({
  storage: chunkStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per chunk
  },
});

/**
 * POST /admin/session/recording/chunk
 * Upload a video chunk
 */
router.post('/recording/chunk', uploadChunk.single('chunk'), async (req: Request, res: Response) => {
  try {
    const { sessionId, chunkIndex, timestamp, duration } = req.body;
    const file = req.file;
    
    if (!sessionId || chunkIndex === undefined || !timestamp || !file) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'sessionId, chunkIndex, timestamp, and chunk file are required',
      });
    }
    
    const metadata = await sessionTimelineService.saveVideoChunk(
      sessionId,
      parseInt(chunkIndex),
      parseInt(timestamp),
      parseInt(duration) || 3000,
      file.buffer
    );
    
    res.status(200).json({
      success: true,
      chunk: metadata,
      message: 'Chunk uploaded successfully',
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error uploading chunk:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to upload chunk',
    });
  }
});

/**
 * POST /admin/session/recording/complete
 * Mark recording as complete and trigger video merge
 */
router.post('/recording/complete', async (req: Request, res: Response) => {
  try {
    const { sessionId, totalChunks, totalDuration, startTime, endTime } = req.body;
    
    if (!sessionId || totalChunks === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'sessionId and totalChunks are required',
      });
    }
    
    const metadata = sessionTimelineService.completeRecording(
      sessionId,
      totalChunks,
      totalDuration || 0,
      startTime || Date.now() - totalDuration,
      endTime || Date.now()
    );
    
    // Persist session data
    sessionTimelineService.persistSession(sessionId);
    
    // Trigger video merge in background
    videoMergeWorker.queueMerge(sessionId);
    
    res.status(200).json({
      success: true,
      metadata,
      message: 'Recording completed, video merge queued',
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error completing recording:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to complete recording',
    });
  }
});

/**
 * POST /admin/session/events/batch
 * Save UI events in batch
 */
router.post('/events/batch', async (req: Request, res: Response) => {
  try {
    const { sessionId, events } = req.body;
    
    if (!sessionId || !events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'sessionId and events array are required',
      });
    }
    
    sessionTimelineService.saveUIEvents(sessionId, events);
    
    res.status(200).json({
      success: true,
      count: events.length,
      message: 'Events saved successfully',
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error saving events:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to save events',
    });
  }
});

/**
 * POST /admin/session/decision
 * Save a backend decision event
 */
router.post('/decision', async (req: Request, res: Response) => {
  try {
    const { sessionId, type, result, score, confidence, details } = req.body;
    
    if (!sessionId || !type || result === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'sessionId, type, and result are required',
      });
    }
    
    const decision = sessionTimelineService.saveBackendDecision(
      sessionId,
      type,
      result,
      { score, confidence, additionalData: details }
    );
    
    res.status(200).json({
      success: true,
      decision,
      message: 'Decision saved successfully',
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error saving decision:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to save decision',
    });
  }
});

/**
 * GET /admin/session/:sessionId/timeline
 * Get merged timeline for a session
 */
router.get('/:sessionId/timeline', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    const timeline = sessionTimelineService.getSessionTimeline(sessionId);
    
    if (!timeline) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `No recording data found for session ${sessionId}`,
      });
    }
    
    // Check if merged video exists
    const mergedVideoPath = sessionTimelineService.getMergedVideoPath(sessionId);
    const hasVideo = !!mergedVideoPath;
    
    res.status(200).json({
      success: true,
      sessionId,
      hasVideo,
      videoUrl: hasVideo ? `/admin/session/${sessionId}/video` : null,
      chunksCount: timeline.videoChunks.length,
      eventsCount: timeline.uiEvents.length,
      decisionsCount: timeline.backendDecisions.length,
      recordingMetadata: timeline.recordingMetadata,
      timeline: timeline.timeline,
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error getting timeline:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get timeline',
    });
  }
});

/**
 * GET /admin/session/:sessionId/details
 * Get full session details including documents, OCR results, and report
 */
router.get('/:sessionId/details', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    // Get uploads directory path
    const uploadsDir = path.join(__dirname, '../../uploads');
    const reportsDir = path.join(__dirname, '../../reports');
    
    // Find documents for this session
    const documents: Array<{
      type: string;
      url: string;
      filename: string;
    }> = [];
    
    let ocrResults: any = null;
    let reportData: any = null;
    let documentId: string | null = null;
    
    // First, try to get the documentId from the session manager (for active sessions)
    try {
      const { sessionManager } = await import('../services/kycSessionManager');
      const session = sessionManager.getSession(sessionId);
      if (session?.document?.documentId) {
        documentId = session.document.documentId;
        console.log(`[SessionRecording] Found documentId ${documentId} from session manager`);
      }
    } catch (e) {
      // Session manager may not have the session (e.g., after restart)
    }
    
    // If not found, try to get documentId from the recorded events
    if (!documentId) {
      const recordingsDir = path.join(__dirname, '../../recordings');
      const eventsPath = path.join(recordingsDir, sessionId, 'events.json');
      
      if (fs.existsSync(eventsPath)) {
        try {
          const eventsContent = fs.readFileSync(eventsPath, 'utf-8');
          const events = JSON.parse(eventsContent);
          
          // Look for events that contain documentId
          for (const event of events) {
            if (event.payload?.documentId) {
              documentId = event.payload.documentId;
              console.log(`[SessionRecording] Found documentId ${documentId} from events.json`);
              break;
            }
          }
        } catch (e) {
          console.error(`[SessionRecording] Failed to read events.json:`, e);
        }
      }
    }
    
    // Also try to get OCR results from recordings metadata
    if (!ocrResults) {
      const recordingsDir = path.join(__dirname, '../../recordings');
      const decisionsPath = path.join(recordingsDir, sessionId, 'decisions.json');
      
      if (fs.existsSync(decisionsPath)) {
        try {
          const decisionsContent = fs.readFileSync(decisionsPath, 'utf-8');
          const decisions = JSON.parse(decisionsContent);
          
          // Find OCR decision
          const ocrDecision = decisions.find((d: any) => d.type === 'ocr_result');
          if (ocrDecision?.details) {
            // Build OCR results from decision
            ocrResults = {
              documentType: ocrDecision.details.documentType,
              confidence: ocrDecision.confidence,
              extractedFields: ocrDecision.details.extractedFields,
            };
          }
        } catch (e) {
          console.error(`[SessionRecording] Failed to read decisions.json:`, e);
        }
      }
    }
    
    console.log(`[SessionRecording] Looking for documents with documentId: ${documentId || 'none found'}`);
    
    // Scan uploads directory for session-specific files
    if (fs.existsSync(uploadsDir) && documentId) {
      const files = fs.readdirSync(uploadsDir);
      
      for (const file of files) {
        // Only include files that belong to this session's document
        if (!file.startsWith(documentId)) continue;
        
        const filePath = path.join(uploadsDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
          // Check for OCR results JSON
          if (file.endsWith('-ocr-results.json')) {
            try {
              const ocrContent = fs.readFileSync(filePath, 'utf-8');
              ocrResults = JSON.parse(ocrContent);
              console.log(`[SessionRecording] Loaded OCR results from ${file}`);
            } catch (e) {
              console.error(`[SessionRecording] Failed to read OCR results: ${file}`, e);
            }
          }
          // Check for document images (front/back)
          else if (file.endsWith('-front.jpg') || file.endsWith('-front.jpeg') || file.endsWith('-front.png')) {
            documents.push({
              type: 'front',
              url: `/uploads/${file}`,
              filename: file,
            });
          }
          else if (file.endsWith('-back.jpg') || file.endsWith('-back.jpeg') || file.endsWith('-back.png')) {
            documents.push({
              type: 'back',
              url: `/uploads/${file}`,
              filename: file,
            });
          }
          // Face image
          else if (file.endsWith('-face.jpg') || file.endsWith('-face.jpeg') || file.endsWith('-face.png')) {
            documents.push({
              type: 'face',
              url: `/uploads/${file}`,
              filename: file,
            });
          }
        }
      }
    }
    
    console.log(`[SessionRecording] Found ${documents.length} documents for session ${sessionId}`);
    
    // Find text report for this session (kyc_report_*.txt)
    if (fs.existsSync(reportsDir)) {
      const files = fs.readdirSync(reportsDir);
      // Look specifically for the .txt report file (not the formdata JSON)
      const reportFile = files.find(f => 
        f.startsWith('kyc_report_') && 
        f.includes(sessionId) && 
        f.endsWith('.txt')
      );
      
      if (reportFile) {
        try {
          const reportContent = fs.readFileSync(path.join(reportsDir, reportFile), 'utf-8');
          reportData = { type: 'text', content: reportContent };
        } catch (e) {
          console.error(`[SessionRecording] Failed to read report: ${reportFile}`, e);
        }
      }
    }
    
    // Try to get session from session manager (for more details)
    let sessionDetails: any = null;
    try {
      // Import session manager dynamically to avoid circular dependencies
      const { sessionManager } = await import('../services/kycSessionManager');
      const session = sessionManager.getSession(sessionId);
      if (session) {
        sessionDetails = {
          userId: session.userId,
          email: session.email,
          mobileNumber: session.mobileNumber,
          status: session.status,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
          consent: session.consent,
          location: session.location ? {
            gps: session.location.gps,
            ip: session.location.ip,
            addressComparison: session.location.addressComparison,
          } : null,
          document: session.document ? {
            documentId: session.document.documentId,
            documentType: session.document.documentType,
            isValid: session.document.isValid,
            uploadedAt: session.document.uploadedAt,
            imageUrl: session.document.imageUrl,
            backImageUrl: session.document.backImageUrl,
            ocrResults: session.document.ocrResults,
          } : null,
          secureVerification: session.secureVerification ? {
            overallResult: session.secureVerification.overallResult,
            faceMatch: session.secureVerification.faceMatch,
            liveness: session.secureVerification.liveness,
            faceConsistency: session.secureVerification.faceConsistency,
            otpVoiceVerification: session.secureVerification.otpVoiceVerification,
            verifiedAt: session.secureVerification.verifiedAt,
          } : null,
          form: session.form,
          verificationResults: session.verificationResults,
          overallScore: session.overallScore,
        };
        
        // Use session's OCR results if available
        if (session.document?.ocrResults && !ocrResults) {
          ocrResults = session.document.ocrResults;
        }
        
        // Get document URLs from session if available
        if (session.document?.imageUrl && documents.length === 0) {
          documents.push({
            type: 'front',
            url: session.document.imageUrl,
            filename: path.basename(session.document.imageUrl),
          });
          if (session.document.backImageUrl) {
            documents.push({
              type: 'back',
              url: session.document.backImageUrl,
              filename: path.basename(session.document.backImageUrl),
            });
          }
        }
      }
    } catch (e) {
      console.log(`[SessionRecording] Could not get session from manager: ${e}`);
    }
    
    // Load form data (OCR + Form) if available
    let formData = null;
    try {
      const { reportService } = await import('./kycRoutes');
      formData = reportService.loadFormData(sessionId);
    } catch (e) {
      console.log(`[SessionRecording] Could not load form data: ${e}`);
    }
    
    res.status(200).json({
      success: true,
      sessionId,
      sessionDetails,
      documents,
      ocrResults,
      reportData,
      formData,
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error getting session details:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get session details',
    });
  }
});

/**
 * GET /admin/session/:sessionId/video
 * Stream the merged video file
 */
router.get('/:sessionId/video', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    const videoPath = sessionTimelineService.getMergedVideoPath(sessionId);
    
    if (!videoPath) {
      return res.status(404).json({
        success: false,
        error: 'Video not found',
        message: `No merged video found for session ${sessionId}`,
      });
    }
    
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      // Handle range request for video seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      
      const file = fs.createReadStream(videoPath, { start, end });
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error: any) {
    console.error('[SessionRecording] Error streaming video:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to stream video',
    });
  }
});

/**
 * GET /admin/session/:sessionId/chunk/:chunkIndex
 * Get a specific video chunk (supports range requests for seeking)
 */
router.get('/:sessionId/chunk/:chunkIndex', async (req: Request, res: Response) => {
  try {
    const { sessionId, chunkIndex } = req.params;
    
    const chunkPath = sessionTimelineService.getChunkFilePath(sessionId, parseInt(chunkIndex));
    
    if (!chunkPath) {
      return res.status(404).json({
        success: false,
        error: 'Chunk not found',
        message: `Chunk ${chunkIndex} not found for session ${sessionId}`,
      });
    }
    
    const stat = fs.statSync(chunkPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      // Handle range request for seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      
      const file = fs.createReadStream(chunkPath, { start, end });
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/webm',
      });
      
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/webm',
        'Accept-Ranges': 'bytes',
      });
      
      fs.createReadStream(chunkPath).pipe(res);
    }
  } catch (error: any) {
    console.error('[SessionRecording] Error getting chunk:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get chunk',
    });
  }
});

/**
 * GET /admin/sessions/recordings
 * Get list of all sessions with recordings
 */
router.get('s/recordings', async (req: Request, res: Response) => {
  try {
    const sessions = sessionTimelineService.getAllRecordedSessions();
    
    // Get timeline info for each session
    const sessionsWithInfo = sessions.map(sessionId => {
      const timeline = sessionTimelineService.getSessionTimeline(sessionId);
      const hasVideo = !!sessionTimelineService.getMergedVideoPath(sessionId);
      
      return {
        sessionId,
        hasVideo,
        hasRecording: !!timeline?.recordingMetadata,
        chunksCount: timeline?.videoChunks.length || 0,
        eventsCount: timeline?.uiEvents.length || 0,
        decisionsCount: timeline?.backendDecisions.length || 0,
        duration: timeline?.recordingMetadata?.totalDuration || 0,
        startTime: timeline?.recordingMetadata?.startTime,
        endTime: timeline?.recordingMetadata?.endTime,
      };
    });
    
    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions: sessionsWithInfo,
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error getting recordings:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get recordings',
    });
  }
});

/**
 * POST /admin/session/:sessionId/merge
 * Manually trigger video merge for a session
 */
router.post('/:sessionId/merge', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    const timeline = sessionTimelineService.getSessionTimeline(sessionId);
    
    if (!timeline || timeline.videoChunks.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No chunks found',
        message: `No video chunks found for session ${sessionId}`,
      });
    }
    
    // Queue merge
    videoMergeWorker.queueMerge(sessionId);
    
    res.status(200).json({
      success: true,
      message: 'Video merge queued',
      chunksCount: timeline.videoChunks.length,
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error triggering merge:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to trigger merge',
    });
  }
});

/**
 * GET /admin/session/:sessionId/merge/status
 * Get merge status for a session
 */
router.get('/:sessionId/merge/status', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    const status = videoMergeWorker.getMergeStatus(sessionId);
    const hasVideo = !!sessionTimelineService.getMergedVideoPath(sessionId);
    
    res.status(200).json({
      success: true,
      sessionId,
      status,
      hasVideo,
      videoUrl: hasVideo ? `/admin/session/${sessionId}/video` : null,
    });
  } catch (error: any) {
    console.error('[SessionRecording] Error getting merge status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get merge status',
    });
  }
});

export default router;

