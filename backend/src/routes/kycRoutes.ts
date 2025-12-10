/**
 * KYC Routes
 * REST API endpoints for the eKYC workflow
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { KYCSessionManager } from '../services/kycSessionManager';
import { LocationService } from '../services/locationService';
import { DocumentService } from '../services/documentService';
import { FaceVerificationService } from '../services/faceVerificationService';
import { LivenessCheckService } from '../services/livenessCheckService';
import { ReportGenerationService } from '../services/reportGenerationService';
import { QuestionnaireService } from '../services/questionnaireService';
import {
  StartKYCRequest,
  StartKYCResponse,
  SubmitLocationRequest,
  SubmitLocationResponse,
  DocumentUploadResponse,
  DocumentOCRRequest,
  DocumentOCRResponse,
  CombinedFaceLivenessRequest,
  CombinedFaceLivenessResponse,
  CompleteKYCRequest,
  CompleteKYCResponse,
  ErrorResponse,
  ConsentData,
} from '../types/kyc.types';
import { workflowConfigManager } from './adminRoutes';

// Uploads directory for saving face images
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// Initialize services
const sessionManager = new KYCSessionManager();
const locationService = new LocationService();
const documentService = new DocumentService({
  azureEndpoint: process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
  azureKey: process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY,
});
const faceVerificationService = new FaceVerificationService({
  azureEndpoint: process.env.AZURE_FACE_ENDPOINT,
  azureKey: process.env.AZURE_FACE_KEY,
});
const livenessCheckService = new LivenessCheckService({
  confidenceThreshold: 0.8,
});
const reportService = new ReportGenerationService();
const questionnaireService = new QuestionnaireService();

/**
 * POST /kyc/start
 * Start a new KYC session
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { userId, email, mobileNumber, workflowConfigId }: StartKYCRequest & { workflowConfigId?: string } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId',
        message: 'userId is required',
      } as ErrorResponse);
    }
    
    // Check if workflow config exists (if provided)
    let workflowSteps;
    if (workflowConfigId) {
      const config = workflowConfigManager.getConfiguration(workflowConfigId);
      if (!config) {
        return res.status(404).json({
          success: false,
          error: 'Workflow configuration not found',
          message: `Workflow configuration ${workflowConfigId} not found`,
        } as ErrorResponse);
      }
      
      // Validate configuration
      const validation = workflowConfigManager.validateConfiguration(workflowConfigId);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid workflow configuration',
          message: validation.errors.join(', '),
        } as ErrorResponse);
      }
      
      workflowSteps = config.steps;
    }
    
    // Create new session
    const session = sessionManager.createSession(userId, email, mobileNumber, workflowConfigId, workflowSteps);
    
    const response: StartKYCResponse = {
      sessionId: session.sessionId,
      status: session.status,
      message: 'KYC session started successfully',
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error starting session:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to start KYC session',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/consent
 * Submit user consent
 */
