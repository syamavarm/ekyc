export interface KYCFormData {
  fullName: string;
  email: string;
  phoneNumber: string;
  documentType: 'passport' | 'drivers_license' | 'national_id';
}

export interface VideoCallSession {
  sessionId: string;
  userId: string;
  agentId?: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sessionId: string;
  payload: any;
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
}

// Workflow configuration types for admin
export interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  secureVerification: boolean;
  questionnaire: boolean;
  locationRadiusKm?: number;
  enableSessionRecording?: boolean;
}

