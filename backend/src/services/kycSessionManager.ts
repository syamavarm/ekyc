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
  SecureVerificationData,
  FormData,
  VerificationResults,
} from '../types/kyc.types';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export class KYCSessionManager {
  private sessions: Map<string, KYCSession>;
  private sessionExpiryMs: number;
  private recordingsDir: string;
  private videosDir: string;
  private uploadsDir: string;
  private reportsDir: string;

  constructor(sessionExpiryMs: number = 30 * 60 * 1000) { // Default: 30 minutes
    this.sessions = new Map();
    this.sessionExpiryMs = sessionExpiryMs;
    
    // Initialize directory paths
    this.recordingsDir = path.join(__dirname, '../../recordings');
    this.videosDir = path.join(__dirname, '../../videos');
    this.uploadsDir = path.join(__dirname, '../../uploads');
    this.reportsDir = path.join(__dirname, '../../reports');
    
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
        secureVerified: false,
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
    // Note: locationVerified is NOT set here - it will be set by the location comparison endpoint
    // based on whether the user's location matches the document address
    
    if (session.status === 'consent_given' || session.status === 'initiated') {
      session.status = 'location_captured';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Location updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update location verification result
   */
  updateLocationVerified(
    sessionId: string,
    verified: boolean
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.verificationResults.locationVerified = verified;
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Location verified updated for session ${sessionId}: ${verified}`);
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
   * Update secure verification data (combined face + liveness + consistency)
   */
  updateSecureVerification(
    sessionId: string,
    secureVerification: SecureVerificationData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.secureVerification = secureVerification;
    
    if (secureVerification.overallResult) {
      session.verificationResults.secureVerified = true;
      session.status = 'secure_verified';
    } else {
      session.status = 'secure_verification_pending';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Secure verification updated for session: ${sessionId}`);
    return true;
  }

  /**
   * Update form data
   */
  updateForm(
    sessionId: string,
    form: FormData
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.form = form;
    session.verificationResults.formVerified = form.passed;
    
    if (form.passed) {
      session.status = 'form_completed';
    }
    
    session.updatedAt = new Date();
    
    console.log(`[KYCSessionManager] Form updated for session: ${sessionId}`);
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
      secureVerification: boolean;
      form: boolean;
    };
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return {
        success: false,
        message: 'Session not found',
        verificationResults: {
          documentVerified: false,
          secureVerified: false,
          locationVerified: false,
          overallVerified: false,
        },
        requiredSteps: {
          locationCapture: true,
          documentOCR: true,
          secureVerification: true,
          form: false,
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
      secureVerification: workflowSteps?.secureVerification ?? true,
      form: workflowSteps?.form ?? false,
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
    
    // Secure verification check (combined face + liveness) - only if required
    if (requiredSteps.secureVerification) {
      totalChecks++;
      if (results.secureVerified) {
        score++;
      } else {
        allRequiredVerified = false;
      }
    }
    
    // Form check - only if required
    if (requiredSteps.form) {
      totalChecks++;
      if (results.formVerified) {
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
    // Clean up associated files before deleting session
    this.cleanupSessionFiles(sessionId);
    
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`[KYCSessionManager] Session deleted: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Clean up all files associated with a session
   * Removes recordings, merged videos, documents, and reports/formdata
   */
  private cleanupSessionFiles(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    let filesDeleted = 0;

    try {
      // 1. Delete recordings directory (chunks, metadata, events, decisions)
      const recordingsSessionDir = path.join(this.recordingsDir, sessionId);
      if (fs.existsSync(recordingsSessionDir)) {
        fs.rmSync(recordingsSessionDir, { recursive: true, force: true });
        console.log(`[KYCSessionManager] Deleted recordings directory: ${recordingsSessionDir}`);
        filesDeleted++;
      }

      // 2. Delete merged video file
      const mergedVideoPath = path.join(this.videosDir, `${sessionId}.mp4`);
      if (fs.existsSync(mergedVideoPath)) {
        fs.unlinkSync(mergedVideoPath);
        console.log(`[KYCSessionManager] Deleted merged video: ${mergedVideoPath}`);
        filesDeleted++;
      }

      // 3. Delete documents from uploads directory
      // Files are named: {documentId}-front.jpg, {documentId}-back.jpg, {documentId}-face.jpg, 
      // {documentId}-photo.jpg, {documentId}-ocr-results.json, or just {documentId}.{ext}
      if (session?.document?.documentId && fs.existsSync(this.uploadsDir)) {
        const documentId = session.document.documentId;
        const files = fs.readdirSync(this.uploadsDir);
        
        for (const file of files) {
          // Match files that start with documentId (with optional suffix like -front, -back, etc.)
          if (file.startsWith(documentId)) {
            const filePath = path.join(this.uploadsDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`[KYCSessionManager] Deleted document file: ${filePath}`);
              filesDeleted++;
            } catch (error) {
              console.error(`[KYCSessionManager] Failed to delete document file ${filePath}:`, error);
            }
          }
        }
      }

      // 4. Delete reports and formdata files
      // Reports: kyc_report_{sessionId}_{timestamp}.txt (or .pdf)
      // Formdata: formdata_{sessionId}.json
      if (fs.existsSync(this.reportsDir)) {
        const files = fs.readdirSync(this.reportsDir);
        
        for (const file of files) {
          // Match report files (kyc_report_{sessionId}_*.txt or .pdf)
          // Match formdata files (formdata_{sessionId}.json)
          if (file.includes(sessionId)) {
            const filePath = path.join(this.reportsDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`[KYCSessionManager] Deleted report/formdata file: ${filePath}`);
              filesDeleted++;
            } catch (error) {
              console.error(`[KYCSessionManager] Failed to delete report file ${filePath}:`, error);
            }
          }
        }
      }

      if (filesDeleted > 0) {
        console.log(`[KYCSessionManager] Cleaned up ${filesDeleted} file(s) for session ${sessionId}`);
      }
    } catch (error) {
      console.error(`[KYCSessionManager] Error cleaning up files for session ${sessionId}:`, error);
    }
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
        // Clean up files before deleting session from memory
        this.cleanupSessionFiles(sessionId);
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
      const { imageBuffer, ocrResults, ...docWithoutBuffers } = document;
      
      // Create lean OCR results (without raw response)
      let leanOcrResults: LeanOCRResults | undefined;
      if (ocrResults) {
        const { rawResponse, ...ocrWithoutRaw } = ocrResults;
        leanOcrResults = ocrWithoutRaw;
      }
      
      leanDocument = {
        ...docWithoutBuffers,
        ocrResults: leanOcrResults,
        hasImageBuffer: !!imageBuffer,
      };
    }
    
    // Secure verification data is already lean (no binary data)
    
    return {
      ...sessionWithoutDoc,
      document: leanDocument,
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
  ocrResultsUrl?: string;
  ocrResults?: LeanOCRResults;
  hasImageBuffer?: boolean;
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
  };
  confidence: number;
  processedAt: Date;
}

// Export singleton instance for use across modules
export const sessionManager = new KYCSessionManager();
export default sessionManager;

