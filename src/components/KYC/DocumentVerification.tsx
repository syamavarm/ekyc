import React, { useState, useRef, useCallback, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';
import { playVoice, isAudioReady, stopAllAudio } from '../../services/audioService';

interface DocumentVerificationProps {
  sessionId: string;
  videoStream: MediaStream | null;
  onDocumentVerified: (documentId: string, ocrData: any) => void;
  loading: boolean;
}

// ID card standard aspect ratio (85.6mm x 53.98mm ≈ 1.586:1)
const ID_CARD_ASPECT_RATIO = 1.586;
// Card guide takes up 70% of the video width
const CARD_WIDTH_PERCENT = 0.70;

type CaptureStep = 
  | 'capture-front' 
  | 'review-front' 
  | 'capture-back' 
  | 'review-back' 
  | 'processing' 
  | 'verified';

const DocumentVerification: React.FC<DocumentVerificationProps> = ({
  sessionId,
  videoStream,
  onDocumentVerified,
  loading,
}) => {
  const [step, setStep] = useState<CaptureStep>('capture-front');
  const [documentType] = useState<string>('auto');
  
  // Front side state
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  
  // Back side state
  const [backImage, setBackImage] = useState<string | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  
  const [ocrResults, setOcrResults] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [cardDetected, setCardDetected] = useState<boolean>(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  
  // Track which steps have had audio played (to avoid replaying on re-renders)
  const audioPlayedRef = useRef<Set<string>>(new Set());

  // Assign stream to video element - also re-run when step changes to capture mode
  useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
      // Ensure video plays
      localVideoRef.current.play().catch(err => {
        console.log('Video autoplay:', err);
      });
    }
  }, [videoStream, step]);

  // Play audio instructions based on step (only for capture steps)
  useEffect(() => {
    const playStepAudio = async () => {
      // Skip if audio already played for this step
      if (audioPlayedRef.current.has(step)) return;
      
      let message = '';
      
      switch (step) {
        case 'capture-front':
          message = 'Position the front of your ID card within the frame, and click on Capture Front Side button.';
          break;
        case 'capture-back':
          message = 'Now flip your card. Position the back of your ID card within the frame, and click on Capture Back Side button.';
          break;
        // processing and verified are handled directly in handleUploadBoth
        // No audio for review-front and review-back (retake scenarios)
        default:
          return;
      }
      
      if (message) {
        // Mark as played immediately to prevent duplicate attempts
        audioPlayedRef.current.add(step);
        
        // Wait a moment for audio system to be ready, then play
        // This handles cases where component mounts before audio is fully initialized
        const attemptPlay = async (retries: number = 3) => {
          if (isAudioReady()) {
            await playVoice(message, false);
          } else if (retries > 0) {
            // Retry after a short delay
            await new Promise(resolve => setTimeout(resolve, 500));
            await attemptPlay(retries - 1);
          } else {
            console.warn('[DocumentVerification] Audio not ready, skipping voice');
          }
        };
        
        await attemptPlay();
      }
    };
    
    // Small delay to ensure component is fully mounted and audio is ready
    const timer = setTimeout(playStepAudio, 300);
    return () => clearTimeout(timer);
  }, [step]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, []);

  // Calculate the card region coordinates
  const getCardRegion = useCallback(() => {
    if (!localVideoRef.current) return null;
    
    const videoWidth = localVideoRef.current.videoWidth;
    const videoHeight = localVideoRef.current.videoHeight;
    
    const cardWidth = videoWidth * CARD_WIDTH_PERCENT;
    const cardHeight = cardWidth / ID_CARD_ASPECT_RATIO;
    
    const x = (videoWidth - cardWidth) / 2;
    const y = (videoHeight - cardHeight) / 2;
    
    return { x, y, width: cardWidth, height: cardHeight };
  }, []);

  const captureImage = (): { file: File; imageUrl: string } | null => {
    if (!localVideoRef.current) return null;

    const video = localVideoRef.current;
    const cardRegion = getCardRegion();
    
    if (!cardRegion) return null;

    const canvas = document.createElement('canvas');
    canvas.width = cardRegion.width;
    canvas.height = cardRegion.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
      video,
      cardRegion.x, cardRegion.y, cardRegion.width, cardRegion.height,
      0, 0, cardRegion.width, cardRegion.height
    );
    
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const blob = dataURLtoBlob(dataUrl);
        const file = new File([blob], 'document.jpg', { type: 'image/jpeg' });
        const imageUrl = URL.createObjectURL(blob);
    
    return { file, imageUrl };
  };

  // Helper to convert dataURL to Blob
  const dataURLtoBlob = (dataURL: string): Blob => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const handleCaptureFront = () => {
    const result = captureImage();
    if (result) {
      setFrontImage(result.imageUrl);
      setFrontFile(result.file);
      setStep('review-front');
    }
  };

  const handleCaptureBack = () => {
    const result = captureImage();
    if (result) {
      setBackImage(result.imageUrl);
      setBackFile(result.file);
      setStep('review-back');
    }
  };

  const handleRetakeFront = () => {
    setFrontImage(null);
    setFrontFile(null);
    setStep('capture-front');
  };

  const handleRetakeBack = () => {
    setBackImage(null);
    setBackFile(null);
    setStep('capture-back');
  };

  const handleConfirmFront = () => {
    setStep('capture-back');
  };

  const handleUploadBoth = async () => {
    if (!frontFile || !backFile) return;

    setStep('processing');
    setError('');
    
    // Play processing audio
    if (isAudioReady()) {
      audioPlayedRef.current.add('processing');
      playVoice('Verifying document. Please wait.', false);
    }

    try {
      // Upload both front and back documents
      const uploadResponse = await kycApiService.uploadDocumentBothSides(
        sessionId,
        documentType,
        frontFile,
        backFile
      );

      // Run OCR on combined document
      const ocrResponse = await kycApiService.runOCR(sessionId, uploadResponse.documentId);

      if (ocrResponse.isValid) {
        setOcrResults(ocrResponse.ocrResults);
        setStep('verified');
        
        // Play completion audio and wait for it to finish
        if (isAudioReady()) {
          await playVoice('Document verification complete. Proceeding to next step.', true);
          // Mark as played so useEffect doesn't play it again
          audioPlayedRef.current.add('verified');
        }
        
        // Small pause after audio completes
        await new Promise(resolve => setTimeout(resolve, 500));
        
        onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults);
      } else {
        setError(ocrResponse.validationErrors?.join(', ') || 'Document validation failed');
        setStep('review-back');
      }
    } catch (err: any) {
      console.error('Document verification error:', err);
      setError(err.message || 'Failed to verify document');
      setStep('review-back');
    }
  };

  const handleVideoInteraction = () => {
    setCardDetected(true);
    setTimeout(() => setCardDetected(false), 2000);
  };

  const isCapturing = step === 'capture-front' || step === 'capture-back';
  const currentSide = step.includes('front') ? 'front' : 'back';

  return (
    <div className="document-verification">
      {/* Live video preview - always visible */}
      {videoStream && (
        <div className="live-video-preview document-capture-preview">
          <div 
            ref={videoContainerRef}
            className="video-with-overlay"
            onClick={handleVideoInteraction}
          >
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
              className="document-video"
            />
            {/* ID Card Guide Overlay - only show during capture */}
            {isCapturing && (
              <div className="id-card-overlay">
                <div className="overlay-mask overlay-top"></div>
                <div className="overlay-mask overlay-bottom"></div>
                <div className="overlay-mask overlay-left"></div>
                <div className="overlay-mask overlay-right"></div>
                
                <div className={`id-card-frame ${cardDetected ? 'detected' : ''}`}>
                  <div className="corner-marker top-left"></div>
                  <div className="corner-marker top-right"></div>
                  <div className="corner-marker bottom-left"></div>
                  <div className="corner-marker bottom-right"></div>
                  
                  <div className="card-hint">
                    <span className="hint-icon">{currentSide === 'front' ? '🪪' : '🔄'}</span>
                    <span className="hint-text">
                      {currentSide === 'front' ? 'Place FRONT of ID card' : 'Place BACK of ID card'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="video-label">
            <span className="pulse-dot"></span>
            Live Camera {isCapturing ? `- Capture ${currentSide.toUpperCase()} side` : ''}
          </p>
        </div>
      )}
      
      <div className="document-card">
        <h2>📄 Document Verification</h2>

        {/* Capture Front Side */}
        {step === 'capture-front' && (
          <>
            <div className="side-indicator front">
              <span className="side-badge">FRONT SIDE</span>
            </div>
            <p>Position the <strong>FRONT</strong> of your ID card within the frame.</p>
            <div className="capture-instructions">
              <ul>
                <li>✓ Photo and name should be visible</li>
                <li>✓ Document number clearly readable</li>
                <li>✓ Ensure good lighting, no glare</li>
              </ul>
            </div>
            <div className="document-actions">
              <button className="btn-primary btn-capture" onClick={handleCaptureFront}>
                📸 Capture Front Side
              </button>
            </div>
          </>
        )}

        {/* Review Front Side */}
        {step === 'review-front' && frontImage && (
          <>
            <div className="side-indicator front">
              <span className="side-badge">FRONT SIDE</span>
            </div>
            <p>Review the front side of your document:</p>
            <div className="document-preview">
              <img src={frontImage} alt="Document Front" />
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="document-actions">
              <button className="btn-secondary" onClick={handleRetakeFront}>
                ↩ Retake
              </button>
              <button className="btn-primary" onClick={handleConfirmFront}>
                ✓ Confirm & Continue
              </button>
            </div>
          </>
        )}

        {/* Capture Back Side */}
        {step === 'capture-back' && (
          <>
            <div className="side-indicator back">
              <span className="side-badge">BACK SIDE</span>
            </div>
            <p>Now flip your card and capture the <strong>BACK</strong> side.</p>
            <div className="capture-instructions">
              <ul>
                <li>✓ Address details should be visible</li>
                <li>✓ Any barcodes/QR codes readable</li>
                <li>✓ Keep card aligned in frame</li>
              </ul>
            </div>
            {/* Show front preview thumbnail */}
            {frontImage && (
              <div className="captured-preview">
                <small>Front side captured:</small>
                <img src={frontImage} alt="Front side" className="thumbnail" />
              </div>
            )}
            <div className="document-actions">
              <button className="btn-secondary" onClick={handleRetakeFront}>
                ↩ Redo Front
              </button>
              <button className="btn-primary btn-capture" onClick={handleCaptureBack}>
                📸 Capture Back Side
              </button>
            </div>
          </>
        )}

        {/* Review Back Side */}
        {step === 'review-back' && backImage && (
          <>
            <div className="side-indicator back">
              <span className="side-badge">BACK SIDE</span>
            </div>
            <p>Review both sides of your document:</p>
            <div className="document-preview-both">
              <div className="preview-item">
                <small>Front</small>
                <img src={frontImage!} alt="Document Front" />
              </div>
              <div className="preview-item">
                <small>Back</small>
                <img src={backImage} alt="Document Back" />
              </div>
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="document-actions">
              <button className="btn-secondary" onClick={handleRetakeBack}>
                ↩ Retake Back
              </button>
              <button className="btn-primary" onClick={handleUploadBoth} disabled={loading}>
                {loading ? 'Processing...' : '✓ Verify Document'}
              </button>
            </div>
          </>
        )}

        {/* Processing */}
        {step === 'processing' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>Verifying document...</p>
            <small>Extracting information from both sides...</small>
          </div>
        )}

        {/* Verified */}
        {step === 'verified' && ocrResults && (
          <div className="status-message">
            <div className="ocr-results">
              <h3>✅ Extracted Information:</h3>
              <p><strong>Name:</strong> {ocrResults.extractedData.fullName}</p>
              <p><strong>Date of Birth:</strong> {ocrResults.extractedData.dateOfBirth}</p>
              <p><strong>Address:</strong> {ocrResults.extractedData.address}</p>
              <p><strong>Document Number:</strong> {ocrResults.extractedData.documentNumber}</p>
            </div>
            <small>Proceeding to next step...</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentVerification;
