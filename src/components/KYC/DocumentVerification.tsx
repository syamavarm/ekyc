import React, { useState, useRef } from 'react';
import kycApiService from '../../services/kycApiService';

interface DocumentVerificationProps {
  sessionId: string;
  videoStream: MediaStream | null;
  onDocumentVerified: (documentId: string, ocrData: any) => void;
  loading: boolean;
}

const DocumentVerification: React.FC<DocumentVerificationProps> = ({
  sessionId,
  videoStream,
  onDocumentVerified,
  loading,
}) => {
  const [step, setStep] = useState<'capture' | 'upload' | 'processing' | 'verified'>('capture');
  const [documentType] = useState<string>('auto'); // Auto-detect document type via OCR
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [ocrResults, setOcrResults] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Assign stream to video element
  React.useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  const handleCaptureFromVideo = () => {
    if (!localVideoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = localVideoRef.current.videoWidth;
    canvas.height = localVideoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(localVideoRef.current, 0, 0);
    
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'document.jpg', { type: 'image/jpeg' });
        const imageUrl = URL.createObjectURL(blob);
        setCapturedImage(imageUrl);
        setCapturedFile(file);
        setStep('upload');
      }
    }, 'image/jpeg', 0.95);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setCapturedImage(imageUrl);
      setCapturedFile(file);
      setStep('upload');
    }
  };

  const handleUpload = async () => {
    if (!capturedFile) return;

    setStep('processing');
    setError('');

    try {
      // Upload document
      const uploadResponse = await kycApiService.uploadDocument(
        sessionId,
        documentType,
        capturedFile
      );

      // Run OCR
      const ocrResponse = await kycApiService.runOCR(sessionId, uploadResponse.documentId);

      if (ocrResponse.isValid) {
        setOcrResults(ocrResponse.ocrResults);
        setStep('verified');
        setTimeout(() => {
          onDocumentVerified(uploadResponse.documentId, ocrResponse.ocrResults);
        }, 2000);
      } else {
        setError(ocrResponse.validationErrors?.join(', ') || 'Document validation failed');
        setStep('upload');
      }
    } catch (err: any) {
      console.error('Document verification error:', err);
      setError(err.message || 'Failed to verify document');
      setStep('upload');
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedFile(null);
    setStep('capture');
  };

  return (
    <div className="document-verification">
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
              border: '3px solid #667eea'
            }}
          />
          <p className="video-label">Live Camera</p>
        </div>
      )}
      
      <div className="document-card">
        <h2>📄 Document Verification</h2>

        {step === 'capture' && (
          <>
            <p>Hold your ID document (passport, driver's license, or national ID) in front of the camera.</p>
            <div className="capture-instructions">
              <ul>
                <li>✓ Ensure good lighting</li>
                <li>✓ Keep document flat and visible</li>
                <li>✓ Avoid glare and shadows</li>
              </ul>
            </div>
            <div className="document-actions">
              <button className="btn-primary" onClick={handleCaptureFromVideo}>
                📸 Capture Document
              </button>
              <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
                📁 Upload File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          </>
        )}

        {step === 'upload' && capturedImage && (
          <>
            <p>Review your document image:</p>
            <div className="document-preview">
              <img src={capturedImage} alt="Document" />
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="document-actions">
              <button className="btn-secondary" onClick={handleRetake}>
                Retake
              </button>
              <button className="btn-primary" onClick={handleUpload} disabled={loading}>
                {loading ? 'Processing...' : 'Verify Document'}
              </button>
            </div>
          </>
        )}

        {step === 'processing' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>Verifying document...</p>
            <small>Extracting information and validating...</small>
          </div>
        )}

        {step === 'verified' && ocrResults && (
          <div className="status-message success">
            <span className="icon">✓</span>
            <p>Document verified successfully!</p>
            <div className="ocr-results">
              <h3>Extracted Information:</h3>
              <p><strong>Name:</strong> {ocrResults.extractedData.fullName}</p>
              <p><strong>Date of Birth:</strong> {ocrResults.extractedData.dateOfBirth}</p>
              <p><strong>Document Number:</strong> {ocrResults.extractedData.documentNumber}</p>
              <p><strong>Confidence:</strong> {(ocrResults.confidence * 100).toFixed(1)}%</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentVerification;

