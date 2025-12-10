import React, { useState, useRef, useEffect } from 'react';
import kycApiService, { SecureVerificationResponse } from '../../services/kycApiService';

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

  // Assign stream to video element
  useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

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
   * Start the secure verification process
   */
  const startVerification = async () => {
    setError('');
    setStatus('capturing_face');
    
    // Small delay to let UI update
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 1: Capture initial face image
    setCurrentInstruction('Look straight at the camera');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const faceImage = await captureFrame();
    if (!faceImage) {
      setError('Failed to capture face image');
      setStatus('failed');
      setTimeout(() => onComplete(), 3000);
      return;
    }
    
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
      { text: 'Please blink your eyes naturally', duration: 3000, captureCount: 6 },
      { text: 'Turn your head slowly to the left', duration: 2500, captureCount: 5 },
      { text: 'Turn your head slowly to the right', duration: 2500, captureCount: 5 },
      { text: 'Please smile', duration: 2000, captureCount: 4 },
      { text: 'Look straight at the camera', duration: 1500, captureCount: 3 },
    ];

    const frames: Blob[] = [];

    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      
      // Show instruction with countdown
      setCurrentInstruction(instruction.text);
      setCountdown(3);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(2);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(1);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(null);
      
      // Start capturing
      setCurrentInstruction(`${instruction.text} - NOW!`);
      
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
      
      await new Promise(resolve => setTimeout(resolve, 500));
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
    
    try {
      const result = await kycApiService.runSecureVerification(
        sessionId,
        documentId,
        faceImage,
        frames
      );
      
      setResult(result);
      
      if (result.overallResult) {
        onVerified();
        setStatus('success');
        setTimeout(() => onComplete(), 3000);
      } else {
        setError(result.message);
        setStatus('failed');
        setTimeout(() => onComplete(), 4000);
      }
    } catch (err: any) {
      console.error('[SecureVerification] Verification error:', err);
      setError(err.message || 'Verification failed');
      setStatus('failed');
      setTimeout(() => onComplete(), 3000);
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
              border: status === 'liveness' ? '3px solid #ff9800' : '3px solid #4caf50'
            }}
          />
          <p className="video-label">
            {status === 'liveness' ? '🔴 Recording' : 'Live Camera'}
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
            <button className="btn-primary" onClick={startVerification} disabled={loading}>
              Start Verification
            </button>
          </>
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
            {countdown !== null ? (
              <div className="countdown-display">
                <div className="countdown-number">{countdown}</div>
                <div className="countdown-instruction">{currentInstruction}</div>
                <p className="countdown-hint">Get ready...</p>
              </div>
            ) : (
              <div className="liveness-instruction-large">
                <div className="action-now">{currentInstruction}</div>
                <div className="recording-indicator">
                  <span className="recording-dot"></span>
                  Recording...
                </div>
              </div>
            )}
          </div>
        )}

        {/* Verifying */}
        {status === 'verifying' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>{currentInstruction}</p>
            <p className="hint-text">Checking face match, liveness, and consistency...</p>
          </div>
        )}

        {/* Complete - success or failed (don't reveal result to user) */}
        {(status === 'success' || status === 'failed') && (
          <div className="status-message">
            <p>Face & Liveness check complete</p>
            <small>Proceeding to next step...</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default FaceVerification;
