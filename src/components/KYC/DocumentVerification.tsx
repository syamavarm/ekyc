import React, { useState, useRef, useCallback, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';
import { stopAllAudio } from '../../services/audioService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface LocationComparisonResult {
  documentAddress?: string;
  distanceKm?: number;
  allowedRadiusKm?: number;
  withinRadius?: boolean;
  userCountry?: string;
  documentCountry?: string;
  sameCountry?: boolean;
  verificationType?: 'radius' | 'country';
  verified?: boolean;
  message?: string;
  locationSource?: 'gps' | 'ip';
}

interface DocumentVerificationProps {
  sessionId: string;
  onDocumentVerified: (documentId: string, ocrData: any, locationResult?: LocationComparisonResult) => void;
  loading: boolean;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
  // Reference to main video element for frame capture (parent owns the only <video>)
  mainVideoRef: React.RefObject<HTMLVideoElement>;
  // Location verification config - if enabled, location is verified after OCR
  locationEnabled?: boolean;
  locationRadiusKm?: number;
  // GPS coordinates from parent (already obtained earlier in workflow)
  gpsCoordinates?: { latitude: number; longitude: number } | null;
}

// ID card standard aspect ratio (85.6mm x 53.98mm ≈ 1.586:1)
const ID_CARD_ASPECT_RATIO = 1.586;
// Card guide takes up 65% of the video width (matches CSS overlay)
const CARD_WIDTH_PERCENT = 0.65;

type CaptureStep = 
  | 'capture-front' 
  | 'review-front' 
  | 'capture-back' 
  | 'review-back' 
  | 'processing' 
  | 'verifying-location'
  | 'verified';

