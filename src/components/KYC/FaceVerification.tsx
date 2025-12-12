import React, { useState, useRef, useEffect } from 'react';
import kycApiService, { SecureVerificationResponse } from '../../services/kycApiService';
import {
  initializeAudio,
  playBeep,
  stopAllAudio,
  logAvailableVoices
} from '../../services/audioService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface FaceVerificationProps {
  sessionId: string;
  documentId: string;
  videoStream: MediaStream | null;
  onVerified: () => void;
  onComplete: () => void;
  loading: boolean;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
}

type VerificationStatus = 
  | 'idle'           // Initial state - show instructions
  | 'get_ready'      // Countdown before starting
  | 'capturing_face' // Capturing initial face image
  | 'liveness'       // Performing liveness actions
  | 'verifying'      // Sending to backend for verification
  | 'success'        // All checks passed
  | 'failed';        // One or more checks failed

/**
 * Face & Liveness Verification Component
 * 
 * Performs combined face matching + liveness check with anti-spoofing:
 * 1. Captures initial face image (used for document matching AND consistency check)
 * 2. Performs liveness actions while capturing frames
 * 3. Verifies face consistency between initial capture and liveness frames
 * 
 * This prevents the attack where user shows document during face capture
 * but uses their actual face during liveness.
 */
const FaceVerification: React.FC<FaceVerificationProps> = ({
  sessionId,
  documentId,
  videoStream,
  onVerified,
  onComplete,
  loading,
  onStepInstruction,
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  
  // State
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const [error, setError] = useState<string>('');
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [result, setResult] = useState<SecureVerificationResponse | null>(null);
  
  // Intro audio state
  const [introAudioPlayed, setIntroAudioPlayed] = useState(false);
  const introAudioStartedRef = useRef(false);

  // Assign stream to video element
  useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
      localVideoRef.current.play().catch(err => {
        console.log('Video autoplay:', err);
      });
    }
  }, [videoStream, status]);

  // Play intro instruction when component mounts
  useEffect(() => {
    const playIntroInstruction = async () => {
      if (introAudioStartedRef.current) return;
      introAudioStartedRef.current = true;
      
      // Small delay to ensure component is mounted
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (onStepInstruction) {
        await onStepInstruction('Please be prepared to follow instructions to verify your identity.');
      }
      
      setIntroAudioPlayed(true);
    };
    
    playIntroInstruction();
  }, [onStepInstruction]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, []);

  /**
   * Capture a single frame from the video
   */
  const captureFrame = async (): Promise<Blob | null> => {
    if (!localVideoRef.current) return null;

    const canvas = document.createElement('canvas');
    canvas.width = localVideoRef.current.videoWidth;
    canvas.height = localVideoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(localVideoRef.current, 0, 0);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
    });
  };

  /**
   * Helper: Show instruction with audio
   * Uses onStepInstruction to both display and play the instruction
   */
  const showInstruction = async (
    text: string, 
    type: 'prepare' | 'action' | 'info' = 'info',
    waitForVoice: boolean = false
  ): Promise<void> => {
    setCurrentInstruction(text);
    
    // Use onStepInstruction which handles both display and audio
    if (onStepInstruction) {
      await onStepInstruction(text);
      if (waitForVoice) {
        // Estimate ~100ms per word for speech
        const wordCount = text.split(' ').length;
        await new Promise(resolve => setTimeout(resolve, wordCount * 120));
      }
    }
  };

  /**
   * Start the secure verification process
   */
  const startVerification = async () => {
    setError('');
    
    // Log verification started
    uiEventLoggerService.logEvent('face_verification_started', { sessionId, documentId });
    
    // Initialize audio on user interaction (button click)
    await initializeAudio();
    
    // Log available voices for debugging (check browser console)
    logAvailableVoices();
    
    // Step 0: Get Ready phase
    setStatus('get_ready');
    await showInstruction('Position your face in the center of the frame', 'prepare', true);
    
    // Give user additional time to position themselves
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Instruction before face capture
    await showInstruction('Look straight at the camera, after the beep.', 'prepare');
    
    // Step 1: Capture initial face image
    setStatus('capturing_face');
    uiEventLoggerService.logEvent('face_capture_started', {});
    await playBeep('action'); // Sharp beep for capture
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const faceImage = await captureFrame();
    if (!faceImage) {
      setError('Failed to capture face image');
      setStatus('failed');
      uiEventLoggerService.logError('face_capture_failed', 'Failed to capture face image');
      stopAllAudio();
      setTimeout(() => onComplete(), 3000);
      return;
    }
    
    uiEventLoggerService.logEvent('face_captured', { success: true });
    console.log('[SecureVerification] Captured initial face image');
    
    // Step 2: Perform liveness actions
    setStatus('liveness');
    const frames = await performLivenessActions();
    
    // Step 3: Send to backend for verification
    await verify(faceImage, frames);
  };

  /**
   * Perform liveness actions and capture frames
   */
  const performLivenessActions = async (): Promise<Blob[]> => {
    const instructions = [
      { text: 'Blink your eyes naturally', voiceText: 'Please blink your eyes naturally, after the beep', duration: 3000, captureCount: 6, action: 'blink' },
      { text: 'Turn head slowly to the left', voiceText: 'Turn your head slowly to the left, after the beep', duration: 2500, captureCount: 5, action: 'turn_left' },
      { text: 'Turn head slowly to the right', voiceText: 'Turn your head slowly to the right, after the beep', duration: 2500, captureCount: 5, action: 'turn_right' },
      { text: 'Please smile', voiceText: 'Please smile, after the beep', duration: 2000, captureCount: 4, action: 'smile' },
      { text: 'Look straight at the camera', voiceText: 'Look straight at the camera, after the beep', duration: 1500, captureCount: 3, action: 'look_straight' },
    ];

    const frames: Blob[] = [];
    
    // Log liveness check started
    uiEventLoggerService.logEvent('liveness_check_started', { 
      totalActions: instructions.length 
    });

    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      
      // Log each liveness action
      uiEventLoggerService.logEvent('liveness_action', {
        action: instruction.action,
        step: i + 1,
        totalSteps: instructions.length,
        instruction: instruction.text
      });
      
      // Show instruction and speak it
      const prepareText = `${instruction.text}, after the beep`;
      setCurrentInstruction(prepareText);
      
      if (onStepInstruction) {
        await onStepInstruction(prepareText);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Action beep immediately after instruction
      await playBeep('action');
      
      // Action NOW
      const actionText = `${instruction.text} - NOW!`;
      setCurrentInstruction(actionText);
      if (onStepInstruction) {
        await onStepInstruction(actionText, false); // Don't play audio for "NOW" - just display
      }
      
      // Small delay before starting capture
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const captureInterval = instruction.duration / instruction.captureCount;
      
      for (let j = 0; j < instruction.captureCount; j++) {
        const frame = await captureFrame();
        if (frame) {
          frames.push(frame);
        }
        
        if (j < instruction.captureCount - 1) {
          await new Promise(resolve => setTimeout(resolve, captureInterval));
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    console.log(`[SecureVerification] Captured ${frames.length} liveness frames`);
    return frames;
  };

  /**
   * Send verification request to backend
   */
  const verify = async (faceImage: Blob, frames: Blob[]) => {
    setStatus('verifying');
    const verifyingText = 'Please wait. Verifying your identity.';
    setCurrentInstruction(verifyingText);
    
    // Stop any playing audio and show verifying instruction
    stopAllAudio();
    if (onStepInstruction) {
      onStepInstruction(verifyingText);
    }
    
    try {
      const result = await kycApiService.runSecureVerification(
        sessionId,
        documentId,
        faceImage,
        frames
      );
      
      setResult(result);
      stopAllAudio();
      
      // Log face verification results for timeline replay
      uiEventLoggerService.logFaceCheckResult(
        result.faceMatch.isMatch,
        result.faceMatch.matchScore,
        result.faceMatch.confidence
      );
      uiEventLoggerService.logLivenessCheckResult(
        result.liveness.overallResult,
        result.liveness.confidenceScore,
        result.liveness.checks
      );
      
      const completeText = 'Face Verification process is complete.';
      
      if (result.overallResult) {
        onVerified();
        setStatus('success');
        // Log verification success
        uiEventLoggerService.logEvent('face_verification_success', {
          faceMatchScore: result.faceMatch.matchScore,
          livenessScore: result.liveness.confidenceScore
        });
        if (onStepInstruction) {
          await onStepInstruction(completeText, true, true);
        }
        setTimeout(() => onComplete(), 1500);
      } else {
        setError(result.message);
        setStatus('failed');
        // Log verification failed
        uiEventLoggerService.logEvent('face_verification_failed', {
          reason: result.message,
          faceMatchScore: result.faceMatch.matchScore,
          livenessScore: result.liveness.confidenceScore
        });
        if (onStepInstruction) {
          await onStepInstruction(completeText, true, true);
        }
        setTimeout(() => onComplete(), 1500);
      }
    } catch (err: any) {
      console.error('[SecureVerification] Verification error:', err);
      setError(err.message || 'Verification failed');
      setStatus('failed');
      // Log verification error
      uiEventLoggerService.logError('face_verification_error', err.message || 'Verification failed');
      stopAllAudio();
      if (onStepInstruction) {
        await onStepInstruction('Thank you for your patience. Verification complete.', true, true);
      }
      setTimeout(() => onComplete(), 1500);
    }
  };

  return (
    <div className="face-verification">
      {/* Live video preview */}
      {videoStream && (
        <div className="live-video-preview">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxWidth: '640px',
              borderRadius: '10px',
              transform: 'scaleX(-1)',
              border: status === 'liveness' ? '3px solid #ff9800' : 
                     status === 'get_ready' ? '3px solid #2196f3' : 
                     status === 'capturing_face' ? '3px solid #ff5722' : '3px solid #4caf50'
            }}
          />
          <p className="video-label">
            {status === 'liveness' ? (
              currentInstruction.includes('NOW') ? 'Recording...' : 'Listen...'
            ) : 
             status === 'get_ready' ? 'Get Ready...' :
             status === 'capturing_face' ? 'Capturing...' : 'Live Camera'}
          </p>
        </div>
      )}
      
      {/* Initial state - start button only */}
      {status === 'idle' && (
        <div className="face-actions-standalone">
          <button 
            className="btn-primary" 
            onClick={startVerification} 
            disabled={loading || !introAudioPlayed}
          >
            {introAudioPlayed ? 'Start Verification' : 'Please wait...'}
          </button>
        </div>
      )}

      {/* Capturing initial face - spinner */}
      {status === 'capturing_face' && (
        <div className="face-status-standalone">
          <div className="spinner"></div>
        </div>
      )}

      {/* Liveness actions - show recording indicator when action */}
      {status === 'liveness' && currentInstruction.includes('NOW') && (
        <div className="face-status-standalone">
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            Recording...
          </div>
        </div>
      )}

      {/* Verifying - spinner only */}
      {status === 'verifying' && (
        <div className="face-status-standalone">
          <div className="spinner"></div>
        </div>
      )}
    </div>
  );
};

export default FaceVerification;
