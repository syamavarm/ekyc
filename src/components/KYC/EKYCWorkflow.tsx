/**
 * Complete eKYC Workflow Component
 * Orchestrates the entire KYC verification process
 */

import React, { useState, useRef, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';
import ConsentScreen from './ConsentScreen';
import LocationCapture from './LocationCapture';
import DocumentVerification from './DocumentVerification';
import FaceVerification from './FaceVerification';
import QuestionnaireScreen from './QuestionnaireScreen';
import CompletionScreen from './CompletionScreen';
import { initializeAudio, playVoice, isAudioReady } from '../../services/audioService';
import sessionRecordingService, { SessionRecordingService } from '../../services/sessionRecordingService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';
import './EKYCWorkflow.css';

export type WorkflowStep =
  | 'consent'
  | 'location'
  | 'video_call'
  | 'document'
  | 'face'
  | 'questionnaire'
  | 'completion';

interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  secureVerification: boolean;
  questionnaire: boolean;
  locationRadiusKm?: number;
  enableSessionRecording?: boolean;
}

interface EKYCWorkflowProps {
  sessionId: string;
  userId: string;
  email?: string;
  mobileNumber?: string;
  onComplete?: (sessionId: string) => void;
  onCancel?: () => void;
  workflowConfigId?: string;
  workflowSteps?: WorkflowSteps;
  questionnaireFormId?: string;
}

/**
 * Essential OCR data stored in frontend state.
 * Full OCR data is stored in the backend against sessionId.
 * Frontend only stores what's needed for subsequent workflow steps.
 */
interface EssentialOCRData {
  address?: string;        // Needed for location comparison
  fullName?: string;       // Display purposes
  dateOfBirth?: string;    // Display purposes
  documentNumber?: string; // Display purposes
}

interface WorkflowState {
  sessionId: string;
  currentStep: WorkflowStep;
  completedSteps: WorkflowStep[];
  documentId?: string;
  /**
   * Only essential OCR fields are stored here.
   * Full OCR data (including raw response, confidence scores, etc.)
   * is stored in the backend against the sessionId.
   */
  essentialOcrData?: EssentialOCRData;
  error?: string;
}

