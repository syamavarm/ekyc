/**
 * eKYC Types and Interfaces
 * Comprehensive type definitions for the eKYC workflow
 */

export interface KYCSession {
  sessionId: string;
  userId: string;
  mobileNumber?: string;
  email?: string;
  status: KYCStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  
  // Workflow configuration reference
  workflowConfigId?: string;
  workflowSteps?: WorkflowSteps;
  
  // Consent
  consent: ConsentData;
  
  // Location
  location?: LocationData;
  
  // Document verification
  document?: DocumentData;
  
  // Secure verification (combined face + liveness with anti-spoofing)
  // Stores detailed results for audit/reporting
  secureVerification?: SecureVerificationData;
  
  // Questionnaire (optional)
  questionnaire?: QuestionnaireData;
  
  // Video recording
  videoRecording?: VideoRecordingData;
  
  // Overall verification scores
  overallScore?: number;
  verificationResults: VerificationResults;
}

export type KYCStatus = 
  | 'initiated'
  | 'consent_pending'
  | 'consent_given'
  | 'location_captured'
  | 'document_uploaded'
  | 'document_verified'
  | 'secure_verification_pending'
  | 'secure_verified'
  | 'questionnaire_pending'
  | 'questionnaire_completed'
  | 'completed'
  | 'failed'
  | 'expired';

/**
 * Combined secure verification data (face match + liveness + consistency)
 * Stores all results from the unified verification step
 */
export interface SecureVerificationData {
  // Face match results
  faceMatch: {
    isMatch: boolean;
    matchScore: number;
    confidence: number;
    capturedImageUrl?: string;
    documentPhotoUrl?: string;
  };
  
  // Liveness check results
  liveness: {
    overallResult: boolean;
    checks: LivenessCheck[];
    confidenceScore: number;
  };
  
  // Face consistency check (anti-spoofing)
  faceConsistency: {
    isConsistent: boolean;
    consistencyScore: number;
    message: string;
  };
  
  // Overall result
  overallResult: boolean;
  verifiedAt: Date;
  errorMessage?: string;
}

export interface ConsentData {
  videoRecording: boolean;
  locationTracking: boolean;
  documentUse: boolean;
  timestamp: Date;
  ipAddress?: string;
}

export interface LocationData {
  gps?: {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: Date;
  };
  ip?: {
    address: string;
    country?: string;
    region?: string;
    city?: string;
    timestamp: Date;
  };
  capturedAt: Date;
  // Location comparison with document address
  addressComparison?: {
    documentAddress?: string;
    documentCoordinates?: {
      latitude: number;
      longitude: number;
    };
    // Radius-based comparison
    distanceKm?: number;
    allowedRadiusKm?: number;
    withinRadius?: boolean;
    // Country-based comparison (when radius not defined)
    userCountry?: string;
    documentCountry?: string;
    sameCountry?: boolean;
    // Type of verification
    verificationType?: 'radius' | 'country';
  };
}

export interface DocumentData {
  documentId: string;
  documentType: DocumentType;
  uploadedAt: Date;
  imageUrl: string;
  imageBuffer?: Buffer;
  
  // OCR Results
  ocrResults?: OCRResults;
  
  // Extracted photo from document (for face verification)
  extractedPhotoBuffer?: Buffer;
  extractedPhotoUrl?: string;
  ocrResultsUrl?: string;
  
  // Validation
  isValid: boolean;
  validationErrors?: string[];
  confidenceScore?: number;
}

export type DocumentType = 
  | 'passport'
  | 'drivers_license'
  | 'national_id'
  | 'voter_id'
  | 'other';

export interface OCRResults {
  documentType: DocumentType;
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
    [key: string]: any;
  };
  photoUrl?: string;
  photoBuffer?: Buffer;
  confidence: number;
  processedAt: Date;
  rawResponse?: unknown;
}

export interface FaceVerificationData {
  capturedImageUrl?: string;
  capturedImageBuffer?: Buffer;
  documentPhotoUrl?: string;
  matchScore: number;
  isMatch: boolean;
  threshold: number;
  confidence: number;
  verifiedAt: Date;
  errorMessage?: string;
  error?: string; // Error message if verification failed
  details?: {
    distance?: number; // Euclidean distance between face embeddings
    liveFaceDetectionScore?: number;
    documentFaceDetectionScore?: number;
    [key: string]: any;
  };
  // Flag for lean responses (indicates binary data exists on server)
  hasCapturedImage?: boolean;
}

export interface LivenessCheckData {
  checks: LivenessCheck[];
  overallResult: boolean;
  confidenceScore: number;
  completedAt: Date;
  videoFrames?: string[];
  // For lean responses (indicates frame data exists on server)
  frameCount?: number;
}

export interface LivenessCheck {
  type: LivenessCheckType;
  result: boolean;
  confidence: number;
  timestamp: Date;
  details?: string; // Additional details about the check result
}

export type LivenessCheckType = 
  | 'blink_detection'
  | 'head_turn_left'
  | 'head_turn_right'
  | 'smile_detection'
  | 'passive_liveness';

export interface QuestionnaireData {
  questions: QuestionAnswer[];
  score: number;
  passed: boolean;
  completedAt: Date;
}

export interface QuestionAnswer {
  question: string;
  expectedAnswer?: string;
  userAnswer: string;
  isCorrect: boolean;
  answeredAt: Date;
}

