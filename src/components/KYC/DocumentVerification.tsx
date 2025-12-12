import React, { useState, useRef, useCallback, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';
import { stopAllAudio } from '../../services/audioService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface DocumentVerificationProps {
  sessionId: string;
  videoStream: MediaStream | null;
  onDocumentVerified: (documentId: string, ocrData: any) => void;
  loading: boolean;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
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
  onStepInstruction,
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
  const localVideoRef = useRef<HTMLVideoElement>(null);
  
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

  // Set step instruction based on current step (displays and plays audio)
  useEffect(() => {
    const setStepInstructionForStep = async () => {
      // Skip if instruction already set for this step
      if (audioPlayedRef.current.has(step)) return;
      
      let message = '';
      
      switch (step) {
        case 'capture-front':
          message = 'Position the front of your ID card within the frame.';
          break;
        case 'capture-back':
          message = 'Now flip your card. Position the back side within the frame.';
          break;
        case 'review-front':
          message = 'Review the captured image. Retake if needed.';
          break;
        case 'review-back':
          message = 'Review both sides. Click verify when ready.';
          break;
        case 'processing':
          message = 'Verifying document. Please wait.';
          break;
        default:
          return;
      }
      
      if (message && onStepInstruction) {
        // Mark as played immediately to prevent duplicate attempts
        audioPlayedRef.current.add(step);
        await onStepInstruction(message);
      }
    };
    
    // Small delay to ensure component is fully mounted
    const timer = setTimeout(setStepInstructionForStep, 300);
    return () => clearTimeout(timer);
  }, [step, onStepInstruction]);

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
      // Log document front capture
      uiEventLoggerService.logDocumentCaptured(documentType, 'front');
    }
  };

  const handleCaptureBack = () => {
    const result = captureImage();
    if (result) {
      setBackImage(result.imageUrl);
      setBackFile(result.file);
      setStep('review-back');
      // Log document back capture
      uiEventLoggerService.logDocumentCaptured(documentType, 'back');
    }
  };

  const handleRetakeFront = () => {
    setFrontImage(null);
    setFrontFile(null);
    setStep('capture-front');
    uiEventLoggerService.logEvent('document_retake', { side: 'front' });
  };

  const handleRetakeBack = () => {
    setBackImage(null);
    setBackFile(null);
    setStep('capture-back');
    uiEventLoggerService.logEvent('document_retake', { side: 'back' });
  };

  const handleConfirmFront = () => {
    setStep('capture-back');
    uiEventLoggerService.logEvent('document_front_confirmed', {});
  };

  const handleUploadBoth = async () => {
    if (!frontFile || !backFile) return;

    setStep('processing');
    setError('');
    
    // Log document processing started
    uiEventLoggerService.logEvent('document_processing_started', { 
      documentType,
      hasFront: !!frontFile,
      hasBack: !!backFile
    });

    try {
      // Upload both front and back documents
      const uploadResponse = await kycApiService.uploadDocumentBothSides(
        sessionId,
        documentType,
        frontFile,
        backFile
      );
      
      // Log document upload complete
      uiEventLoggerService.logEvent('document_uploaded', { 
        documentId: uploadResponse.documentId,
        documentType
      });

      // Run OCR on combined document
      const ocrResponse = await kycApiService.runOCR(sessionId, uploadResponse.documentId);
      
      // Log OCR result
      uiEventLoggerService.logEvent('document_ocr_result', {
        isValid: ocrResponse.isValid,
        hasExtractedData: !!ocrResponse.ocrResults?.extractedData,
        validationErrors: ocrResponse.validationErrors
      });

      if (ocrResponse.isValid) {
        setOcrResults(ocrResponse.ocrResults);
        setStep('verified');
        
        // Log document verified
        uiEventLoggerService.logEvent('document_verified', {
          documentId: uploadResponse.documentId,
          extractedFields: ocrResponse.ocrResults?.extractedData ? Object.keys(ocrResponse.ocrResults.extractedData) : []
        });
        
        // Set completion instruction and wait for audio to finish
        if (onStepInstruction) {
          await onStepInstruction('Thanks for waiting.', true, true);
          audioPlayedRef.current.add('verified');
        }
        
        // Small pause after audio completes
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults);
      } else {
        setError(ocrResponse.validationErrors?.join(', ') || 'Document validation failed');
        setStep('review-back');
        // Log OCR validation failed
        uiEventLoggerService.logError('document_validation_failed', ocrResponse.validationErrors?.join(', ') || 'Document validation failed');
      }
    } catch (err: any) {
      console.error('Document verification error:', err);
      setError(err.message || 'Failed to verify document');
      setStep('review-back');
      // Log document verification error
      uiEventLoggerService.logError('document_verification_error', err.message || 'Failed to verify document');
    }
  };

  // Determine if we have content to show in the document card (snapshots only)
  const hasCardContent = 
    (step === 'review-front' && frontImage) ||
    (step === 'capture-back' && frontImage) ||
    (step === 'review-back' && backImage);

  return (
    <div className="document-verification">
      {/* Hidden video element for capture purposes only */}
      {videoStream && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{ display: 'none' }}
        />
      )}
      
      {/* Document card - only render for snapshots */}
      {hasCardContent && (
        <div className="document-card document-card-minimal">
          {/* Review Front Side - snapshot only */}
          {step === 'review-front' && frontImage && (
            <>
              <div className="document-snapshot">
                <img src={frontImage} alt="Document Front" />
                <span className="snapshot-label">Front</span>
              </div>
              {error && <div className="error-message">{error}</div>}
            </>
          )}

          {/* Capture Back Side - show front preview */}
          {step === 'capture-back' && frontImage && (
            <div className="document-snapshot">
              <img src={frontImage} alt="Front side" />
              <span className="snapshot-label">Front captured</span>
            </div>
          )}

          {/* Review Back Side - both snapshots */}
          {step === 'review-back' && backImage && (
            <>
              <div className="document-snapshots-row">
                <div className="document-snapshot">
                  <img src={frontImage!} alt="Document Front" />
                  <span className="snapshot-label">Front</span>
                </div>
                <div className="document-snapshot">
                  <img src={backImage} alt="Document Back" />
                  <span className="snapshot-label">Back</span>
                </div>
              </div>
              {error && <div className="error-message">{error}</div>}
            </>
          )}
        </div>
      )}

      {/* Processing spinner only - message shown in instruction overlay */}
      {step === 'processing' && (
        <div className="document-status-standalone">
          <div className="spinner"></div>
        </div>
      )}

      {/* Buttons - always outside the card */}
      {step === 'capture-front' && (
        <div className="document-actions-standalone">
          <button className="btn-primary btn-capture" onClick={handleCaptureFront}>
            Capture Front Side
          </button>
        </div>
      )}

      {step === 'review-front' && frontImage && (
        <div className="document-actions-standalone">
          <button className="btn-secondary" onClick={handleRetakeFront}>
            Retake
          </button>
          <button className="btn-primary" onClick={handleConfirmFront}>
            Confirm
          </button>
        </div>
      )}

      {step === 'capture-back' && (
        <div className="document-actions-standalone">
          <button className="btn-secondary" onClick={handleRetakeFront}>
            Redo Front
          </button>
          <button className="btn-primary btn-capture" onClick={handleCaptureBack}>
            Capture Back Side
          </button>
        </div>
      )}

      {step === 'review-back' && backImage && (
        <div className="document-actions-standalone">
          <button className="btn-secondary" onClick={handleRetakeBack}>
            Retake
          </button>
          <button className="btn-primary" onClick={handleUploadBoth} disabled={loading}>
            {loading ? 'Processing...' : 'Verify'}
          </button>
        </div>
      )}
    </div>
  );
};

export default DocumentVerification;