const EKYCWorkflow: React.FC<EKYCWorkflowProps> = ({
  sessionId: initialSessionId,
  userId,
  email,
  mobileNumber,
  onComplete,
  onCancel,
  workflowConfigId,
  workflowSteps,
  questionnaireFormId,
}) => {
  const [state, setState] = useState<WorkflowState>({
    sessionId: initialSessionId,
    currentStep: 'consent',
    completedSteps: [],
  });
  const [loading, setLoading] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Audio state for camera setup step
  const [cameraAudioPlayed, setCameraAudioPlayed] = useState(false);
  const [cameraAudioPlaying, setCameraAudioPlaying] = useState(false);
  
  // Session recording state - enabled by default for video-KYC, configurable via workflowSteps
  const [isRecordingEnabled] = useState(workflowSteps?.enableSessionRecording !== false); // Default true
  const [isRecordingActive, setIsRecordingActive] = useState(false);

  // Calculate enabled steps based on workflow configuration
  // Location capture now comes AFTER document verification to enable address comparison
  const getEnabledSteps = (): WorkflowStep[] => {
    const steps: WorkflowStep[] = ['consent']; // Consent is always required
    
    if (!workflowSteps) {
      // If no workflow config, return all steps (default flow)
      return ['consent', 'video_call', 'document', 'location', 'face', 'questionnaire', 'completion'];
    }
    
    // Secure verification requires document (for face matching)
    const canDoSecureVerification = workflowSteps.secureVerification && workflowSteps.documentOCR;
    
    // Add video_call if document or secure verification is enabled
    const needsCamera = workflowSteps.documentOCR || canDoSecureVerification;
    if (needsCamera) {
      steps.push('video_call');
    }
    
    // Add document if enabled (before location)
    if (workflowSteps.documentOCR) {
      steps.push('document');
    }
    
    // Add location AFTER document if enabled
    if (workflowSteps.locationCapture) {
      steps.push('location');
    }
    
    // Add secure verification step (combined face + liveness)
    if (canDoSecureVerification) {
      steps.push('face');
    }
    
    // Add questionnaire if enabled
    if (workflowSteps.questionnaire) {
      steps.push('questionnaire');
    }
    
    // Completion is always the final step
    steps.push('completion');
    
    console.log('[EKYCWorkflow] Enabled steps:', steps, 'Config:', workflowSteps);
    
    return steps;
  };

  const enabledSteps = getEnabledSteps();

  // Initialize UI event logger when session ID is available
  // The logger persists for the entire session - we don't stop it on component remount
  useEffect(() => {
    // Only initialize if not already initialized for this session
    const currentLoggerSession = uiEventLoggerService.getCurrentSessionId();
    
    if (isRecordingEnabled && initialSessionId) {
      if (currentLoggerSession !== initialSessionId) {
        // Different session or not initialized - initialize now
        console.log('[EKYCWorkflow] Initializing UI event logger for session:', initialSessionId);
        uiEventLoggerService.initialize(initialSessionId);
        uiEventLoggerService.logSessionStarted({
          userId,
          workflowConfigId,
          steps: workflowSteps,
        });
        // Log the initial step
        uiEventLoggerService.logStepStarted('consent');
      } else {
        console.log('[EKYCWorkflow] UI event logger already initialized for session:', initialSessionId);
      }
    }
    
    // Don't stop the logger on cleanup - it should persist for the session
    // The logger will flush on page unload via beforeunload handler
  }, [initialSessionId, isRecordingEnabled, userId, workflowConfigId, workflowSteps]);

  // Cleanup video stream and recording on unmount
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      // Stop recording if active
      if (sessionRecordingService.getIsRecording()) {
        sessionRecordingService.stopRecording();
      }
    };
  }, [localStream]);

  // Handle video stream assignment (like original VideoCall component)
  useEffect(() => {
    const videoElement = videoRef.current;
    
    if (videoElement && localStream) {
      console.log('Assigning stream to video element');
      videoElement.srcObject = localStream;
    }
    
    return () => {
      if (videoElement) {
        videoElement.srcObject = null;
      }
    };
  }, [localStream]);

  // Play audio instructions when camera becomes active on video_call step
  useEffect(() => {
    const playCameraSetupAudio = async () => {
      if (state.currentStep === 'video_call' && localStream && !cameraAudioPlayed && !cameraAudioPlaying) {
        setCameraAudioPlaying(true);
        
        // Initialize audio (user already interacted by giving consent)
        await initializeAudio();
        
        // Play the instruction message
        const message = "We are starting the identity verification process. " +
          "Please ensure you can see yourself clearly in the live view and your face is well lit.";
        
        if (isAudioReady()) {
          await playVoice(message, true);
        } else {
          // If audio not available, just wait a moment for user to read
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        setCameraAudioPlaying(false);
        setCameraAudioPlayed(true);
      }
    };
    
    playCameraSetupAudio();
  }, [state.currentStep, localStream, cameraAudioPlayed, cameraAudioPlaying]);

  // Reset camera audio state when moving away from video_call step
  useEffect(() => {
    if (state.currentStep !== 'video_call') {
      setCameraAudioPlayed(false);
      setCameraAudioPlaying(false);
    }
  }, [state.currentStep]);

  // Stop recording when reaching completion step
  useEffect(() => {
    const stopRecordingOnCompletion = async () => {
      if (state.currentStep === 'completion' && isRecordingActive) {
        try {
          await sessionRecordingService.stopRecording();
          setIsRecordingActive(false);
          console.log('[EKYCWorkflow] Session recording stopped on completion');
        } catch (err) {
          console.warn('[EKYCWorkflow] Error stopping recording on completion:', err);
        }
      }
    };
    
    stopRecordingOnCompletion();
  }, [state.currentStep, isRecordingActive]);

  const getNextStep = (currentStep: WorkflowStep): WorkflowStep => {
    // Use the enabled steps list to determine the next step
    const currentIndex = enabledSteps.indexOf(currentStep);
    const nextStep = enabledSteps[currentIndex + 1] || 'completion';
    
    console.log(`[EKYCWorkflow] getNextStep: ${currentStep} -> ${nextStep} (index ${currentIndex} -> ${currentIndex + 1})`);
    console.log('[EKYCWorkflow] Enabled steps:', enabledSteps);
    
    return nextStep;
  };

  const moveToNextStep = (nextStep: WorkflowStep) => {
    // Log step completion and transition
    uiEventLoggerService.logStepCompleted(state.currentStep);
    uiEventLoggerService.logStepStarted(nextStep);
    
    // Check if any upcoming step (including this one) needs the camera
    const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face'];
    const currentIndex = enabledSteps.indexOf(nextStep);
    const remainingSteps = enabledSteps.slice(currentIndex);
    const anyCameraStepRemaining = remainingSteps.some(step => stepsNeedingCamera.includes(step));
    
    // Only stop camera if no remaining steps need it (e.g., moving to completion/questionnaire after face)
    if (!anyCameraStepRemaining && localStream) {
      console.log(`[EKYCWorkflow] Stopping camera - no remaining steps need it`);
      stopVideoStream();
    }
    
    setState(prev => ({
      ...prev,
      currentStep: nextStep,
      completedSteps: [...prev.completedSteps, prev.currentStep],
      error: undefined,
    }));
  };

  const handleConsentSubmit = async (consent: any) => {
    try {
      setLoading(true);
      await kycApiService.submitConsent(state.sessionId, consent);
      
      // Log consent given event
      uiEventLoggerService.logConsentGiven(consent);
      
      const nextStep = getNextStep('consent');
      moveToNextStep(nextStep);
      // Start video stream if moving to a camera-dependent step
      const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face'];
      if (stepsNeedingCamera.includes(nextStep) && !localStream) {
        console.log(`[EKYCWorkflow] Starting camera for ${nextStep} step`);
        setTimeout(() => startVideoStream(), 100);
      }
    } catch (error) {
      console.error('Consent submission failed:', error);
      uiEventLoggerService.logError('consent_failed', 'Failed to submit consent');
      setState(prev => ({
        ...prev,
        error: 'Failed to submit consent. Please try again.',
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleLocationCaptured = async (location: any) => {
    try {
      setLoading(true);
      await kycApiService.submitLocation(state.sessionId, location);
      const nextStep = getNextStep('location');
      moveToNextStep(nextStep);
      // Restart video stream if moving to a camera-dependent step and stream is not active
      const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face'];
      if (stepsNeedingCamera.includes(nextStep) && !localStream) {
        console.log(`[EKYCWorkflow] Restarting camera for ${nextStep} step`);
        setTimeout(() => startVideoStream(), 100);
      }
    } catch (error) {
      console.error('Location submission failed:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to submit location. Please try again.',
      }));
    } finally {
      setLoading(false);
    }
  };

  const startVideoStream = async () => {
    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false,
      });
      
      console.log('Camera access granted, stream active:', stream.active);
      console.log('Video tracks:', stream.getVideoTracks().length);
      
      setLocalStream(stream); // This triggers the useEffect to assign to video element
      
      // Log camera started event
      uiEventLoggerService.logEvent('camera_started');
      
      // Start session recording if enabled and not already recording
      if (isRecordingEnabled && !isRecordingActive && SessionRecordingService.isSupported()) {
        try {
          const started = await sessionRecordingService.startRecording(state.sessionId, stream);
          if (started) {
            setIsRecordingActive(true);
            console.log('[EKYCWorkflow] Session recording started');
          }
        } catch (recError) {
          console.warn('[EKYCWorkflow] Could not start session recording:', recError);
        }
      }
      
    } catch (error: any) {
      console.error('Failed to start video stream:', error);
      uiEventLoggerService.logError('camera_failed', error.message);
      setState(prev => ({
        ...prev,
        error: `Failed to access camera: ${error.message}`,
      }));
    }
  };

  const stopVideoStream = async () => {
    if (localStream) {
      console.log('Stopping camera stream...');
      localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`Stopped track: ${track.kind}`);
      });
      setLocalStream(null);
      
      // Also clear the video element
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      // Log camera stopped event
      uiEventLoggerService.logEvent('camera_stopped');
      
      // Stop session recording if active
      if (isRecordingActive) {
        try {
          await sessionRecordingService.stopRecording();
          setIsRecordingActive(false);
          console.log('[EKYCWorkflow] Session recording stopped');
        } catch (recError) {
          console.warn('[EKYCWorkflow] Error stopping recording:', recError);
        }
      }
    }
  };

  const handleVideoCallReady = () => {
    // User is ready to proceed - move to next step based on workflow
    const nextStep = getNextStep('video_call');
    moveToNextStep(nextStep);
  };

  const handleDocumentVerified = async (documentId: string, ocrData: any) => {
    // Log document verification event
    uiEventLoggerService.logEvent('document_captured', {
      documentType: ocrData?.documentType,
      hasOcrData: !!ocrData?.extractedData,
    });
    
    // Extract only essential OCR data needed for subsequent steps.
    // Full OCR data remains stored in the backend against the sessionId.
    const essentialOcrData: EssentialOCRData = {
      address: ocrData?.extractedData?.address,
      fullName: ocrData?.extractedData?.fullName,
      dateOfBirth: ocrData?.extractedData?.dateOfBirth,
      documentNumber: ocrData?.extractedData?.documentNumber,
    };
    
    setState(prev => ({
      ...prev,
      documentId,
      essentialOcrData,
    }));
    const nextStep = getNextStep('document');
    moveToNextStep(nextStep);
  };

  const handleSecureVerified = () => {
    // Secure verification passed (face match + liveness + consistency)
    console.log('[EKYCWorkflow] Secure verification passed');
  };

  const handleSecureVerificationComplete = () => {
    // Secure verification step is complete
    const nextStep = getNextStep('face');
    console.log('[EKYCWorkflow] Secure verification complete, moving to:', nextStep);
    moveToNextStep(nextStep);
  };

  const handleQuestionnaireCompleted = () => {
    uiEventLoggerService.logEvent('questionnaire_completed');
    moveToNextStep('completion');
  };

  const handleSkipQuestionnaire = () => {
    uiEventLoggerService.logEvent('questionnaire_completed', { skipped: true });
    moveToNextStep('completion');
  };

  const renderCurrentStep = () => {
    switch (state.currentStep) {
      case 'consent':
        return (
          <ConsentScreen
            onSubmit={handleConsentSubmit}
            onCancel={onCancel}
            loading={loading}
          />
        );

      case 'location':
        return (
          <LocationCapture
            sessionId={state.sessionId}
            onLocationCaptured={handleLocationCaptured}
            loading={loading}
            documentAddress={state.essentialOcrData?.address}
            locationRadiusKm={workflowSteps?.locationRadiusKm}
            videoStream={localStream}
          />
        );

      case 'video_call':
        // Determine the next step to show correct button text
        const nextStepAfterVideo = getNextStep('video_call');
        
        // Determine accurate button label based on what's actually enabled
        const getVideoCallButtonLabel = (): string => {
          if (nextStepAfterVideo === 'document') {
            return 'Start Document Verification';
          }
          if (nextStepAfterVideo === 'face') {
            return 'Start Face & Liveness Check';
          }
          if (nextStepAfterVideo === 'questionnaire') {
            return 'Start Questionnaire';
          }
          return 'Continue';
        };
        
        const nextStepLabel = getVideoCallButtonLabel();
        
        return (
          <div className="video-call-step">
            <h2>📹 Camera Setup</h2>
            <p>Your camera is active. Please ensure you can see yourself clearly and your face is well-lit.</p>
            {!localStream && (
              <div className="status-message">
                <div className="spinner"></div>
                <p>Starting camera...</p>
              </div>
            )}
            {localStream && (
              <div className="video-container">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="video-preview"
                />
              </div>
            )}
            <div className="video-actions">
              {!localStream && (
                <button
                  className="btn-secondary"
                  onClick={startVideoStream}
                >
                  Retry Camera
                </button>
              )}
              <button
                className="btn-primary"
                onClick={handleVideoCallReady}
                disabled={loading || !localStream || cameraAudioPlaying || !cameraAudioPlayed}
              >
                {!localStream 
                  ? 'Waiting for camera...' 
                  : cameraAudioPlaying 
                    ? 'Please wait...' 
                    : nextStepLabel}
              </button>
            </div>
          </div>
        );

      case 'document':
        return (
          <DocumentVerification
            sessionId={state.sessionId}
            videoStream={localStream}
            onDocumentVerified={handleDocumentVerified}
            loading={loading}
          />
        );

      case 'face':
        // Secure verification requires a document ID
        if (!state.documentId) {
          console.error('[EKYCWorkflow] Secure verification requires document - skipping');
          handleSecureVerificationComplete();
          return null;
        }
        
        return (
          <FaceVerification
            sessionId={state.sessionId}
            documentId={state.documentId}
            videoStream={localStream}
            onVerified={handleSecureVerified}
            onComplete={handleSecureVerificationComplete}
            loading={loading}
          />
        );

      case 'questionnaire':
        return (
          <QuestionnaireScreen
            sessionId={state.sessionId}
            ocrData={state.essentialOcrData}
            onCompleted={handleQuestionnaireCompleted}
            onSkip={handleSkipQuestionnaire}
            loading={loading}
            questionSet={questionnaireFormId || 'basic'}
          />
        );

      case 'completion':
        return (
          <CompletionScreen
            sessionId={state.sessionId}
          />
        );

      default:
        return null;
    }
  };

  // Step label formatting for better display
  const getStepLabel = (step: WorkflowStep): string => {
    const labels: Record<WorkflowStep, string> = {
      'consent': 'Consent',
      'location': 'Location',
      'video_call': 'Camera',
      'document': 'Document',
      'face': 'Face & Liveness',
      'questionnaire': 'Questions',
      'completion': 'Complete',
    };
    return labels[step] || step.replace('_', ' ');
  };

  return (
    <div className="ekyc-workflow">
      <div className="workflow-header">
        <h1>eKYC Verification</h1>
        {isRecordingActive && (
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            <span className="recording-text">Recording</span>
          </div>
        )}
        <div className="progress-indicator">
          <div className="progress-steps">
            {enabledSteps.map((step, index) => (
              <div
                key={step}
                className={`progress-step ${
                  state.completedSteps.includes(step as WorkflowStep)
                    ? 'completed'
                    : state.currentStep === step
                    ? 'active'
                    : ''
                }`}
              >
                <div className="step-number">{index + 1}</div>
                <div className="step-label">{getStepLabel(step)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="workflow-content">
        {state.error && (
          <div className="error-banner">
            <span className="error-icon">⚠️</span>
            {state.error}
          </div>
        )}
        {renderCurrentStep()}
      </div>
    </div>
  );
};

export default EKYCWorkflow;

