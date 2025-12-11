import React, { useState, useRef, useEffect } from 'react';
import kycApiService, { SecureVerificationResponse } from '../../services/kycApiService';
import {
  initializeAudio,
  playBeep,
  playVoice,
  playBeepThenVoice,
  stopAllAudio,
  isAudioReady,
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
}) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  
  // State
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const [error, setError] = useState<string>('');
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [countdown, setCountdown] = useState<number | null>(null);
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

  // Play intro audio when component mounts
  useEffect(() => {
    const playIntroAudio = async () => {
      if (introAudioStartedRef.current) return;
      introAudioStartedRef.current = true;
      
      // Small delay to ensure component is mounted
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (isAudioReady()) {
        await playVoice('You will now be asked to follow a set of instructions to verify your identity. Please be prepared to follow them.', true);
      }
      
      setIntroAudioPlayed(true);
    };
    
    playIntroAudio();
  }, []);

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
   * @param waitForVoice - If true, waits for voice to complete before returning
   */
  const showInstruction = async (
    text: string, 
    type: 'prepare' | 'action' | 'info' = 'info',
    waitForVoice: boolean = false
  ): Promise<void> => {
    setCurrentInstruction(text);
    
    if (isAudioReady()) {
      if (type === 'prepare') {
        await playBeepThenVoice(text, 'prepare');
        if (waitForVoice) {
          // Estimate ~100ms per word for speech
          const wordCount = text.split(' ').length;
          await new Promise(resolve => setTimeout(resolve, wordCount * 120));
        }
      } else if (type === 'action') {
        await playBeepThenVoice(text, 'action');
        if (waitForVoice) {
          const wordCount = text.split(' ').length;
          await new Promise(resolve => setTimeout(resolve, wordCount * 120));
        }
      } else {
        if (waitForVoice) {
          await playVoice(text, true);
        } else {
          playVoice(text, false);
        }
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
    
    // Step 0: Get Ready phase with countdown
    setStatus('get_ready');
    await showInstruction('Position your face in the center of the frame', 'prepare', true);
    
    // Give user additional time to position themselves
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Countdown before face capture
    await showInstruction('Look straight at the camera, after the beep.', 'prepare');
    setCountdown(3);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setCountdown(2);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setCountdown(1);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setCountdown(null);
    
    // Step 1: Capture initial face image
    setStatus('capturing_face');
    uiEventLoggerService.logEvent('face_capture_started', {});
    await showInstruction('Hold still', 'action');
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
      
      // Show "prepare" instruction with soft beep and voice
      setCurrentInstruction(`Get ready: ${instruction.text}`);
      setCountdown(null);
      
      if (isAudioReady()) {
        await playBeep('prepare');
        await new Promise(resolve => setTimeout(resolve, 100));
        await playVoice(instruction.voiceText, true);
      } else {
        // If no audio, show instruction for a few seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Small pause after voice completes
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Action NOW - sharp beep (this is the "beep" they were told to wait for)
      setCurrentInstruction(`${instruction.text} - NOW!`);
      if (isAudioReady()) {
        await playBeep('action');
      }
      
      // Small delay after beep before starting capture
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
    setCurrentInstruction('Verifying identity...');
    
    // Stop any playing audio and announce verifying
    stopAllAudio();
    if (isAudioReady()) {
      playVoice('Please wait. Verifying your identity.', false);
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
      
      if (result.overallResult) {
        onVerified();
        setStatus('success');
        // Log verification success
        uiEventLoggerService.logEvent('face_verification_success', {
          faceMatchScore: result.faceMatch.matchScore,
          livenessScore: result.liveness.confidenceScore
        });
        if (isAudioReady()) {
          await playVoice('Verification complete. Proceeding to next step.', true);
        }
        setTimeout(() => onComplete(), 2000);
      } else {
        setError(result.message);
        setStatus('failed');
        // Log verification failed
        uiEventLoggerService.logEvent('face_verification_failed', {
          reason: result.message,
          faceMatchScore: result.faceMatch.matchScore,
          livenessScore: result.liveness.confidenceScore
        });
        if (isAudioReady()) {
          await playVoice('Verification complete. Proceeding to next step.', true);
        }
        setTimeout(() => onComplete(), 2500);
      }
    } catch (err: any) {
      console.error('[SecureVerification] Verification error:', err);
      setError(err.message || 'Verification failed');
      setStatus('failed');
      // Log verification error
      uiEventLoggerService.logError('face_verification_error', err.message || 'Verification failed');
      stopAllAudio();
      if (isAudioReady()) {
        await playVoice('Verification complete. Proceeding to next step.', true);
      }
      setTimeout(() => onComplete(), 2000);
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
              currentInstruction.includes('NOW') ? '🔴 Recording' : '👂 Listen...'
            ) : 
             status === 'get_ready' ? '⏳ Get Ready...' :
             status === 'capturing_face' ? '📸 Capturing...' : 'Live Camera'}
          </p>
        </div>
      )}
      
      <div className="face-card">
        {/* Initial state - show instructions */}
        {status === 'idle' && (
          <>
            <div className="face-instructions">
              <ul>
                <li>✓ Ensure your face is well-lit</li>
                <li>✓ Look directly at the camera</li>
                <li>✓ Remove glasses if possible</li>
                <li>✓ Be prepared to follow instructions</li>
                <li>✓ The process takes about 25-30 seconds</li>
              </ul>
            </div>
            <button 
              className="btn-primary" 
              onClick={startVerification} 
              disabled={loading || !introAudioPlayed}
            >
              {introAudioPlayed ? 'Start Verification' : 'Please wait...'}
            </button>
          </>
        )}

        {/* Get ready phase with countdown */}
        {status === 'get_ready' && (
          <div className="status-message">
            {countdown !== null ? (
              <div className="countdown-display">
                <div className="countdown-number">{countdown}</div>
                <div className="countdown-instruction">{currentInstruction}</div>
                <p className="countdown-hint">Get ready to hold still...</p>
              </div>
            ) : (
              <>
                <div className="get-ready-instruction">
                  <div className="pulse-icon">👁️</div>
                  <p className="instruction-text">{currentInstruction}</p>
                </div>
                <p className="hint-text">Make sure your face is centered and well-lit</p>
              </>
            )}
          </div>
        )}

        {/* Capturing initial face */}
        {status === 'capturing_face' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p className="instruction-text">{currentInstruction}</p>
            <p className="hint-text">Capturing your face...</p>
          </div>
        )}

        {/* Liveness actions */}
        {status === 'liveness' && (
          <div className="status-message">
            {currentInstruction.includes('NOW') ? (
              <div className="liveness-instruction-large">
                <div className="action-now">{currentInstruction}</div>
                <div className="recording-indicator">
                  <span className="recording-dot"></span>
                  Recording...
                </div>
              </div>
            ) : (
              <div className="get-ready-instruction">
                <div className="pulse-icon">👂</div>
                <p className="instruction-text">{currentInstruction}</p>
                <p className="hint-text">Listen to the instruction...</p>
              </div>
            )}
          </div>
        )}

        {/* Verifying */}
        {status === 'verifying' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>{currentInstruction}</p>
          </div>
        )}

        {/* Complete - success or failed (don't reveal result to user) */}
        {(status === 'success' || status === 'failed') && (
          <div className="status-message">
            <p>Identity verification complete</p>
            <small>Proceeding to next step...</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default FaceVerification;
