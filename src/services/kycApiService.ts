/**
 * KYC API Service
 * Handles all API calls to the backend KYC system
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

export interface StartKYCResponse {
  sessionId: string;
  status: string;
  message: string;
}

export interface ConsentData {
  videoRecording: boolean;
  locationTracking: boolean;
  documentUse: boolean;
}

export interface LocationData {
  gps?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  ip?: {
    address: string;
  };
  // Location comparison with document address
  addressComparison?: {
    documentAddress?: string;
    distanceKm?: number;
    allowedRadiusKm?: number;
    withinRadius?: boolean;
    userCountry?: string;
    documentCountry?: string;
    sameCountry?: boolean;
    verificationType?: 'radius' | 'country';
    verified?: boolean;
    message?: string;
  };
}

export interface DocumentUploadResponse {
  success: boolean;
  documentId: string;
  imageUrl: string;
  message: string;
}

export interface OCRResponse {
  success: boolean;
  ocrResults: {
    documentType: string;
    extractedData: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      dateOfBirth?: string;
      documentNumber?: string;
      expiryDate?: string;
      nationality?: string;
      gender?: string;
      address?: string;
    };
    confidence: number;
  };
  isValid: boolean;
  validationErrors?: string[];
  message: string;
}

/**
 * Secure Verification response (combined face + liveness + consistency)
 * This atomic operation prevents spoofing by verifying face consistency
 */
export interface SecureVerificationResponse {
  success: boolean;
  faceMatch: {
    isMatch: boolean;
    matchScore: number;
    confidence: number;
  };
  liveness: {
    overallResult: boolean;
    checks: Array<{
      type: string;
      result: boolean;
      confidence: number;
    }>;
    confidenceScore: number;
  };
  faceConsistency: {
    isConsistent: boolean;
    consistencyScore: number;
    message: string;
  };
  overallResult: boolean;
  message: string;
}

export interface FormField {
  id: string;
  field: string;
  type: 'text' | 'numeric' | 'date' | 'multiple_choice' | 'yes_no';
  options?: string[];
  category: string;
}

export interface FormResponse {
  success: boolean;
  form: {
    fields: Array<{
      field: string;
      userAnswer: string;
      isCorrect: boolean;
    }>;
    score: number;
    passed: boolean;
  };
  message: string;
}

// Legacy alias
export type Question = FormField;
export type QuestionnaireResponse = FormResponse;

export interface RequiredSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  secureVerification: boolean;
  form: boolean;
}

export interface CompleteKYCResponse {
  success: boolean;
  sessionId: string;
  status: string;
  verificationResults: {
    documentVerified: boolean;
    secureVerified: boolean;
    locationVerified: boolean;
    formVerified?: boolean;
    overallVerified: boolean;
  };
  requiredSteps: RequiredSteps;
  message: string;
}

export interface SessionSummary {
  sessionId: string;
  userId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  duration?: number;
  consent: ConsentData;
  location?: LocationData;
  document?: any;
  secureVerification?: any;
  form?: any;
  verificationResults: any;
  overallScore?: number;
}

class KYCApiService {
  /**
   * Start a new KYC session
   */
  async startSession(userId: string, email?: string, mobileNumber?: string, workflowConfigId?: string): Promise<StartKYCResponse> {
    const response = await fetch(`${API_BASE_URL}/kyc/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, email, mobileNumber, workflowConfigId }),
    });

    if (!response.ok) {
      throw new Error('Failed to start KYC session');
    }

    return response.json();
  }

  /**
   * Submit user consent
   */
  async submitConsent(sessionId: string, consent: ConsentData): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/kyc/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, consent }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit consent');
    }

    return response.json();
  }

  /**
   * Submit location data
   */
  async submitLocation(sessionId: string, location: LocationData): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/kyc/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, ...location }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit location');
    }

    return response.json();
  }

  /**
   * Upload document
   */
  async uploadDocument(
    sessionId: string,
    documentType: string,
    file: File
  ): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('documentType', documentType);
    formData.append('document', file);

    const response = await fetch(`${API_BASE_URL}/kyc/document/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload document');
    }

    return response.json();
  }

  /**
   * Upload both front and back sides of document
   */
  async uploadDocumentBothSides(
    sessionId: string,
    documentType: string,
    frontFile: File,
    backFile: File
  ): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('documentType', documentType);
    formData.append('documentFront', frontFile);
    formData.append('documentBack', backFile);

    const response = await fetch(`${API_BASE_URL}/kyc/document/upload-both-sides`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload document');
    }

