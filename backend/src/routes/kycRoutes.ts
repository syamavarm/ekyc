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
import { FormService } from '../services/formService';
import { sessionTimelineService } from '../services/sessionTimelineService';
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
const formService = new FormService();

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
 * POST /kyc/location/reverse-geocode
 * Reverse geocode GPS coordinates to get readable address
 * Used to display current location during the session
 */
router.post('/location/reverse-geocode', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing coordinates',
        message: 'latitude and longitude are required',
      } as ErrorResponse);
    }
    
    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates',
        message: 'latitude must be between -90 and 90, longitude between -180 and 180',
      } as ErrorResponse);
    }
    
    // Reverse geocode the coordinates
    const result = await locationService.reverseGeocode(latitude, longitude);
    
    if (!result) {
      return res.status(200).json({
        success: true,
        location: null,
        message: 'Could not reverse geocode the coordinates',
      });
    }
    
    // Format a short display string
    let displayLocation = '';
    if (result.city && result.state) {
      displayLocation = `${result.city}, ${result.state}`;
    } else if (result.city) {
      displayLocation = result.city;
    } else if (result.state) {
      displayLocation = result.state;
    } else if (result.country) {
      displayLocation = result.country;
    }
    
    res.status(200).json({
      success: true,
      location: {
        displayLocation,
        city: result.city,
        state: result.state,
        country: result.country,
        countryCode: result.countryCode,
        formattedAddress: result.formattedAddress,
      },
      message: 'Location reverse geocoded successfully',
    });
  } catch (error) {
    console.error('[KYC Routes] Error reverse geocoding:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to reverse geocode location',
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
 * POST /kyc/document/upload-both-sides
 * Upload both front and back sides of an ID document
 */
router.post('/document/upload-both-sides', upload.fields([
  { name: 'documentFront', maxCount: 1 },
  { name: 'documentBack', maxCount: 1 }
]), async (req: Request, res: Response) => {
  try {
    const { sessionId, documentType } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
        message: 'sessionId is required',
      } as ErrorResponse);
    }
    
    const frontFile = files?.documentFront?.[0];
    const backFile = files?.documentBack?.[0];
    
    if (!frontFile || !backFile) {
      return res.status(400).json({
        success: false,
        error: 'Missing documents',
        message: 'Both front and back document images are required',
      } as ErrorResponse);
    }
    
    if (!documentType) {
      return res.status(400).json({
        success: false,
        error: 'Missing documentType',
        message: 'documentType is required',
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
    
    // Save both documents with linked IDs
    const documentData = await documentService.saveDocumentBothSides(
      frontFile.buffer,
      backFile.buffer,
      documentType,
      frontFile.originalname
    );
    
    // Update session with combined document data
    sessionManager.updateDocument(sessionId, documentData);
    
    const response: DocumentUploadResponse = {
      success: true,
      documentId: documentData.documentId,
      imageUrl: documentData.imageUrl,
      message: 'Both sides of document uploaded successfully',
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('[KYC Routes] Error uploading document sides:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to upload document sides',
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
    
    // Perform document analysis (OCR only - face verification uses document front directly)
    const { ocrResults, ocrResultsUrl } = await documentService.analyzeDocument(session.document);
    
    // Validate OCR results
    const validation = documentService.validateDocumentData(ocrResults);
    
    // Store data in session
    const updatedDocument = {
      ...session.document,
      ocrResults,
      isValid: validation.isValid,
      validationErrors: validation.errors,
      confidenceScore: ocrResults.confidence,
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
    };
    
    const response: DocumentOCRResponse = {
      success: validation.isValid,
      ocrResults: leanOcrResults as any, // Lean version without rawResponse
      isValid: validation.isValid,
      validationErrors: validation.errors,
      message: validation.isValid 
        ? 'Document verified successfully'
        : 'Document validation failed',
    };
    
    // Log backend decision to session timeline for replay
    sessionTimelineService.saveBackendDecision(sessionId, 'ocr_result', validation.isValid, {
      confidence: ocrResults.confidence,
      additionalData: { 
        documentType: ocrResults.documentType,
        extractedFields: Object.keys(ocrResults.extractedData || {}),
      },
    });
    
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
    
    // Get document image for face verification
    // Prefer front document image (better for Azure Face API), fallback to extracted photo
    const frontImagePath = path.join(UPLOADS_DIR, `${documentId}-front.jpg`);
    const photoImagePath = path.join(UPLOADS_DIR, `${documentId}-photo.jpg`);
    
    let documentImagePath: string;
    if (fs.existsSync(frontImagePath)) {
      documentImagePath = frontImagePath;
      console.log(`[KYC Routes] Using front document image for face matching: ${frontImagePath}`);
    } else if (fs.existsSync(photoImagePath)) {
      documentImagePath = photoImagePath;
      console.log(`[KYC Routes] Using extracted photo for face matching: ${photoImagePath}`);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Document image not available',
        message: `No document image found for face verification`,
      } as ErrorResponse);
    }
    
    // ============================================================
    // STEP 1: Face Matching (face capture vs document image)
    // ============================================================
    console.log(`[KYC Routes] Step 1: Face matching...`);
    const faceBuffer = fs.readFileSync(faceImagePath);
    const documentBuffer = fs.readFileSync(documentImagePath);
    
    const faceMatchResult = await faceVerificationService.verifyFaceMatch(
      faceBuffer,
      documentBuffer
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
        documentImageUrl: `/uploads/${documentId}-front.jpg`,
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
    
    // Log backend decisions to session timeline for replay
    sessionTimelineService.saveBackendDecision(sessionId, 'face_match', faceMatchResult.isMatch, {
      score: faceMatchResult.matchScore,
      confidence: faceMatchResult.confidence,
    });
    
    sessionTimelineService.saveBackendDecision(sessionId, 'liveness_check', livenessResult.overallResult, {
      confidence: livenessResult.confidenceScore,
      additionalData: { checks: livenessResult.checks },
    });
    
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
 * POST /kyc/otp-verification
 * Update session with OTP voice verification result or escalation status
 * Called after OTP verification attempt on frontend
 */
router.post('/otp-verification', async (req: Request, res: Response) => {
  try {
    const { sessionId, verified, attempts, escalated, escalationReason } = req.body;
    
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
        message: `No KYC session found with ID: ${sessionId}`,
      } as ErrorResponse);
    }
    
    // Get current secure verification data
    const currentSecureVerification = session.secureVerification;
    if (!currentSecureVerification) {
      return res.status(400).json({
        success: false,
        error: 'No secure verification data',
        message: 'Face/liveness verification must be completed first',
      } as ErrorResponse);
    }
    
    // Update with OTP verification result
    const updatedSecureVerification = {
      ...currentSecureVerification,
      otpVoiceVerification: {
        verified: verified === true,
        attempts: attempts || 1,
        verifiedAt: verified ? new Date() : undefined,
      },
      // Update overall result based on OTP
      overallResult: currentSecureVerification.faceMatch.isMatch && 
                     currentSecureVerification.liveness.overallResult &&
                     currentSecureVerification.faceConsistency.isConsistent &&
                     verified === true,
    };
    
    // Add escalation if applicable
    if (escalated) {
      updatedSecureVerification.escalation = {
        escalated: true,
        reason: escalationReason || 'Verification could not be completed automatically',
        escalatedAt: new Date(),
      };
      // If escalated, overall result is false (needs manual review)
      updatedSecureVerification.overallResult = false;
    }
    
    // Update session
    sessionManager.updateSecureVerification(sessionId, updatedSecureVerification);
    
    // Log to timeline - always log OTP decision
    // Always log OTP verification result (pass or fail)
    sessionTimelineService.saveBackendDecision(sessionId, 'otp_verification', verified === true, {
      additionalData: { 
        attempts: attempts,
        verified: verified === true,
        reason: !verified ? (escalationReason || 'OTP mismatch') : undefined,
      },
    });
    
    // Additionally log escalation if applicable
    if (escalated) {
      sessionTimelineService.saveBackendDecision(sessionId, 'escalation', false, {
        additionalData: { 
          reason: escalationReason,
          totalOtpAttempts: attempts,
        },
      });
    }
    
    console.log(`[KYC Routes] OTP verification update: sessionId=${sessionId}, verified=${verified}, escalated=${escalated}`);
    
    res.status(200).json({
      success: true,
      overallResult: updatedSecureVerification.overallResult,
      escalated: escalated || false,
      message: escalated 
        ? 'Session escalated for manual review' 
        : verified 
          ? 'OTP verification successful - all checks passed'
          : 'OTP verification failed',
    });
  } catch (error) {
    console.error('[KYC Routes] Error updating OTP verification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to update OTP verification status',
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
    
    // Auto-generate and save the KYC report and combined data JSON
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
      
      // Generate form data JSON (OCR + Form fields)
      try {
        const formData = reportService.generateFormDataJSON(updatedSession);
        console.log(`[KYC Routes] Form data JSON saved: ${formData.filepath}`);
      } catch (dataError) {
        console.error('[KYC Routes] Failed to generate form data JSON:', dataError);
        // Don't fail the completion if form data generation fails
      }
    }
    
    // Log backend decision to session timeline for replay
    sessionTimelineService.saveBackendDecision(sessionId, 'session_complete', result.success, {
      score: updatedSession?.overallScore,
      additionalData: {
        verificationResults: result.verificationResults,
        requiredSteps: result.requiredSteps,
      },
    });
    
    // Persist session timeline data
    sessionTimelineService.persistSession(sessionId);
    
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
        if (summary.document.ocrResults) {
          delete (summary.document.ocrResults as any).rawResponse;
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
 * GET /kyc/session/:id/formdata
 * Get form data as JSON (OCR + Form field values)
 * Returns a flat JSON with document data and form responses
 */
router.get('/session/:id/formdata', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    
    // Try to load existing form data
    let formData = reportService.loadFormData(sessionId);
    
    if (!formData) {
      // Generate it from the session if not exists
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
          message: `Session ${sessionId} not found`,
        } as ErrorResponse);
      }
      
      const result = reportService.generateFormDataJSON(session);
      formData = result.data;
    }
    
    res.status(200).json({
      success: true,
      data: formData,
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting form data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get form data',
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
 * GET /kyc/form/sets
 * Get available field sets
 */
router.get('/form/sets', async (req: Request, res: Response) => {
  try {
    const setNames = formService.getAvailableFieldSets();
    
    // Build detailed field set info for admin UI
    const fieldSets = setNames.map(name => {
      const setDetails = formService.getFieldSetDetails(name);
      const fieldCount = setDetails 
        ? setDetails.required.length + setDetails.optional.length 
        : 0;
      
      // Generate description based on set name
      const descriptions: Record<string, string> = {
        'account_opening': 'Savings/Current account opening - purpose, employment, income source',
        'credit_card': 'Credit card application - income, employment, existing credit, spending patterns',
        'investment': 'Investment/Mutual fund account - risk tolerance, investment goals, experience',
        'loan_application': 'Loan application - loan type, amount, income, credit history',
      };
      
      // Generate display name
      const displayNames: Record<string, string> = {
        'account_opening': 'Account Opening',
        'credit_card': 'Credit Card Application',
        'investment': 'Investment Account',
        'loan_application': 'Loan Application',
      };
      
      return {
        id: name,
        name: displayNames[name] || name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
        description: descriptions[name] || `Field set: ${name}`,
        fieldCount,
      };
    });
    
    res.status(200).json({
      success: true,
      fieldSets,
      message: 'Available field sets retrieved',
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting field sets:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get field sets',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/form/fields
 * Get form fields for a session
 */
router.get('/form/fields', async (req: Request, res: Response) => {
  try {
    const { sessionId, fieldSet = 'account_opening', includeOptional = 'false' } = req.query;
    
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
    
    // Note: Form-specific field sets (account_opening, credit_card, investment, loan_application)
    // don't require document data as they collect application-specific information
    // Document verification is handled separately in the workflow
    
    const fields = formService.getFields(
      fieldSet as string,
      includeOptional === 'true'
    );
    
    res.status(200).json({
      success: true,
      sessionId,
      fieldSet,
      fields,
      message: 'Form fields retrieved successfully',
    });
  } catch (error: any) {
    console.error('[KYC Routes] Error getting form fields:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to get form fields',
    } as ErrorResponse);
  }
});

/**
 * POST /kyc/form/submit
 * Submit form answers
 */
router.post('/form/submit', async (req: Request, res: Response) => {
  try {
    const { sessionId, fieldSet = 'account_opening', answers } = req.body;
    
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
    
    // Get fields
    const fields = formService.getFields(fieldSet, true);
    
    // Convert answers object to Map
    const answersMap = new Map<string, string>();
    Object.entries(answers).forEach(([key, value]) => {
      answersMap.set(key, value as string);
    });
    
    // Get document data for verification (if available)
    const documentData = session.document?.ocrResults?.extractedData;
    
    // Verify answers
    const formData = formService.verifyAnswers(
      fields,
      answersMap,
      documentData
    );
    
    // Update session
    sessionManager.updateForm(sessionId, formData);
    
    // Log backend decision to session timeline for replay
    sessionTimelineService.saveBackendDecision(sessionId, 'form_result', formData.passed, {
      score: formData.score,
      additionalData: {
        fieldSet,
        totalFields: formData.fields.length,
      },
    });
    
    res.status(200).json({
      success: formData.passed,
      sessionId,
      form: formData,
      message: formData.passed
        ? 'Form completed successfully'
        : 'Form failed - answers do not match expected values',
    });
  } catch (error: any) {
    console.error('[KYC Routes] Error submitting form:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Failed to submit form',
    } as ErrorResponse);
  }
});

/**
 * GET /kyc/form/set/:name
 * Get details of a specific field set
 */
router.get('/form/set/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    
    const fieldSet = formService.getFieldSetDetails(name);
    
    if (!fieldSet) {
      return res.status(404).json({
        success: false,
        error: 'Field set not found',
        message: `Field set '${name}' not found`,
      } as ErrorResponse);
    }
    
    res.status(200).json({
      success: true,
      name,
      fieldSet,
      message: 'Field set details retrieved',
    });
  } catch (error) {
    console.error('[KYC Routes] Error getting field set:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to get field set details',
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
    
    // Log backend decision to session timeline for replay
    sessionTimelineService.saveBackendDecision(sessionId, 'location_check', comparisonResult.verified, {
      additionalData: {
        verificationType: comparisonResult.verificationType,
        locationSource,
        distanceKm: comparisonResult.distanceKm,
        message: comparisonResult.message,
      },
    });
    
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
  formService 
};

