import React, { useState } from 'react';
import kycApiService from '../../services/kycApiService';

interface FaceVerificationProps {
  sessionId: string;
  documentId?: string; // Optional - only needed when face match is required
  videoStream: MediaStream | null;
  onFaceVerified: () => void;
  onLivenessVerified: () => void;
  onComplete: () => void; // Called when all required verifications are done
  loading: boolean;
  requireFaceMatch: boolean; // Whether face match is required
  requireLivenessCheck: boolean; // Whether liveness check is required
}

const FaceVerification: React.FC<FaceVerificationProps> = ({
  sessionId,
  documentId,
  videoStream,
  onFaceVerified,
  onLivenessVerified,
  onComplete,
  loading,
  requireFaceMatch,
  requireLivenessCheck,
}) => {
  const localVideoRef = React.useRef<HTMLVideoElement>(null);

  // Assign stream to video element
  React.useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  // Determine if face match can actually be performed (needs documentId)
  const canDoFaceMatch = requireFaceMatch && !!documentId;
  
  // Determine initial step based on requirements and available data
  const getInitialStep = (): 'face' | 'liveness' | 'complete' => {
    // Only go to face step if face match is required AND we have a document
    if (canDoFaceMatch) return 'face';
    // If face match required but no document, log warning and skip to liveness
    if (requireFaceMatch && !documentId) {
      console.warn('[FaceVerification] Face match required but no documentId available - skipping');
    }
    if (requireLivenessCheck) return 'liveness';
    return 'complete'; // Neither required or possible - will auto-proceed
  };

  const initialStep = getInitialStep();
  const [step, setStep] = useState<'face' | 'liveness' | 'complete'>(initialStep);

  // If nothing can be done in this step (no face match possible, no liveness), auto-proceed
  React.useEffect(() => {
    if (initialStep === 'complete') {
      console.log('[FaceVerification] Nothing to do in face step, auto-proceeding to next step');
      // Small delay to avoid flash
      const timer = setTimeout(() => {
        onComplete();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [initialStep, onComplete]);
  const [faceStatus, setFaceStatus] = useState<'idle' | 'capturing' | 'verifying' | 'verified' | 'failed'>('idle');
  const [livenessStatus, setLivenessStatus] = useState<'idle' | 'instructions' | 'capturing' | 'verifying' | 'verified' | 'failed'>(
    canDoFaceMatch ? 'idle' : 'instructions' // If skipping face, start liveness with instructions
  );
  const [faceResult, setFaceResult] = useState<any>(null);
  const [livenessResult, setLivenessResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [currentInstruction, setCurrentInstruction] = useState<string>('');
  const [capturedFrames, setCapturedFrames] = useState<Blob[]>([]);
  const faceRetryCountRef = React.useRef<number>(0);
  const MAX_FACE_RETRIES = 1; // Retry once before moving on

  const captureFaceImage = async () => {
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

  const proceedToNextStep = () => {
    console.log('[FaceVerification] Face verification failed after retries, proceeding to next step...');
    if (requireLivenessCheck) {
      setStep('liveness');
      setLivenessStatus('instructions');
    } else {
      onComplete();
    }
  };

  const handleCaptureFace = async (isRetry: boolean = false) => {
    setFaceStatus('capturing');
    setError('');

    try {
      if (!documentId) {
        throw new Error('Document ID is required for face verification');
      }

      const faceImage = await captureFaceImage();
      if (!faceImage) {
        throw new Error('Failed to capture face image');
      }

      setFaceStatus('verifying');
      const result = await kycApiService.verifyFace(sessionId, documentId, faceImage);

      if (result.isMatch) {
        setFaceResult(result);
        setFaceStatus('verified');
        onFaceVerified();
        
        setTimeout(() => {
          // Check if liveness is required
          if (requireLivenessCheck) {
            // Move to liveness check
            setStep('liveness');
            setLivenessStatus('instructions');
          } else {
            // Face match done, no liveness needed - complete
            console.log('[FaceVerification] Liveness check not required, completing...');
            onComplete();
          }
        }, 2000);
      } else {
        // Face verification failed
        faceRetryCountRef.current += 1;
        const currentRetry = faceRetryCountRef.current;
        
        if (currentRetry <= MAX_FACE_RETRIES) {
          // Retry once more
          console.log(`[FaceVerification] Face match failed, retrying (${currentRetry}/${MAX_FACE_RETRIES})...`);
          setError(`Face does not match. Retrying... (Attempt ${currentRetry + 1})`);
          setTimeout(() => {
            handleCaptureFace(true);
          }, 1500);
        } else {
          // Max retries reached, move to next step
          console.log('[FaceVerification] Max retries reached, moving to next step');
          setError('Face verification failed. Moving to next step...');
          setFaceStatus('failed');
          setTimeout(() => {
            proceedToNextStep();
          }, 2000);
        }
      }
    } catch (err: any) {
      console.error('Face verification error:', err);
      faceRetryCountRef.current += 1;
      const currentRetry = faceRetryCountRef.current;
      
      if (currentRetry <= MAX_FACE_RETRIES) {
        // Retry on error
        console.log(`[FaceVerification] Face verification error, retrying (${currentRetry}/${MAX_FACE_RETRIES})...`);
        setError(`Error occurred. Retrying... (Attempt ${currentRetry + 1})`);
        setFaceStatus('idle');
        setTimeout(() => {
          handleCaptureFace(true);
        }, 1500);
      } else {
        // Max retries reached, move to next step
        console.log('[FaceVerification] Max retries reached after error, moving to next step');
        setError('Face verification failed. Moving to next step...');
        setFaceStatus('failed');
        setTimeout(() => {
          proceedToNextStep();
        }, 2000);
      }
    }
  };

  const startLivenessCheck = () => {
    setLivenessStatus('capturing');
    setCapturedFrames([]);
    performLivenessChecks();
  };

  const [countdown, setCountdown] = useState<number | null>(null);

  const performLivenessChecks = async () => {
    const instructions = [
      { text: 'Please blink your eyes naturally', duration: 3000, captureCount: 6, readTime: 1500 },
      { text: 'Turn your head slowly to the left', duration: 2500, captureCount: 5, readTime: 1500 },
      { text: 'Turn your head slowly to the right', duration: 2500, captureCount: 5, readTime: 1500 },
      { text: 'Please smile', duration: 2000, captureCount: 4, readTime: 1200 },
      { text: 'Look straight at the camera', duration: 1500, captureCount: 3, readTime: 1000 },
    ];

    const frames: Blob[] = [];

    for (let i = 0; i < instructions.length; i++) {
      const instruction = instructions[i];
      
      // Show instruction with "Get Ready" countdown
      setCurrentInstruction(`${instruction.text}`);
      setCountdown(3);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(2);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(1);
      await new Promise(resolve => setTimeout(resolve, 800));
      setCountdown(null);
      
      // Now show "Do it now!" and start capturing
      setCurrentInstruction(`${instruction.text} - NOW!`);
      
      // Capture multiple frames during each action to detect movement
      const captureInterval = instruction.duration / instruction.captureCount;
      
      for (let j = 0; j < instruction.captureCount; j++) {
        // Capture frame
        const frame = await captureFaceImage();
        if (frame) {
          frames.push(frame);
        }
        
        // Wait before next capture (except for last frame)
        if (j < instruction.captureCount - 1) {
          await new Promise(resolve => setTimeout(resolve, captureInterval));
        }
      }
      
      // Brief pause between instructions
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    setCapturedFrames(frames);
    setLivenessStatus('verifying');

    try {
      const result = await kycApiService.runLivenessCheck(sessionId, frames);

      if (result.overallResult) {
        setLivenessResult(result);
        setLivenessStatus('verified');
        onLivenessVerified();
        setTimeout(() => {
          // All verifications complete
          console.log('[FaceVerification] Liveness check passed, completing...');
          onComplete();
        }, 2000);
      } else {
        setError('Liveness check could not be verified.');
        setLivenessStatus('failed');
        // Auto-proceed after showing result
        setTimeout(() => {
          console.log('[FaceVerification] Liveness check failed, proceeding to complete...');
          onComplete();
        }, 3000);
      }
    } catch (err: any) {
      console.error('Liveness check error:', err);
      setError(err.message || 'Failed to perform liveness check');
      setLivenessStatus('failed');
      // Auto-proceed after showing error
      setTimeout(() => {
        console.log('[FaceVerification] Liveness check error, proceeding to complete...');
        onComplete();
      }, 3000);
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
              maxWidth: '400px',
              borderRadius: '10px',
              transform: 'scaleX(-1)',
              border: '3px solid #4caf50'
            }}
          />
          <p className="video-label">Live Camera</p>
        </div>
      )}
      
      <div className="face-card">
        {step === 'face' && (
          <>
            <h2>👤 Face Verification</h2>
            <p>We'll compare your live face with the photo on your document.</p>

            {faceStatus === 'idle' && (
              <>
                <div className="face-instructions">
                  <ul>
                    <li>✓ Look directly at the camera</li>
                    <li>✓ Ensure your face is well-lit</li>
                    <li>✓ Remove glasses if possible</li>
                    <li>✓ Keep a neutral expression</li>
                  </ul>
                </div>
                <button className="btn-primary" onClick={() => handleCaptureFace()}>
                  Capture Face
                </button>
              </>
            )}

            {faceStatus === 'capturing' && (
              <div className="status-message">
                <div className="spinner"></div>
                <p>Capturing face image...</p>
              </div>
            )}

            {faceStatus === 'verifying' && (
              <div className="status-message">
                <div className="spinner"></div>
                <p>Verifying face match...</p>
              </div>
            )}

            {faceStatus === 'verified' && faceResult && (
              <div className="status-message success">
                <span className="icon">✓</span>
                <p>Face verified successfully!</p>
                <p><strong>Match Score:</strong> {(faceResult.matchScore * 100).toFixed(1)}%</p>
                <p><strong>Confidence:</strong> {(faceResult.confidence * 100).toFixed(1)}%</p>
              </div>
            )}

            {faceStatus === 'failed' && (
              <div className="status-message error">
                <span className="icon">⚠️</span>
                <p>{error}</p>
              </div>
            )}
          </>
        )}

        {step === 'liveness' && (
          <>
            <h2>🎭 Liveness Check</h2>
            <p>Please follow the on-screen instructions to verify you're a real person.</p>

            {livenessStatus === 'instructions' && (
              <>
                <div className="liveness-instructions">
                  <p>You will be asked to perform the following actions:</p>
                  <ul>
                    <li>Blink your eyes</li>
                    <li>Turn your head left and right</li>
                    <li>Smile</li>
                    <li>Look at the camera</li>
                  </ul>
                  <p><strong>This will take about 25-30 seconds.</strong></p>
                </div>
                <button className="btn-primary" onClick={startLivenessCheck}>
                  Start Liveness Check
                </button>
              </>
            )}

            {livenessStatus === 'capturing' && (
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

            {livenessStatus === 'verifying' && (
              <div className="status-message">
                <div className="spinner"></div>
                <p>Analyzing liveness checks...</p>
              </div>
            )}

            {livenessStatus === 'verified' && livenessResult && (
              <div className="status-message success">
                <span className="icon">✓</span>
                <p>Liveness check passed!</p>
                <p><strong>Confidence:</strong> {(livenessResult.confidenceScore * 100).toFixed(1)}%</p>
                <div className="liveness-checks">
                  {livenessResult.checks.map((check: any, index: number) => (
                    <div key={index} className="check-item">
                      <span className={check.result ? 'check-pass' : 'check-fail'}>
                        {check.result ? '✓' : '✗'}
                      </span>
                      {check.type.replace('_', ' ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {livenessStatus === 'failed' && (
              <div className="status-message error">
                <span className="icon">⚠️</span>
                <p>{error}</p>
                <p className="proceeding-message">Proceeding to next step...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FaceVerification;