    return response.json();
  }

  /**
   * Run OCR on uploaded document
   */
  async runOCR(sessionId: string, documentId: string): Promise<OCRResponse> {
    const response = await fetch(`${API_BASE_URL}/kyc/document/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, documentId }),
    });

    if (!response.ok) {
      throw new Error('Failed to run OCR');
    }

    return response.json();
  }

  /**
   * Secure Verification (combined face + liveness + anti-spoofing)
   * 
   * This atomic operation:
   * 1. Matches face image against document photo
   * 2. Performs liveness check on captured frames
   * 3. Verifies face consistency between face capture and liveness frames
   * 
   * This prevents spoofing where user shows document during face capture
   * but uses actual face during liveness.
   */
  async runSecureVerification(
    sessionId: string,
    documentId: string,
    faceImage: Blob,
    livenessFrames: Blob[]
  ): Promise<SecureVerificationResponse> {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('documentId', documentId);
    formData.append('faceImage', faceImage, 'face.jpg');
    
    livenessFrames.forEach((frame, index) => {
      formData.append('frames', frame, `frame${index}.jpg`);
    });

    const response = await fetch(`${API_BASE_URL}/kyc/face-liveness`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to run secure verification');
    }

    return response.json();
  }

  /**
   * Get available field sets
   */
  async getFieldSets(): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/kyc/form/sets`);

    if (!response.ok) {
      throw new Error('Failed to get field sets');
    }

    const data = await response.json();
    return data.fieldSets;
  }

  /**
   * Get form fields for session
   */
  async getFormFields(
    sessionId: string,
    fieldSet: string = 'account_opening',
    includeOptional: boolean = false
  ): Promise<FormField[]> {
    const response = await fetch(
      `${API_BASE_URL}/kyc/form/fields?sessionId=${sessionId}&fieldSet=${fieldSet}&includeOptional=${includeOptional}`
    );

    if (!response.ok) {
      throw new Error('Failed to get form fields');
    }

    const data = await response.json();
    return data.fields;
  }

  /**
   * Submit form answers
   */
  async submitForm(
    sessionId: string,
    fieldSet: string,
    answers: Record<string, string>
  ): Promise<FormResponse> {
    const response = await fetch(`${API_BASE_URL}/kyc/form/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, fieldSet, answers }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit form');
    }

    return response.json();
  }

  /**
   * Update OTP voice verification result
   * Called after OTP verification attempt on frontend
   */
  async updateOTPVerification(
    sessionId: string,
    verified: boolean,
    attempts: number,
    escalated?: boolean,
    escalationReason?: string
  ): Promise<{
    success: boolean;
    overallResult: boolean;
    escalated: boolean;
    message: string;
  }> {
    const response = await fetch(`${API_BASE_URL}/kyc/otp-verification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        verified,
        attempts,
        escalated,
        escalationReason,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update OTP verification');
    }

    return response.json();
  }

  /**
   * Complete KYC session
   */
  async completeKYC(sessionId: string): Promise<CompleteKYCResponse> {
    const response = await fetch(`${API_BASE_URL}/kyc/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      throw new Error('Failed to complete KYC');
    }

    return response.json();
  }

  /**
   * Get session summary
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    const response = await fetch(`${API_BASE_URL}/kyc/session/${sessionId}/summary`);

    if (!response.ok) {
      throw new Error('Failed to get session summary');
    }

    return response.json();
  }

  /**
   * Download session report
   */
  downloadReport(sessionId: string, format: 'pdf' | 'txt' = 'pdf'): void {
    window.location.href = `${API_BASE_URL}/kyc/session/${sessionId}/summary?format=${format}`;
  }

  /**
   * Get user's geolocation
   */
  async getUserLocation(): Promise<LocationData> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            gps: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            },
          });
        },
        (error) => {
          console.error('Geolocation error:', error);
          // Fallback to IP-based location (backend will handle)
          resolve({});
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  }

  /**
   * Reverse geocode GPS coordinates to get readable location
   * Used to display user's current location during the session
   */
  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<{
    displayLocation: string;
    city?: string;
    state?: string;
    country?: string;
    countryCode?: string;
    formattedAddress?: string;
  } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/location/reverse-geocode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ latitude, longitude }),
      });

      if (!response.ok) {
        console.warn('Failed to reverse geocode location');
        return null;
      }

      const data = await response.json();
      return data.location;
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      return null;
    }
  }

  /**
   * Compare user's location with document address
   * If latitude/longitude provided, uses GPS coordinates
   * If not provided, backend uses IP-based location
   * If allowedRadiusKm is provided, uses radius-based comparison
   * If not provided, uses country-based comparison
   */
  async compareLocationWithAddress(
    sessionId: string,
    latitude: number | undefined,
    longitude: number | undefined,
    documentAddress: string,
    allowedRadiusKm?: number
  ): Promise<{
    documentAddress?: string;
    // Radius-based comparison
    distanceKm?: number;
    allowedRadiusKm?: number;
    withinRadius?: boolean;
    // Country-based comparison
    userCountry?: string;
    documentCountry?: string;
    sameCountry?: boolean;
    // Verification type and result
    verificationType?: 'radius' | 'country';
    verified?: boolean;
    message?: string;
    locationSource?: 'gps' | 'ip';
  }> {
    const response = await fetch(`${API_BASE_URL}/kyc/location/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        latitude,
        longitude,
        documentAddress,
        allowedRadiusKm,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to compare location with address');
    }

    const result = await response.json();
    
    // Handle both radius-based and country-based responses
    if (result.verificationType === 'country') {
      return {
        documentAddress: result.documentAddress,
        userCountry: result.userCountry,
        documentCountry: result.documentCountry,
        sameCountry: result.verified,
        verificationType: 'country',
        verified: result.verified,
        message: result.message,
        locationSource: result.locationSource,
      };
    }
    
    return {
      documentAddress: result.documentAddress,
      distanceKm: result.distanceKm,
      allowedRadiusKm: result.allowedRadiusKm,
      withinRadius: result.verified,
      verificationType: 'radius',
      verified: result.verified,
      message: result.message,
      locationSource: result.locationSource,
    };
  }
}

export const kycApiService = new KYCApiService();
export default kycApiService;

