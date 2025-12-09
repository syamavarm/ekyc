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
  faceMatch: boolean;
  livenessCheck: boolean;
  questionnaire: boolean;
  locationRadiusKm?: number;
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

  // Calculate enabled steps based on workflow configuration
  // Location capture now comes AFTER document verification to enable address comparison
  const getEnabledSteps = (): WorkflowStep[] => {
    const steps: WorkflowStep[] = ['consent']; // Consent is always required
    
    if (!workflowSteps) {
      // If no workflow config, return all steps (default flow)
      // Location now comes after document verification
      return ['consent', 'video_call', 'document', 'location', 'face', 'questionnaire', 'completion'];
    }
    
    // Determine if face step can actually do something useful:
    // - Face match requires document (documentOCR must be enabled)
    // - Liveness check doesn't require document
    const canDoFaceMatch = workflowSteps.faceMatch && workflowSteps.documentOCR;
    const canDoLiveness = workflowSteps.livenessCheck;
    const faceStepHasWork = canDoFaceMatch || canDoLiveness;
    
    // Add video_call if document or face step has work
    const needsCamera = workflowSteps.documentOCR || faceStepHasWork;
    if (needsCamera) {
      steps.push('video_call');
    }
    
    // Add document if enabled (before location now)
    if (workflowSteps.documentOCR) {
      steps.push('document');
    }
    
    // Add location AFTER document if enabled
    // This allows us to compare user's location with document address
    if (workflowSteps.locationCapture) {
      steps.push('location');
    }
    
    // Add face verification step only if it can do something useful
    // (either face match with document, or liveness check)
    if (faceStepHasWork) {
      steps.push('face');
    }
    
    // Add questionnaire if enabled
    if (workflowSteps.questionnaire) {
      steps.push('questionnaire');
    }
    
    // Completion is always the final step
    steps.push('completion');
    
    console.log('[EKYCWorkflow] Enabled steps:', steps, 'Config:', workflowSteps);
    console.log('[EKYCWorkflow] Face step analysis - canDoFaceMatch:', canDoFaceMatch, 'canDoLiveness:', canDoLiveness);
    
    return steps;
  };

  const enabledSteps = getEnabledSteps();

  // Cleanup video stream on unmount
  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
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

  const getNextStep = (currentStep: WorkflowStep): WorkflowStep => {
    // Use the enabled steps list to determine the next step
    const currentIndex = enabledSteps.indexOf(currentStep);
    const nextStep = enabledSteps[currentIndex + 1] || 'completion';
    
    console.log(`[EKYCWorkflow] getNextStep: ${currentStep} -> ${nextStep} (index ${currentIndex} -> ${currentIndex + 1})`);
    console.log('[EKYCWorkflow] Enabled steps:', enabledSteps);
    
    return nextStep;
  };

  const moveToNextStep = (nextStep: WorkflowStep) => {
    // Stop camera when moving to steps that don't need it
    const stepsNeedingCamera: WorkflowStep[] = ['video_call', 'document', 'face'];
    if (!stepsNeedingCamera.includes(nextStep) && localStream) {
      console.log(`[EKYCWorkflow] Stopping camera - moving to ${nextStep} which doesn't need it`);
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
      const nextStep = getNextStep('consent');
      moveToNextStep(nextStep);
      // Start video stream if moving to video_call step (when location is skipped)
      if (nextStep === 'video_call') {
        setTimeout(() => startVideoStream(), 100);
      }
    } catch (error) {
      console.error('Consent submission failed:', error);
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
      // Start video stream if moving to video_call step
      if (nextStep === 'video_call') {
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
      
    } catch (error: any) {
      console.error('Failed to start video stream:', error);
      setState(prev => ({
        ...prev,
        error: `Failed to access camera: ${error.message}`,
      }));
    }
  };

  const stopVideoStream = () => {
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
    }
  };

  const handleVideoCallReady = () => {
    // User is ready to proceed - move to next step based on workflow
    const nextStep = getNextStep('video_call');
    moveToNextStep(nextStep);
  };

  const handleDocumentVerified = async (documentId: string, ocrData: any) => {
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

  const handleFaceVerified = () => {
    // Face verified, but liveness check still needs to be done in same component
    console.log('Face verified, waiting for liveness check...');
  };

  const handleLivenessVerified = () => {
    // Liveness check passed (callback for logging/tracking)
    console.log('[EKYCWorkflow] Liveness check verified');
  };

  const handleFaceStepComplete = () => {
    // Face verification step is complete (face match and/or liveness based on config)
    const nextStep = getNextStep('face');
    console.log('[EKYCWorkflow] Face step complete, moving to:', nextStep);
    moveToNextStep(nextStep);
  };

  const handleQuestionnaireCompleted = () => {
    moveToNextStep('completion');
  };

  const handleSkipQuestionnaire = () => {
    moveToNextStep('completion');
  };

  const handleWorkflowComplete = async () => {
    try {
      setLoading(true);
      // Call complete API one more time to ensure status is finalized
      await kycApiService.completeKYC(state.sessionId);
      // Always call onComplete - user should be able to finish regardless of KYC result
      if (onComplete) {
        onComplete(state.sessionId);
      }
    } catch (error) {
      console.error('Failed to complete KYC:', error);
      // Even if the API call fails, allow user to finish the workflow
      if (onComplete) {
        onComplete(state.sessionId);
      }
    } finally {
      setLoading(false);
    }
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
          />
        );

      case 'video_call':
        // Determine the next step to show correct button text
        const nextStepAfterVideo = getNextStep('video_call');
        
        // Determine accurate button label based on what's actually enabled AND possible
        const getVideoCallButtonLabel = (): string => {
          if (nextStepAfterVideo === 'document') {
            return 'Start Document Verification';
          }
          if (nextStepAfterVideo === 'face') {
            // Check what's actually going to happen in the face step
            const configHasFaceMatch = !workflowSteps || workflowSteps.faceMatch;
            const hasLiveness = !workflowSteps || workflowSteps.livenessCheck;
            // Face match requires document step to be in the flow
            const documentInFlow = !workflowSteps || workflowSteps.documentOCR;
            const canDoFaceMatch = configHasFaceMatch && documentInFlow;
            
            if (!canDoFaceMatch && hasLiveness) {
              // Face match not possible (no document), only liveness
              return 'Start Liveness Check';
            }
            if (canDoFaceMatch && hasLiveness) {
              return 'Start Face & Liveness Check';
            }
            if (canDoFaceMatch) {
              return 'Start Face Verification';
            }
            // Fallback - shouldn't happen but handle gracefully
            return 'Continue';
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
                disabled={loading || !localStream}
              >
                {localStream ? nextStepLabel : 'Waiting for camera...'}
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
        // Face match can only be performed if:
        // 1. It's required by config (or no config = default all enabled)
        // 2. AND we actually have a document to compare against
        const configRequiresFaceMatch = !workflowSteps || workflowSteps.faceMatch;
        const canPerformFaceMatch = configRequiresFaceMatch && !!state.documentId;
        
        // Log if face match was requested but can't be done
        if (configRequiresFaceMatch && !state.documentId) {
          console.warn('[EKYCWorkflow] Face match enabled but no document available - will skip to liveness');
        }
        
        return (
          <FaceVerification
            sessionId={state.sessionId}
            documentId={state.documentId}
            videoStream={localStream}
            onFaceVerified={handleFaceVerified}
            onLivenessVerified={handleLivenessVerified}
            onComplete={handleFaceStepComplete}
            loading={loading}
            requireFaceMatch={canPerformFaceMatch}
            requireLivenessCheck={!workflowSteps || workflowSteps.livenessCheck}
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
            onComplete={handleWorkflowComplete}
            loading={loading}
          />
        );

      default:
        return null;
    }
  };

  // Step label formatting for better display - dynamic based on workflow config
  const getStepLabel = (step: WorkflowStep): string => {
    // Special handling for 'face' step - show accurate label based on what's enabled AND possible
    if (step === 'face') {
      const configHasFaceMatch = !workflowSteps || workflowSteps.faceMatch;
      const hasLiveness = !workflowSteps || workflowSteps.livenessCheck;
      // Face match can only happen if document is in the flow
      const documentInFlow = !workflowSteps || workflowSteps.documentOCR;
      const canDoFaceMatch = configHasFaceMatch && documentInFlow;
      
      if (canDoFaceMatch && hasLiveness) {
        return 'Face & Liveness';
      } else if (canDoFaceMatch) {
        return 'Face Verify';
      } else if (hasLiveness) {
        return 'Liveness';
      }
      return 'Verification';
    }
    
    const labels: Record<WorkflowStep, string> = {
      'consent': 'Consent',
      'location': 'Location',
      'video_call': 'Camera',
      'document': 'Document',
      'face': 'Face Verify', // fallback, handled above
      'questionnaire': 'Questions',
      'completion': 'Complete',
    };
    return labels[step] || step.replace('_', ' ');
  };

  return (
    <div className="ekyc-workflow">
      <div className="workflow-header">
        <h1>eKYC Verification</h1>
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