router.post('/consent', async (req: Request, res: Response) => {
  try {
    const { sessionId, consent } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Update consent
    const consentData: ConsentData = {
      videoRecording: consent.videoRecording || false,
      locationTracking: consent.locationTracking || false,
      documentUse: consent.documentUse || false,
      timestamp: new Date(),
      ipAddress: req.ip,
    };
    
    sessionManager.updateConsent(sessionId, consentData);
    
    res.status(200).json({
      success: true,
      message: 'Consent recorded successfully',
      consent: consentData,
    });
  } catch (error) {
    console.error('[KYC Routes] Error recording consent:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to record consent',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/location
 * Submit GPS and IP geolocation
 */
router.post('/location', async (req: Request, res: Response) => {
  try {
    const { sessionId, gps, ip }: SubmitLocationRequest = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Process GPS location
    let gpsData;
    if (gps) {
      gpsData = await locationService.captureGPSLocation(
        gps.latitude,
        gps.longitude,
        gps.accuracy
      );
    }
    
    // Process IP location
    let ipData;
    if (ip?.address) {
      ipData = await locationService.captureIPLocation(ip.address);
    } else if (req.ip) {
      ipData = await locationService.captureIPLocation(req.ip);
    }
    
    // Create location data
    const locationData = {
      gps: gpsData,
      ip: ipData,
      capturedAt: new Date(),
    };
    
    // Update session
    sessionManager.updateLocation(sessionId, locationData);
    
    const response: SubmitLocationResponse = {
      success: true,
      message: 'Location captured successfully',
      location: locationData,
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error capturing location:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to capture location',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/document/upload
 * Upload document image
 */
router.post('/document/upload', upload.single('document'), async (req: Request, res: Response) => {
  try {
    const { sessionId, documentType } = req.body;
    const file = req.file;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'Missing document',
        message: 'Document image is required',
      } as ErrorResponse);
    }
    
    if (!documentType) {
      return res.status(400).json({
        success: false,
        error: 'Missing documentType',
        message: 'documentType is required (passport, drivers_license, national_id, voter_id, other)',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Save document
    const documentData = await documentService.saveDocument(
      file.buffer,
      documentType,
      file.originalname
    );
    
    // Update session
    sessionManager.updateDocument(sessionId, documentData);
    
    const response: DocumentUploadResponse = {
      success: true,
      documentId: documentData.documentId,
      imageUrl: documentData.imageUrl,
      message: 'Document uploaded successfully',
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error uploading document:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to upload document',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/document/ocr
 * Run OCR on uploaded document
 * All binary data (images, OCR raw response) is stored in the backend.
 * Only essential extracted data and URLs are returned to frontend.
 */
router.post('/document/ocr', async (req: Request, res: Response) => {
  try {
    const { sessionId, documentId }: DocumentOCRRequest = req.body;
    
    if (!sessionId || !documentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'sessionId and documentId are required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    if (!session.document || session.document.documentId !== documentId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: `Document ${documentId} not found in session`,
      } as ErrorResponse);
    }
    
    // Perform document analysis (OCR + Photo extraction)
    // All data is stored in backend - photoBuffer, ocrResults with rawResponse, etc.
    const { ocrResults, photoBuffer, photoUrl, ocrResultsUrl } = await documentService.analyzeDocument(session.document);
    
    // Validate OCR results
    const validation = documentService.validateDocumentData(ocrResults);
    
    // Store FULL data in session (including buffers and raw response)
    const updatedDocument = {
      ...session.document,
      ocrResults, // Full OCR results stored in backend
      isValid: validation.isValid,
      validationErrors: validation.errors,
      confidenceScore: ocrResults.confidence,
      extractedPhotoBuffer: photoBuffer || undefined, // Binary data stored in backend
      extractedPhotoUrl: photoUrl || undefined,
      ocrResultsUrl: ocrResultsUrl || undefined,
    };
    
    sessionManager.updateDocument(sessionId, updatedDocument);
    
    // Return LEAN OCR data to frontend (no rawResponse, no buffers)
    // Only essential extracted fields are sent to frontend
    const leanOcrResults = {
      documentType: ocrResults.documentType,
      extractedData: ocrResults.extractedData, // Only extracted fields, no photoRegion polygon details
      confidence: ocrResults.confidence,
      processedAt: ocrResults.processedAt,
      photoUrl: ocrResults.photoUrl, // URL reference only
    };
    
    // Remove photoRegion from extractedData sent to frontend (large polygon arrays)
    if (leanOcrResults.extractedData.photoRegion) {
      delete leanOcrResults.extractedData.photoRegion;
    }
    
    const response: DocumentOCRResponse = {
      success: validation.isValid,
      ocrResults: leanOcrResults as any, // Lean version without rawResponse
      isValid: validation.isValid,
      validationErrors: validation.errors,
      message: validation.isValid 
        ? 'Document verified successfully'
        : 'Document validation failed',
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error performing OCR:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to perform OCR',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/face-liveness (Secure Verification)
 * Combined face verification + liveness check in a single atomic operation.
 * This prevents spoofing attacks where user shows document during face capture
 * but uses their actual face during liveness check.
 * 
 * The endpoint:
 * 1. Matches the initial face capture against the document photo
 * 2. Performs liveness checks on the captured frames
 * 3. Verifies face consistency between face capture and liveness frames
 */
router.post('/face-liveness', upload.fields([
  { name: 'faceImage', maxCount: 1 },
  { name: 'frames', maxCount: 30 }
]), async (req: Request, res: Response) => {
  try {
    const { sessionId, documentId }: CombinedFaceLivenessRequest = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const faceImage = files?.faceImage?.[0];
    const frames = files?.frames || [];
    
    console.log(`[KYC Routes] Combined face+liveness request - sessionId: ${sessionId}, faceImage: ${!!faceImage}, frames: ${frames.length}`);
    
    if (!sessionId || !documentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters',
        message: 'sessionId and documentId are required',
      } as ErrorResponse);
    }
    
    if (!faceImage) {
      return res.status(400).json({
        success: false,
        error: 'Missing faceImage',
        message: 'Initial face image is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    if (!session.document || session.document.documentId !== documentId) {
      return res.status(404).json({
        success: false,
        error: 'Document not found',
        message: `Document ${documentId} not found in session`,
      } as ErrorResponse);
    }
    
    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    
    // Save captured face image
    const faceImagePath = path.join(UPLOADS_DIR, `${documentId}-face.jpg`);
    fs.writeFileSync(faceImagePath, faceImage.buffer);
    console.log(`[KYC Routes] Saved captured face image: ${faceImagePath}`);
    
    // Get document photo for face verification
    const photoImagePath = path.join(UPLOADS_DIR, `${documentId}-photo.jpg`);
    
    if (!fs.existsSync(photoImagePath)) {
      return res.status(400).json({
        success: false,
        error: 'Document photo not available',
        message: `Document photo not found: ${photoImagePath}`,
      } as ErrorResponse);
    }
    
    // ============================================================
    // STEP 1: Face Matching (face capture vs document photo)
    // ============================================================
    console.log(`[KYC Routes] Step 1: Face matching...`);
    const faceBuffer = fs.readFileSync(faceImagePath);
    const photoBuffer = fs.readFileSync(photoImagePath);
    
    const faceMatchResult = await faceVerificationService.verifyFaceMatch(
      faceBuffer,
      photoBuffer
    );
    
    console.log(`[KYC Routes] Face match result: isMatch=${faceMatchResult.isMatch}, score=${faceMatchResult.matchScore}`);
    
    // ============================================================
    // STEP 2: Liveness Check
    // ============================================================
    console.log(`[KYC Routes] Step 2: Liveness check with ${frames.length} frames...`);
    const frameBuffers = frames.map(f => f.buffer);
    
    const livenessResult = await livenessCheckService.performLivenessCheck(
      frameBuffers,
      { sessionId }
    );
    
    console.log(`[KYC Routes] Liveness result: overallResult=${livenessResult.overallResult}, confidence=${livenessResult.confidenceScore}`);
    
    // ============================================================
    // STEP 3: Face Consistency Check (face capture vs liveness frames)
    // This is the KEY anti-spoofing measure that prevents using
    // different faces for face matching vs liveness
    // ============================================================
    console.log(`[KYC Routes] Step 3: Face consistency check...`);
    
    let faceConsistencyResult = {
      isConsistent: true,
      consistencyScore: 1.0,
      message: 'Face consistency verified',
    };
    
    if (frameBuffers.length > 0) {
      // Select representative frames from liveness check for consistency verification
      // Use frames from middle and end to capture different poses
      const representativeIndices = [
        0,  // First frame
        Math.floor(frameBuffers.length / 2),  // Middle frame
        frameBuffers.length - 1,  // Last frame
      ].filter((idx, i, arr) => arr.indexOf(idx) === i); // Remove duplicates
      
      const consistencyScores: number[] = [];
      
      for (const idx of representativeIndices) {
        try {
          const livenessFrame = frameBuffers[idx];
          const consistencyMatch = await faceVerificationService.verifyFaceMatch(
            faceBuffer,  // Original face capture
            livenessFrame  // Frame from liveness
          );
          consistencyScores.push(consistencyMatch.matchScore);
          console.log(`[KYC Routes] Consistency check frame ${idx}: score=${consistencyMatch.matchScore}`);
        } catch (err) {
          console.warn(`[KYC Routes] Failed to check consistency for frame ${idx}:`, err);
          // Continue with other frames
        }
      }
      
      if (consistencyScores.length > 0) {
        // Calculate average consistency score
        const avgConsistencyScore = consistencyScores.reduce((a, b) => a + b, 0) / consistencyScores.length;
        
        // Threshold for face consistency (slightly lower than face match since poses vary)
        const CONSISTENCY_THRESHOLD = 0.50;
        
        faceConsistencyResult = {
          isConsistent: avgConsistencyScore >= CONSISTENCY_THRESHOLD,
          consistencyScore: avgConsistencyScore,
          message: avgConsistencyScore >= CONSISTENCY_THRESHOLD
            ? 'Face consistency verified - same person in face capture and liveness'
            : 'Face inconsistency detected - different faces in face capture vs liveness',
        };
        
        console.log(`[KYC Routes] Face consistency result: isConsistent=${faceConsistencyResult.isConsistent}, avgScore=${avgConsistencyScore}`);
      }
    }
    
    // ============================================================
    // COMBINED RESULT
    // All three checks must pass for overall success
    // ============================================================
    const overallResult = 
      faceMatchResult.isMatch && 
      livenessResult.overallResult && 
      faceConsistencyResult.isConsistent;
    
    let message = '';
    if (!faceMatchResult.isMatch) {
      message = 'Face does not match document photo';
    } else if (!livenessResult.overallResult) {
      message = 'Liveness check failed';
    } else if (!faceConsistencyResult.isConsistent) {
      message = 'Face inconsistency detected between face capture and liveness check';
    } else {
      message = 'Face verification and liveness check passed successfully';
    }
    
    // Update secure verification in session (combined face + liveness + consistency)
    sessionManager.updateSecureVerification(sessionId, {
      faceMatch: {
        isMatch: faceMatchResult.isMatch,
        matchScore: faceMatchResult.matchScore,
        confidence: faceMatchResult.confidence,
        capturedImageUrl: `/uploads/${documentId}-face.jpg`,
        documentPhotoUrl: `/uploads/${documentId}-photo.jpg`,
      },
      liveness: {
        overallResult: livenessResult.overallResult,
        checks: livenessResult.checks,
        confidenceScore: livenessResult.confidenceScore,
      },
      faceConsistency: faceConsistencyResult,
      overallResult,
      verifiedAt: new Date(),
    });
    
    const response: CombinedFaceLivenessResponse = {
      success: overallResult,
      faceMatch: {
        isMatch: faceMatchResult.isMatch,
        matchScore: faceMatchResult.matchScore,
        confidence: faceMatchResult.confidence,
      },
      liveness: {
        overallResult: livenessResult.overallResult,
        checks: livenessResult.checks,
        confidenceScore: livenessResult.confidenceScore,
      },
      faceConsistency: faceConsistencyResult,
      overallResult,
      message,
    };
    
    console.log(`[KYC Routes] Combined face+liveness result: overall=${overallResult}`);
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error in combined face+liveness:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to perform combined face and liveness verification',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/complete
 * Mark session as complete
 */
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const { sessionId }: CompleteKYCRequest = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Complete session - now respects workflow configuration
    const result = sessionManager.completeSession(sessionId);
    
    // Get updated session for status
    const updatedSession = sessionManager.getSession(sessionId);
    
    // Auto-generate and save the KYC report (only if not already generated)
    if (updatedSession) {
      const existingReport = reportService.getReportPath(sessionId);
      if (!existingReport) {
        try {
          const report = await reportService.generatePDFReport(updatedSession);
          console.log(`[KYC Routes] Report saved: ${report.filepath}`);
        } catch (reportError) {
          console.error('[KYC Routes] Failed to generate report:', reportError);
          // Don't fail the completion if report generation fails
        }
      } else {
        console.log(`[KYC Routes] Report already exists for session ${sessionId}`);
      }
    }
    
    const response = {
      success: result.success,
      sessionId,
      status: updatedSession?.status || session.status,
      verificationResults: result.verificationResults,
      requiredSteps: result.requiredSteps,
      message: result.message,
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error completing session:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to complete session',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/session/:id/summary
 * Get session summary (download report)
 * For JSON format: returns lean session data without binary buffers
 * For PDF/TXT format: generates report from full session data
 */
router.get('/session/:id/summary', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    
    // Get full session for report generation
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Check if report format is requested
    const format = req.query.format as string || 'json';
    
    if (format === 'pdf' || format === 'txt') {
      // Check if report already exists
      const existingReportPath = reportService.getReportPath(sessionId);
      
      let reportBuffer: Buffer;
      
      if (existingReportPath) {
        // Use existing report
        const fs = require('fs');
        reportBuffer = fs.readFileSync(existingReportPath);
        console.log(`[KYC Routes] Using existing report: ${existingReportPath}`);
      } else {
        // Generate new report from full session data
        const report = await reportService.generatePDFReport(session);
        reportBuffer = report.buffer;
      }
      
      const contentType = format === 'pdf' 
        ? 'application/pdf'
        : 'text/plain';
      
      const filename = `kyc_report_${sessionId}.${format === 'pdf' ? 'pdf' : 'txt'}`;
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(reportBuffer);
    } else {
      // Return lean JSON summary (no binary data)
      const leanSession = sessionManager.getLeanSession(sessionId);
      if (!leanSession) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
          message: `Session ${sessionId} not found`,
        } as ErrorResponse);
      }
      // Generate summary from lean session
      const summary = reportService.generateSessionSummary(session);
      // Ensure no binary data in summary response
      if (summary.document) {
        delete (summary.document as any).imageBuffer;
        delete (summary.document as any).extractedPhotoBuffer;
        if (summary.document.ocrResults) {
          delete (summary.document.ocrResults as any).rawResponse;
          delete (summary.document.ocrResults as any).photoBuffer;
        }
      }
      res.status(200).json(summary);
    }
  } catch (error) {
    console.error('[KYC Routes] Error generating summary:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to generate session summary',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/session/:id
 * Get session details
 * Returns lean session data without binary buffers to minimize payload size.
 * All binary data (images, frames) remains stored on the server - only URLs are returned.
 */
router.get('/session/:id', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    
    // Use lean session to avoid sending binary data to frontend
    const session = sessionManager.getLeanSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    res.status(200).json({
      success: true,
      session,
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting session:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get session',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/sessions
 * Get all sessions (for admin/monitoring)
 * Returns lean session data without binary buffers to minimize payload size.
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    // Use lean sessions to avoid sending binary data
    const sessions = sessionManager.getAllLeanSessions();
    const stats = sessionManager.getStatistics();
    
    res.status(200).json({
      success: true,
      count: sessions.length,
      statistics: stats,
      sessions,
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get sessions',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/questionnaire/sets
 * Get available question sets
 */
router.get('/questionnaire/sets', async (req: Request, res: Response) => {
  try {
    const setNames = questionnaireService.getAvailableQuestionSets();
    
    // Build detailed question set info for admin UI
    const questionSets = setNames.map(name => {
      const setDetails = questionnaireService.getQuestionSetDetails(name);
      const questionCount = setDetails 
        ? setDetails.required.length + setDetails.optional.length 
        : 0;
      
      // Generate description based on set name
      const descriptions: Record<string, string> = {
        'basic': 'Basic identity verification questions (name, DOB, document number)',
        'comprehensive': 'Full verification with detailed document and personal questions',
        'presence': 'Presence verification questions to confirm live participation',
      };
      
      // Generate display name
      const displayNames: Record<string, string> = {
        'basic': 'Basic Verification',
        'comprehensive': 'Comprehensive Verification',
        'presence': 'Presence Verification',
      };
      
      return {
        id: name,
        name: displayNames[name] || name.charAt(0).toUpperCase() + name.slice(1),
        description: descriptions[name] || `Question set: ${name}`,
        questionCount,
      };
    });
    
    res.status(200).json({
      success: true,
      questionSets,
      message: 'Available question sets retrieved',
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting question sets:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get question sets',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/questionnaire/questions
 * Get questions for a session
 */
router.get('/questionnaire/questions', async (req: Request, res: Response) => {
  try {
    const { sessionId, questionSet = 'basic', includeOptional = 'false' } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId query parameter is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId as string);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Check if document verification is required by workflow
    // Only require document verification if:
    // 1. Workflow includes document OCR step, AND
    // 2. Question set is not 'presence' (presence questions don't need document data)
    const workflowRequiresDocument = session.workflowSteps?.documentOCR !== false;
    const questionSetRequiresDocument = questionSet !== 'presence';
    
    if (workflowRequiresDocument && questionSetRequiresDocument && !session.document?.isValid) {
      // Document verification is required but not completed
      // Log a warning but allow questionnaire to proceed
      // Answers will be collected but not verified against document data
      console.warn(`[KYC Routes] Questionnaire requested without document verification for session ${sessionId}`);
    }
    
    const questions = questionnaireService.getQuestions(
      questionSet as string,
      includeOptional === 'true'
    );
    
    res.status(200).json({
      success: true,
      sessionId,
      questionSet,
      questions,
      message: 'Questions retrieved successfully',
    });
  } catch (error: any) {
    console.error('[KYC Routes] Error getting questions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get questions',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/questionnaire/submit
 * Submit questionnaire answers
 */
router.post('/questionnaire/submit', async (req: Request, res: Response) => {
  try {
    const { sessionId, questionSet = 'basic', answers } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Missing answers',
        message: 'answers object is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    // Get questions
    const questions = questionnaireService.getQuestions(questionSet, true);
    
    // Convert answers object to Map
    const answersMap = new Map<string, string>();
    Object.entries(answers).forEach(([key, value]) => {
      answersMap.set(key, value as string);
    });
    
    // Get document data for verification (if available)
    const documentData = session.document?.ocrResults?.extractedData;
    
    // Verify answers
    const questionnaireData = questionnaireService.verifyAnswers(
      questions,
      answersMap,
      documentData
    );
    
    // Update session
    sessionManager.updateQuestionnaire(sessionId, questionnaireData);
    
    res.status(200).json({
      success: questionnaireData.passed,
      sessionId,
      questionnaire: questionnaireData,
      message: questionnaireData.passed
        ? 'Questionnaire completed successfully'
        : 'Questionnaire failed - answers do not match expected values',
    });
  } catch (error: any) {
    console.error('[KYC Routes] Error submitting questionnaire:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to submit questionnaire',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/questionnaire/set/:name
 * Get details of a specific question set
 */
router.get('/questionnaire/set/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    
    const questionSet = questionnaireService.getQuestionSetDetails(name);
    
    if (!questionSet) {
      return res.status(404).json({
        success: false,
        error: 'Question set not found',
        message: `Question set '${name}' not found`,
      } as ErrorResponse);
    }
    
    res.status(200).json({
      success: true,
      name,
      questionSet,
      message: 'Question set details retrieved',
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting question set:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get question set details',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/location/compare
 * Compare user's GPS location with document address
 * If latitude/longitude provided, uses GPS coordinates
 * If not provided, uses IP-based location from request IP
 * If allowedRadiusKm is provided, uses radius-based comparison
 * If not provided, falls back to country-based comparison
 */
router.post('/location/compare', async (req: Request, res: Response) => {
  try {
    const { sessionId, latitude, longitude, documentAddress, allowedRadiusKm } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    if (!documentAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing documentAddress',
        message: 'documentAddress is required',
      } as ErrorResponse);
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        message: `Session ${sessionId} not found`,
      } as ErrorResponse);
    }
    
    let lat: number;
    let lon: number;
    let locationSource: 'gps' | 'ip' = 'gps';
    
    // Check if GPS coordinates are provided
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      lat = latitude;
      lon = longitude;
      locationSource = 'gps';
      console.log(`[KYC Routes] Using GPS coordinates: ${lat}, ${lon}`);
    } else {
      // Fall back to IP-based location
      console.log(`[KYC Routes] GPS not available, using IP-based location for IP: ${req.ip}`);
      const ipLocation = await locationService.captureIPLocation(req.ip || '');
      
      const ipLat = ipLocation?.latitude;
      const ipLon = ipLocation?.longitude;
      
      if (ipLat === undefined || ipLon === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Location unavailable',
          message: 'Could not determine location from GPS or IP address',
        } as ErrorResponse);
      }
      
      lat = ipLat;
      lon = ipLon;
      locationSource = 'ip';
      
      // Store IP location in session
      sessionManager.updateLocation(sessionId, {
        ip: ipLocation,
        capturedAt: new Date(),
      });
      
      console.log(`[KYC Routes] Using IP-based coordinates: ${lat}, ${lon} (${ipLocation?.city}, ${ipLocation?.country})`);
    }
    
    // Perform location comparison
    // If allowedRadiusKm is not provided or <= 0, it will use country-based comparison
    const comparisonResult = await locationService.compareLocationWithAddress(
      lat,
      lon,
      documentAddress,
      allowedRadiusKm
    );
    
    // Add location source to result
    const resultWithSource = {
      ...comparisonResult,
      locationSource,
    };
    
    console.log(`[KYC Routes] Location comparison for session ${sessionId} (source: ${locationSource}, type: ${comparisonResult.verificationType}):`, resultWithSource);
    
    // Update the session's locationVerified based on the comparison result
    sessionManager.updateLocationVerified(sessionId, comparisonResult.verified);
    
    res.status(200).json({
      success: true,
      ...resultWithSource,
      documentAddress,
    });
  } catch (error) {
    console.error('[KYC Routes] Error comparing location:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to compare location with document address',
    } as ErrorResponse);
  }
});

export default router;
export { 
  sessionManager, 
  locationService, 
  documentService, 
  faceVerificationService, 
  livenessCheckService, 
  reportService,
  questionnaireService 
};

