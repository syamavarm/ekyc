/**
 * KYC Session Manager
 * Manages KYC session state and data throughout the verification process
 */

import {
  KYCSession,
  KYCStatus,
  ConsentData,
  LocationData,
  DocumentData,
  FaceVerificationData,
  LivenessCheckData,
  QuestionnaireData,
  VerificationResults,
} from '../types/kyc.types';
import { v4 as uuidv4 } from 'uuid';

export class KYCSessionManager {
  private sessions: Map<string, KYCSession>;
  private sessionExpiryMs: number;

  constructor(sessionExpiryMs: number = 30 * 60 * 1000) { // Default: 30 minutes
    this.sessions = new Map();
    this.sessionExpiryMs = sessionExpiryMs;
    
    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Create a new KYC session
   */
  createSession(
    userId: string,
    email?: string,
    mobileNumber?: string,
    workflowConfigId?: string,
    workflowSteps?: any
  ): KYCSession {
    const sessionId = uuidv4();
    
    const session: KYCSession = {
      sessionId,
      userId,
      email,
      mobileNumber,
      workflowConfigId,
      workflowSteps,
      status: 'initiated',
      createdAt: new Date(),
      updatedAt: new Date(),
      consent: {
        videoRecording: false,
        locationTracking: false,
        documentUse: false,
        timestamp: new Date(),
      },
      verificationResults: {
        documentVerified: false,
        faceVerified: false,
        livenessVerified: false,
        locationVerified: false,
        overallVerified: false,
      },
    };
    
    this.sessions.set(sessionId, session);
    console.log(`[KYCSessionManager] Session created: ${sessionId}${workflowConfigId ? ` with workflow config: ${workflowConfigId}` : ''}`);
    
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): KYCSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions (for admin/monitoring)
   */
  getAllSessions(): KYCSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions by user ID
   */
  getSessionsByUser(userId: string): KYCSession[] {
    return Array.from(this.sessions.values()).filter(
      session => session.userId === userId
    );
  }

  /**
   * Update session status
   */
  updateStatus(sessionId: string, status: KYCStatus): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.status = status;
    session.updatedAt = new Date();
    
    if (status === 'completed' || status === 'failed') {
      session.completedAt = new Date();
    }
    
    console.log(`[KYCSessionManager] Session ${sessionId} status: ${status}`);
    return true;
  }