export interface VideoRecordingData {
  videoUrl?: string;
  duration: number;
  startTime: Date;
  endTime: Date;
  format: string;
}

export interface VerificationResults {
  documentVerified: boolean;
  /**
   * Secure verification result: face match + liveness + consistency all passed
   */
  secureVerified: boolean;
  locationVerified: boolean;
  questionnaireVerified?: boolean;
  overallVerified: boolean;
}

// API Request/Response Types

export interface StartKYCRequest {
  userId: string;
  mobileNumber?: string;
  email?: string;
}

export interface StartKYCResponse {
  sessionId: string;
  status: KYCStatus;
  message: string;
}

export interface SubmitLocationRequest {
  sessionId: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  ip?: {
    address: string;
    country?: string;
    region?: string;
    city?: string;
  };
}

export interface SubmitLocationResponse {
  success: boolean;
  message: string;
  location: LocationData;
}

export interface DocumentUploadRequest {
  sessionId: string;
  documentType: DocumentType;
}

export interface DocumentUploadResponse {
  success: boolean;
  documentId: string;
  imageUrl: string;
  message: string;
}

export interface DocumentOCRRequest {
  sessionId: string;
  documentId: string;
}

export interface DocumentOCRResponse {
  success: boolean;
  ocrResults: OCRResults;
  isValid: boolean;
  validationErrors?: string[];
  message: string;
}

export interface FaceVerificationRequest {
  sessionId: string;
  documentId: string;
}

export interface FaceVerificationResponse {
  success: boolean;
  matchScore: number;
  isMatch: boolean;
  confidence: number;
  message: string;
}

export interface LivenessCheckRequest {
  sessionId: string;
  checkType?: LivenessCheckType;
}

export interface LivenessCheckResponse {
  success: boolean;
  checks: LivenessCheck[];
  overallResult: boolean;
  confidenceScore: number;
  message: string;
}

/**
 * Combined Face + Liveness verification request
 * This atomic operation prevents spoofing by ensuring the same face
 * is used throughout face matching and liveness checks.
 */
export interface CombinedFaceLivenessRequest {
  sessionId: string;
  documentId: string;
}

/**
 * Combined Face + Liveness verification response
 * Includes face match, liveness checks, and face consistency verification
 */
export interface CombinedFaceLivenessResponse {
  success: boolean;
  
  // Face match result (face image vs document photo)
  faceMatch: {
    isMatch: boolean;
    matchScore: number;
    confidence: number;
  };
  
  // Liveness check result
  liveness: {
    overallResult: boolean;
    checks: LivenessCheck[];
    confidenceScore: number;
  };
  
  // Face consistency check (face image vs liveness frames)
  faceConsistency: {
    isConsistent: boolean;
    consistencyScore: number;
    message: string;
  };
  
  // Overall combined result
  overallResult: boolean;
  message: string;
}

export interface CompleteKYCRequest {
  sessionId: string;
}

export interface CompleteKYCResponse {
  success: boolean;
  sessionId: string;
  status: KYCStatus;
  verificationResults: VerificationResults;
  message: string;
}

export interface SessionSummaryResponse {
  sessionId: string;
  userId: string;
  status: KYCStatus;
  createdAt: Date;
  completedAt?: Date;
  duration?: number;
  consent: ConsentData;
  location?: LocationData;
  document?: DocumentData;
  secureVerification?: SecureVerificationData;
  questionnaire?: QuestionnaireData;
  verificationResults: VerificationResults;
  overallScore?: number;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  statusCode: number;
}

// Admin Workflow Configuration Types

export interface WorkflowConfiguration {
  configId: string;
  name: string;
  steps: WorkflowSteps;
  formId?: string;
  createdAt: Date;
  createdBy?: string;
  isActive: boolean;
}

export interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  /**
   * Secure Verification: Combined face matching + liveness check with anti-spoofing.
   * When enabled, performs:
   * 1. Face match against document photo
   * 2. Liveness check (blink, head turn, smile)
   * 3. Face consistency check between face capture and liveness frames
   * Requires documentOCR to be enabled.
   */
  secureVerification: boolean;
  questionnaire: boolean;
  // Location verification radius in kilometers (compare user's GPS with document address)
  locationRadiusKm?: number;
  // Extensible for future steps
  [key: string]: boolean | number | undefined;
}

export interface CreateWorkflowRequest {
  name: string;
  steps: WorkflowSteps;
  formId?: string;
  createdBy?: string;
}

export interface LocationVerificationResult {
  verified: boolean;
  userCoordinates?: {
    latitude: number;
    longitude: number;
  };
  documentCoordinates?: {
    latitude: number;
    longitude: number;
    geocodedAddress?: string;
  };
  // Radius-based verification
  distanceKm?: number;
  allowedRadiusKm?: number;
  // Country-based verification (when radius not defined)
  userCountry?: string;
  userCountryCode?: string;
  documentCountry?: string;
  documentCountryCode?: string;
  // Type of verification performed
  verificationType?: 'radius' | 'country';
  message: string;
}

export interface CreateWorkflowResponse {
  success: boolean;
  configId: string;
  linkUrl: string;
  message: string;
}

export interface GetWorkflowResponse {
  success: boolean;
  configuration: WorkflowConfiguration;
}