const DocumentVerification: React.FC<DocumentVerificationProps> = ({
  sessionId,
  onDocumentVerified,
  loading,
  onStepInstruction,
  mainVideoRef,
  locationEnabled = false,
  locationRadiusKm,
  gpsCoordinates,
}) => {
  const [step, setStep] = useState<CaptureStep>('capture-front');
  const [documentType] = useState<string>('auto');
  
  // Front side state
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  
  // Back side state
  const [backImage, setBackImage] = useState<string | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [ocrResults, setOcrResults] = useState<any>(null);
  const [error, setError] = useState<string>('');
  
  // Track which steps have had audio played (to avoid replaying on re-renders)
  const audioPlayedRef = useRef<Set<string>>(new Set());

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
        case 'verifying-location':
          message = 'Verifying your location.';
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

  // Calculate the card region coordinates accounting for object-fit: cover
  const getCardRegion = useCallback(() => {
    if (!mainVideoRef.current) return null;
    
    const videoElement = mainVideoRef.current;
    
    // Native video dimensions
    const nativeWidth = videoElement.videoWidth;
    const nativeHeight = videoElement.videoHeight;
    
    // Displayed element dimensions
    const displayWidth = videoElement.clientWidth;
    const displayHeight = videoElement.clientHeight;
    
    if (!nativeWidth || !nativeHeight || !displayWidth || !displayHeight) {
      return null;
    }
    
    // Calculate how object-fit: cover scales the video
    const nativeAspect = nativeWidth / nativeHeight;
    const displayAspect = displayWidth / displayHeight;
    
    let scale: number;
    let offsetX = 0;
    let offsetY = 0;
    
    if (nativeAspect > displayAspect) {
      // Video is wider than container - height fits, width is cropped
      scale = displayHeight / nativeHeight;
      const scaledWidth = nativeWidth * scale;
      offsetX = (scaledWidth - displayWidth) / 2; // Amount cropped from each side
    } else {
      // Video is taller than container - width fits, height is cropped
      scale = displayWidth / nativeWidth;
      const scaledHeight = nativeHeight * scale;
      offsetY = (scaledHeight - displayHeight) / 2; // Amount cropped from top/bottom
    }
    
    // The overlay is 65% of the display width, centered
    const overlayWidth = displayWidth * CARD_WIDTH_PERCENT;
    const overlayHeight = overlayWidth / ID_CARD_ASPECT_RATIO;
    const overlayX = (displayWidth - overlayWidth) / 2;
    const overlayY = (displayHeight - overlayHeight) / 2;
    
    // Convert overlay coordinates (in display space) to native video coordinates
    // Account for the offset caused by object-fit: cover cropping
    const nativeX = (overlayX + offsetX) / scale;
    const nativeY = (overlayY + offsetY) / scale;
    const nativeCardWidth = overlayWidth / scale;
    const nativeCardHeight = overlayHeight / scale;
    
    return { 
      x: nativeX, 
      y: nativeY, 
      width: nativeCardWidth, 
      height: nativeCardHeight 
    };
  }, [mainVideoRef]);

  const captureImage = (): { file: File; imageUrl: string } | null => {
    if (!mainVideoRef.current) return null;
    
    const videoElement = mainVideoRef.current;

    const cardRegion = getCardRegion();
    
    if (!cardRegion) return null;

    const canvas = document.createElement('canvas');
    canvas.width = cardRegion.width;
    canvas.height = cardRegion.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
      videoElement,
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
        
        // Log document verified
        uiEventLoggerService.logEvent('document_verified', {
          documentId: uploadResponse.documentId,
          extractedFields: ocrResponse.ocrResults?.extractedData ? Object.keys(ocrResponse.ocrResults.extractedData) : []
        });
        
        // If location verification is enabled and we have an address from OCR, verify location
        const extractedAddress = ocrResponse.ocrResults?.extractedData?.address;
        
        if (locationEnabled && extractedAddress) {
          setStep('verifying-location');
          
          // Play location verification audio and wait for it to complete
          // Mark as played BEFORE the call to prevent useEffect from also playing it
          audioPlayedRef.current.add('verifying-location');
          if (onStepInstruction) {
            await onStepInstruction('Verifying your location.', true, true);
          }
          
          // Log location check started BEFORE the API call
          uiEventLoggerService.logEvent('location_check_started', { 
            documentAddress: extractedAddress,
          });
          
          try {
            // Use GPS coordinates from parent (already obtained earlier) or try to get them again
            let gpsLatitude: number | undefined;
            let gpsLongitude: number | undefined;
            
            if (gpsCoordinates) {
              // Use coordinates already obtained in parent component
              gpsLatitude = gpsCoordinates.latitude;
              gpsLongitude = gpsCoordinates.longitude;
              console.log('[DocumentVerification] Using GPS coordinates from parent:', gpsLatitude, gpsLongitude);
            } else {
              // Fallback: try to get GPS location if not provided by parent
              try {
                const gpsResult = await kycApiService.getUserLocation();
                if (gpsResult.gps) {
                  gpsLatitude = gpsResult.gps.latitude;
                  gpsLongitude = gpsResult.gps.longitude;
                }
              } catch (gpsErr) {
                console.warn('GPS location error, will use IP-based:', gpsErr);
              }
            }
            
            // Compare location with document address
            // Backend will log its decision during this call
            const locResult = await kycApiService.compareLocationWithAddress(
              sessionId,
              gpsLatitude,
              gpsLongitude,
              extractedAddress,
              locationRadiusKm
            );
            
            // Log location check result display (after backend decision)
            uiEventLoggerService.logLocationCheck(locResult.verified || false, {
              latitude: gpsLatitude,
              longitude: gpsLongitude,
              distanceKm: locResult.distanceKm,
              message: locResult.message,
            });
            
            setStep('verified');
            
            // Set completion instruction
            if (onStepInstruction) {
              await onStepInstruction('Thanks for waiting.', true, true);
              audioPlayedRef.current.add('verified');
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Include GPS coordinates in the result for storage
            const locationResultWithGps = {
              ...locResult,
              gpsLatitude,
              gpsLongitude,
            };
            onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults, locationResultWithGps);
            
          } catch (locErr: any) {
            console.error('Location verification error:', locErr);
            // Log location verification error but don't block the flow
            uiEventLoggerService.logError('location_verification_error', locErr.message || 'Location verification failed');
            
            // Continue with document verification even if location fails
            setStep('verified');
            if (onStepInstruction) {
              await onStepInstruction('Thanks for waiting.', true, true);
              audioPlayedRef.current.add('verified');
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults, undefined);
          }
        } else {
          // No location verification needed
          setStep('verified');
          
          if (onStepInstruction) {
            await onStepInstruction('Thanks for waiting.', true, true);
            audioPlayedRef.current.add('verified');
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults, undefined);
        }
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
      {(step === 'processing' || step === 'verifying-location') && (
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