  /**
   * Update consent data
   */
  updateConsent(
    sessionId: string,
    consent: ConsentData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.consent = consent;
    session.status = 'consent_given';
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Consent updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update location data
   */
  updateLocation(
    sessionId: string,
    location: LocationData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.location = location;
    session.verificationResults.locationVerified = true;
    
    if (session.status === 'consent_given' || session.status === 'initiated') {
      session.status = 'location_captured';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Location updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update document data
   */
  updateDocument(
    sessionId: string,
    document: DocumentData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.document = document;
    
    if (document.isValid && document.ocrResults) {
      session.verificationResults.documentVerified = true;
      session.status = 'document_verified';
    } else {
      session.status = 'document_uploaded';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Document updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update face verification data
   */
  updateFaceVerification(
    sessionId: string,
    faceVerification: FaceVerificationData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.faceVerification = faceVerification;
    
    if (faceVerification.isMatch) {
      session.verificationResults.faceVerified = true;
      session.status = 'face_verified';
    } else {
      session.status = 'face_verification_pending';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Face verification updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update liveness check data
   */
  updateLivenessCheck(
    sessionId: string,
    livenessCheck: LivenessCheckData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.livenessCheck = livenessCheck;
    
    if (livenessCheck.overallResult) {
      session.verificationResults.livenessVerified = true;
      session.status = 'liveness_verified';
    } else {
      session.status = 'liveness_check_pending';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Liveness check updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update questionnaire data
   */
  updateQuestionnaire(
    sessionId: string,
    questionnaire: QuestionnaireData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.questionnaire = questionnaire;
    session.verificationResults.questionnaireVerified = questionnaire.passed;
    
    if (questionnaire.passed) {
      session.status = 'questionnaire_completed';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Questionnaire updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Complete KYC session
   * Respects the workflow configuration - only checks steps that are enabled
   */
  completeSession(sessionId: string): {
    success: boolean;
    message: string;
    verificationResults: VerificationResults;
    requiredSteps: {
      locationCapture: boolean;
      documentOCR: boolean;
      faceMatch: boolean;
      livenessCheck: boolean;
      questionnaire: boolean;
    };
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        success: false,
        message: 'Session not found',
        verificationResults: {
          documentVerified: false,
          faceVerified: false,
          livenessVerified: false,
          locationVerified: false,
          overallVerified: false,
        },
        requiredSteps: {
          locationCapture: true,
          documentOCR: true,
          faceMatch: true,
          livenessCheck: true,
          questionnaire: false,
        },
      };
    }
    
    const results = session.verificationResults;
    const workflowSteps = session.workflowSteps;
    
    // Determine which steps are required based on workflow config
    // If no workflow config, all steps are required (default behavior)
    const requiredSteps = {
      locationCapture: workflowSteps?.locationCapture ?? true,
      documentOCR: workflowSteps?.documentOCR ?? true,
      faceMatch: workflowSteps?.faceMatch ?? true,
      livenessCheck: workflowSteps?.livenessCheck ?? true,
      questionnaire: workflowSteps?.questionnaire ?? false,
    };
    
    console.log(`[KYCSessionManager] Required steps for session ${sessionId}:`, requiredSteps);
    console.log(`[KYCSessionManager] Current verification results:`, results);
    
    // Check if all REQUIRED verifications are complete
    let allRequiredVerified = true;
    let score = 0;
    let totalChecks = 0;
    
    // Location check - only if required
    if (requiredSteps.locationCapture) {
      totalChecks++;
      if (results.locationVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    // Document check - only if required
    if (requiredSteps.documentOCR) {
      totalChecks++;
      if (results.documentVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    // Face match check - only if required
    if (requiredSteps.faceMatch) {
      totalChecks++;
      if (results.faceVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    // Liveness check - only if required
    if (requiredSteps.livenessCheck) {
      totalChecks++;
      if (results.livenessVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    // Questionnaire check - only if required
    if (requiredSteps.questionnaire) {
      totalChecks++;
      if (results.questionnaireVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    results.overallVerified = allRequiredVerified;
    session.overallScore = totalChecks > 0 ? score / totalChecks : 1;
    
    // Update status
    if (allRequiredVerified) {
      session.status = 'completed';
      session.completedAt = new Date();
      console.log(`[KYCSessionManager] Session completed successfully: ${sessionId}`);
    } else {
      session.status = 'failed';
      session.completedAt = new Date();
      console.log(`[KYCSessionManager] Session failed: ${sessionId}`);
    }
    
    session.updatedAt = new Date();
    
    return {
      success: allRequiredVerified,
      message: allRequiredVerified 
        ? 'KYC verification completed successfully'
        : 'KYC verification incomplete or failed',
      verificationResults: results,
      requiredSteps,
    };
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`[KYCSessionManager] Session deleted: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Check if session is expired
   */
  isSessionExpired(session: KYCSession): boolean {
    const now = new Date().getTime();
    const sessionAge = now - session.createdAt.getTime();
    return sessionAge > this.sessionExpiryMs;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): number {
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isSessionExpired(session)) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[KYCSessionManager] Cleaned up ${cleanedCount} expired sessions`);
    }
    
    return cleanedCount;
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Get session statistics
   */
  getStatistics(): {
    total: number;
    byStatus: Record<KYCStatus, number>;
    completed: number;
    failed: number;
    inProgress: number;
  } {
    const sessions = Array.from(this.sessions.values());
    
    const byStatus: Partial<Record<KYCStatus, number>> = {};
    for (const session of sessions) {
      byStatus[session.status] = (byStatus[session.status] || 0) + 1;
    }
    
    return {
      total: sessions.length,
      byStatus: byStatus as Record<KYCStatus, number>,
      completed: byStatus['completed'] || 0,
      failed: byStatus['failed'] || 0,
      inProgress: sessions.filter(s => 
        !['completed', 'failed', 'expired'].includes(s.status)
      ).length,
    };
  }

  /**
   * Get a "lean" version of session data suitable for API responses.
   * Strips out large binary data (buffers) and raw responses to minimize payload size.
   * All binary data remains stored in the backend - only URLs/references are returned.
   */
  getLeanSession(sessionId: string): Omit<KYCSession, 'document'> & { document?: LeanDocumentData } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    return this.createLeanSession(session);
  }

  /**
   * Get all sessions in lean format (for admin/monitoring)
   */
  getAllLeanSessions(): Array<Omit<KYCSession, 'document'> & { document?: LeanDocumentData }> {
    return Array.from(this.sessions.values()).map(session => this.createLeanSession(session));
  }

  /**
   * Create lean session object by stripping binary data
   */
  private createLeanSession(session: KYCSession): Omit<KYCSession, 'document'> & { document?: LeanDocumentData } {
    const { document, ...sessionWithoutDoc } = session;
    
    // Create lean document data (without buffers)
    let leanDocument: LeanDocumentData | undefined;
    if (document) {
      const {
        imageBuffer,
        extractedPhotoBuffer,
        ocrResults,
        ...docWithoutBuffers
      } = document;
      
      // Create lean OCR results (without raw response and buffers)
      let leanOcrResults: LeanOCRResults | undefined;
      if (ocrResults) {
        const { rawResponse, photoBuffer, ...ocrWithoutRaw } = ocrResults;
        leanOcrResults = ocrWithoutRaw;
      }
      
      leanDocument = {
        ...docWithoutBuffers,
        ocrResults: leanOcrResults,
        // Keep URLs for reference
        hasImageBuffer: !!imageBuffer,
        hasExtractedPhoto: !!extractedPhotoBuffer,
      };
    }
    
    // Create lean face verification (without buffers)
    let leanFaceVerification = session.faceVerification;
    if (leanFaceVerification?.capturedImageBuffer) {
      const { capturedImageBuffer, ...faceWithoutBuffer } = leanFaceVerification;
      leanFaceVerification = {
        ...faceWithoutBuffer,
        hasCapturedImage: true,
      };
    }
    
    // Create lean liveness data (without video frames if stored)
    let leanLivenessCheck = session.livenessCheck;
    if (leanLivenessCheck?.videoFrames && leanLivenessCheck.videoFrames.length > 0) {
      const { videoFrames, ...livenessWithoutFrames } = leanLivenessCheck;
      leanLivenessCheck = {
        ...livenessWithoutFrames,
        frameCount: videoFrames.length,
      };
    }
    
    return {
      ...sessionWithoutDoc,
      document: leanDocument,
      faceVerification: leanFaceVerification as FaceVerificationData | undefined,
      livenessCheck: leanLivenessCheck as LivenessCheckData | undefined,
    };
  }
}

/**
 * Lean document data without binary buffers (for API responses)
 */
export interface LeanDocumentData {
  documentId: string;
  documentType: import('../types/kyc.types').DocumentType;
  uploadedAt: Date;
  imageUrl: string;
  isValid: boolean;
  validationErrors?: string[];
  confidenceScore?: number;
  extractedPhotoUrl?: string;
  ocrResultsUrl?: string;
  ocrResults?: LeanOCRResults;
  // Flags indicating binary data exists on server
  hasImageBuffer?: boolean;
  hasExtractedPhoto?: boolean;
}

/**
 * Lean OCR results without raw response and binary data
 */
export interface LeanOCRResults {
  documentType: import('../types/kyc.types').DocumentType;
  extractedData: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    expiryDate?: string;
    issueDate?: string;
    nationality?: string;
    gender?: string;
    address?: string;
    placeOfBirth?: string;
    photoRegion?: Array<{
      pageNumber: number;
      polygon: number[];
    }>;
  };
  photoUrl?: string;
  confidence: number;
  processedAt: Date;
}

