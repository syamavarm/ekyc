/**
 * Complete eKYC Workflow Component
 * Orchestrates the entire KYC verification process
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import kycApiService from '../../services/kycApiService';
import ConsentScreen from './ConsentScreen';
import LocationCapture from './LocationCapture';
import DocumentVerification from './DocumentVerification';
import FaceVerification, { VisualFeedbackState } from './FaceVerification';
import FormScreen from './FormScreen';
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
  | 'form'
  | 'completion';

interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  secureVerification: boolean;
  form: boolean;
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
  formFieldSetId?: string;
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
  formFieldSetId,
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
  
  // Step instruction - displayed in overlay AND played as audio
  const [stepInstruction, setStepInstruction] = useState<string>('');

  // Network strength monitoring - only UI-relevant state
  const [networkInfo, setNetworkInfo] = useState({
    strength: 4,      // 0-4 bars
    isWifi: true,     // Show WiFi icon vs signal bars
    displayType: 'WiFi', // Label to show
  });
  
  // Visual feedback state for face verification (countdown, action cues)
  const [visualFeedback, setVisualFeedback] = useState<VisualFeedbackState>({
    mode: 'idle',
    countdownNumber: null,
  });
  
  // Callback for FaceVerification to update visual feedback state
  const handleVisualFeedbackChange = useCallback((newState: VisualFeedbackState) => {
    setVisualFeedback(newState);
  }, []);

  // Monitor network status
  useEffect(() => {
    const updateNetworkInfo = () => {
      const nav = navigator as any;
      const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
      
      if (connection) {
        const downlink = connection.downlink || 10;
        const rtt = connection.rtt || 50;
        const type = connection.type; // May be undefined on desktop
        
        // Calculate strength from speed
        let strength = 0;
        if (downlink >= 10) strength = 4;
        else if (downlink >= 5) strength = 3;
        else if (downlink >= 2) strength = 2;
        else if (downlink >= 0.5) strength = 1;
        
        // Detect connection type (WiFi vs cellular)
        let isWifi = false;
        let displayType = 'Slow';
        
        if (type === 'wifi') { isWifi = true; displayType = 'WiFi'; }
        else if (type === 'ethernet') { isWifi = true; displayType = 'Ethernet'; }
        else if (type === 'cellular') { isWifi = false; displayType = 'Cellular'; }
        else if (downlink >= 5 && rtt < 100) { isWifi = true; displayType = 'WiFi'; }
        else if (downlink >= 10) { isWifi = true; displayType = 'Fast'; }
        else if (downlink >= 2) { isWifi = false; displayType = 'Good'; }
        
        setNetworkInfo({ strength, isWifi, displayType });
      }
    };

    updateNetworkInfo();

    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    
    if (connection) {
      connection.addEventListener('change', updateNetworkInfo);
      return () => connection.removeEventListener('change', updateNetworkInfo);
    }
  }, []);

  // Calculate enabled steps based on workflow configuration
  // Location capture now comes AFTER document verification to enable address comparison
  const getEnabledSteps = (): WorkflowStep[] => {
    const steps: WorkflowStep[] = ['consent']; // Consent is always required
    
    if (!workflowSteps) {
      // If no workflow config, return all steps (default flow)
      return ['consent', 'video_call', 'document', 'location', 'face', 'form', 'completion'];
    }
    
    // Secure verification requires document (for face matching)
    const canDoSecureVerification = workflowSteps.secureVerification && workflowSteps.documentOCR;
    
    // Add video_call if any step needs camera (document, secure verification, or form)
    const needsCamera = workflowSteps.documentOCR || canDoSecureVerification || workflowSteps.form;
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
    
    // Add form if enabled
    if (workflowSteps.form) {
      steps.push('form');
    }
    
    // Completion is always the final step
    steps.push('completion');
    
    console.log('[EKYCWorkflow] Enabled steps:', steps, 'Config:', workflowSteps);
    
    return steps;
  };

  const enabledSteps = getEnabledSteps();

  // Update step instruction - displays in overlay AND plays as audio
  // waitForAudio: if true, waits for audio to complete before returning
  const updateStepInstruction = async (instruction: string, playAudio: boolean = true, waitForAudio: boolean = true) => {
    setStepInstruction(instruction);
    if (playAudio && isAudioReady()) {
      await playVoice(instruction, waitForAudio);
    }
  };

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

  // Set instruction when camera becomes active on video_call step
  useEffect(() => {
    const setCameraSetupInstruction = async () => {
      if (state.currentStep === 'video_call' && localStream && !cameraAudioPlayed && !cameraAudioPlaying) {
        setCameraAudioPlaying(true);
        
        // Initialize audio (user already interacted by giving consent)
        await initializeAudio();
        
        // Set step instruction (displays and plays audio, waits for completion)
        const instruction = "We are starting the identity verification process. " +
          "Please ensure you can see yourself clearly in the live view and your face is well lit.";
        await updateStepInstruction(instruction);
        
        setCameraAudioPlaying(false);
        setCameraAudioPlayed(true);
      }
    };
    
    setCameraSetupInstruction();
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
    const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face', 'form'];
    const currentIndex = enabledSteps.indexOf(nextStep);
    const remainingSteps = enabledSteps.slice(currentIndex);
    const anyCameraStepRemaining = remainingSteps.some(step => stepsNeedingCamera.includes(step));
    
    // Only stop camera if no remaining steps need it (e.g., moving to completion after form)
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
      const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face', 'form'];
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
      const stepsNeedingCamera: WorkflowStep[] = ['location', 'video_call', 'document', 'face', 'form'];
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

  const handleFormCompleted = () => {
    uiEventLoggerService.logEvent('form_completed');
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
            onStepInstruction={updateStepInstruction}
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
          if (nextStepAfterVideo === 'form') {
            return 'Start Form';
          }
          return 'Continue';
        };
        
        const nextStepLabel = getVideoCallButtonLabel();
        
        return (
          <div className="video-call-step">
            {!localStream && (
              <div className="status-message">
                <div className="spinner"></div>
                <p>Starting camera...</p>
              </div>
            )}
            {localStream && (
              <div className="camera-ready-message">
                <p>Camera is active. Ensure you can see yourself clearly.</p>
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
            onDocumentVerified={handleDocumentVerified}
            loading={loading}
            onStepInstruction={updateStepInstruction}
            mainVideoRef={videoRef}
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
            onVerified={handleSecureVerified}
            onComplete={handleSecureVerificationComplete}
            loading={loading}
            onStepInstruction={updateStepInstruction}
            onVisualFeedbackChange={handleVisualFeedbackChange}
            mainVideoRef={videoRef}
          />
        );

      case 'form':
        return (
          <FormScreen
            sessionId={state.sessionId}
            onCompleted={handleFormCompleted}
            loading={loading}
            fieldSet={formFieldSetId || 'account_opening'}
            onStepInstruction={updateStepInstruction}
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
      'face': 'Face Verification',
      'form': 'Data Collection',
      'completion': 'Complete',
    };
    return labels[step] || step.replace('_', ' ');
  };

  // Get current step instruction text (fallback if stepInstruction not set)
  const getStepInstruction = (): string => {
    const instructions: Record<WorkflowStep, string> = {
      'consent': 'Review and accept the terms to continue',
      'location': 'Verifying your location',
      'video_call': 'Ensure you can see yourself clearly and your face is well lit.',
      'document': 'Hold your document within the frame',
      'face': 'Follow the on-screen instructions',
      'form': 'Answer the form fields',
      'completion': 'Verification complete',
    };
    return instructions[state.currentStep] || '';
  };

  // Check if current step uses video
  const isVideoStep = ['video_call', 'face', 'location', 'document', 'form'].includes(state.currentStep);
  const isDocumentStep = state.currentStep === 'document';
  const isConsentStep = state.currentStep === 'consent';
  const isCompletionStep = state.currentStep === 'completion';
  
  // Full-page centered steps (no video/progress sidebar)
  const isFullPageStep = isConsentStep || isCompletionStep;

  return (
    <div className={`ekyc-workflow ekyc-light ${isFullPageStep ? 'full-page-step' : ''}`}>
      {/* Full page centered content for consent/completion steps */}
      {isFullPageStep ? (
        <div className="ekyc-centered-content">
          {state.error && (
            <div className="error-banner-light">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{state.error}</span>
            </div>
          )}
          {renderCurrentStep()}
        </div>
      ) : (
        <>
          {/* Main layout grid */}
          <div className="ekyc-main-layout">
            {/* Left side - Video preview area */}
            <div className="ekyc-video-section">
              {isVideoStep && localStream ? (
                <div className={`video-preview-container ${isDocumentStep ? 'document-mode' : ''} ${state.currentStep === 'face' && visualFeedback.mode === 'action' ? 'action-time' : ''} ${state.currentStep === 'face' && visualFeedback.mode === 'recording' ? 'recording-active' : ''}`}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`main-video-preview ${isDocumentStep ? 'no-mirror' : ''} ${state.currentStep === 'face' && visualFeedback.mode === 'action' ? 'action-pulse' : ''}`}
                  />
                  <div className="video-overlay-badges">
                    <div className="video-overlay-badge">
                      <span className="live-dot"></span>
                      LIVE
                    </div>
                    {isRecordingActive && (
                      <div className="recording-badge">
                        <span className="recording-dot"></span>
                        REC
                      </div>
                    )}
                  </div>
                  
                  {/* Visual Countdown Overlay (3-2-1) for Face Verification only */}
                  {state.currentStep === 'face' && visualFeedback.mode === 'countdown' && visualFeedback.countdownNumber !== null && (
                    <div className="countdown-overlay">
                      <div className="countdown-number">{visualFeedback.countdownNumber}</div>
                    </div>
                  )}
                  
                  {/* Recording pulse indicator during liveness capture - Face step only */}
                  {state.currentStep === 'face' && visualFeedback.mode === 'recording' && (
                    <div className="recording-pulse-ring"></div>
                  )}
                  
                  {/* Network strength indicator - top right */}
                  <div className={`network-indicator strength-${networkInfo.strength} ${networkInfo.isWifi ? 'wifi' : 'cellular'}`}>
                    {networkInfo.isWifi ? (
                      /* WiFi icon */
                      <svg className="wifi-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M12 18c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm-4.9-2.3l1.4 1.4C9.5 16.5 10.7 16 12 16s2.5.5 3.5 1.1l1.4-1.4C15.6 14.6 13.9 14 12 14s-3.6.6-4.9 1.7zm-2.8-2.8l1.4 1.4C7.3 13.2 9.5 12 12 12s4.7 1.2 6.3 2.3l1.4-1.4C17.7 11.2 15 10 12 10s-5.7 1.2-7.7 2.9zM1.5 10l1.4 1.4C5.1 9.2 8.4 8 12 8s6.9 1.2 9.1 3.4L22.5 10C19.8 7.4 16.1 6 12 6S4.2 7.4 1.5 10z"/>
                      </svg>
                    ) : (
                      /* Cellular signal bars */
                      <div className="signal-bars">
                        {[1, 2, 3, 4].map((bar) => (
                          <div
                            key={bar}
                            className={`signal-bar ${bar <= networkInfo.strength ? 'active' : ''}`}
                          />
                        ))}
                      </div>
                    )}
                    <span className="network-type">{networkInfo.displayType}</span>
                  </div>
                  
                  {/* ID Card overlay for document step */}
                  {isDocumentStep && (
                    <div className="id-card-overlay-main">
                      <div className="id-card-frame-main">
                        <div className="corner-marker top-left"></div>
                        <div className="corner-marker top-right"></div>
                        <div className="corner-marker bottom-left"></div>
                        <div className="corner-marker bottom-right"></div>
                        <div className="card-hint-main">
                          <span>Place ID card here</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="video-placeholder">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 7l-7 5 7 5V7z"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                  <span>Camera will activate when needed</span>
                </div>
              )}

              {/* Agent avatar - PIP style in corner */}
              {(isVideoStep && localStream) && (
                <div className="agent-overlay">
                  <div className="agent-avatar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                </div>
              )}

              {/* Instruction overlay - Closed captions style */}
              {(isVideoStep && localStream) && (
                <div className="video-bottom-overlay">
                  <div className="instruction-overlay">
                    <p>{stepInstruction || getStepInstruction()}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Right side - Progress checklist + Actions */}
            <div className="ekyc-progress-section">
              <div className="progress-content">
                <div className="progress-header">
                  <span className="progress-title">Progress</span>
                </div>
                <div className="progress-checklist">
                  {enabledSteps.map((step, index) => {
                    const isCompleted = state.completedSteps.includes(step as WorkflowStep);
                    const isActive = state.currentStep === step;
                    const isPending = !isCompleted && !isActive;
                    
                    return (
              <div
                key={step}
                        className={`checklist-item ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                      >
                        <div className="checklist-marker">
                          {isCompleted ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : isActive ? (
                            <div className="active-dot"></div>
                          ) : (
                            <div className="pending-dot"></div>
                          )}
              </div>
                        <span className="checklist-label">{getStepLabel(step)}</span>
          </div>
                    );
                  })}
        </div>
      </div>

              {/* Actions area at bottom of progress section */}
              <div className="progress-actions">
                {/* Error banner */}
        {state.error && (
                  <div className="error-banner-light">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span>{state.error}</span>
          </div>
        )}

                {/* Step content area */}
                <div className="step-content-area">
        {renderCurrentStep()}
      </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default EKYCWorkflow;


