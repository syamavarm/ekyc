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

export interface FaceVerificationResponse {
  success: boolean;
  matchScore: number;
  isMatch: boolean;
  confidence: number;
  message: string;
}

export interface LivenessCheckResponse {
  success: boolean;
  checks: Array<{
    type: string;
    result: boolean;
    confidence: number;
  }>;
  overallResult: boolean;
  confidenceScore: number;
  message: string;
}

export interface Question {
  id: string;
  question: string;
  type: 'text' | 'numeric' | 'date' | 'multiple_choice' | 'yes_no';
  options?: string[];
  category: string;
}

export interface QuestionnaireResponse {
  success: boolean;
  questionnaire: {
    questions: Array<{
      question: string;
      userAnswer: string;
      isCorrect: boolean;
    }>;
    score: number;
    passed: boolean;
  };
  message: string;
}

export interface RequiredSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  faceMatch: boolean;
  livenessCheck: boolean;
  questionnaire: boolean;
}

export interface CompleteKYCResponse {
  success: boolean;
  sessionId: string;
  status: string;
  verificationResults: {
    documentVerified: boolean;
    faceVerified: boolean;
    livenessVerified: boolean;
    locationVerified: boolean;
    questionnaireVerified?: boolean;
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
  faceVerification?: any;
  livenessCheck?: any;
  questionnaire?: any;
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
   * Verify face match
   */
  async verifyFace(
    sessionId: string,
    documentId: string,
    faceImage: Blob
  ): Promise<FaceVerificationResponse> {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    formData.append('documentId', documentId);
    formData.append('faceImage', faceImage, 'face.jpg');

    const response = await fetch(`${API_BASE_URL}/kyc/face/verify`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to verify face');
    }

    return response.json();
  }

  /**
   * Run liveness check
   */
  async runLivenessCheck(
    sessionId: string,
    frames: Blob[]
  ): Promise<LivenessCheckResponse> {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    
    frames.forEach((frame, index) => {
      formData.append('frames', frame, `frame${index}.jpg`);
    });

    const response = await fetch(`${API_BASE_URL}/kyc/liveness-check`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to run liveness check');
    }

    return response.json();
  }

  /**
   * Get available question sets
   */
  async getQuestionSets(): Promise<string[]> {
    const response = await fetch(`${API_BASE_URL}/kyc/questionnaire/sets`);

    if (!response.ok) {
      throw new Error('Failed to get question sets');
    }

    const data = await response.json();
    return data.questionSets;
  }

  /**
   * Get questions for session
   */
  async getQuestions(
    sessionId: string,
    questionSet: string = 'basic',
    includeOptional: boolean = false
  ): Promise<Question[]> {
    const response = await fetch(
      `${API_BASE_URL}/kyc/questionnaire/questions?sessionId=${sessionId}&questionSet=${questionSet}&includeOptional=${includeOptional}`
    );

    if (!response.ok) {
      throw new Error('Failed to get questions');
    }

    const data = await response.json();
    return data.questions;
  }

  /**
   * Submit questionnaire answers
   */
  async submitQuestionnaire(
    sessionId: string,
    questionSet: string,
    answers: Record<string, string>
  ): Promise<QuestionnaireResponse> {
    const response = await fetch(`${API_BASE_URL}/kyc/questionnaire/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, questionSet, answers }),
    });

    if (!response.ok) {
      throw new Error('Failed to submit questionnaire');
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
   * Capture video frame from video element
   */
  captureFrame(videoElement: HTMLVideoElement): Blob | null {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
    }) as any;
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
}

export const kycApiService = new KYCApiService();
export default kycApiService;

