import React, { useState, useEffect } from 'react';
import kycApiService, { RequiredSteps } from '../../services/kycApiService';

interface CompletionScreenProps {
  sessionId: string;
  onComplete: () => void;
  loading: boolean;
}

interface CompletionResult {
  success: boolean;
  verificationResults: {
    documentVerified: boolean;
    faceVerified: boolean;
    livenessVerified: boolean;
    locationVerified: boolean;
    questionnaireVerified?: boolean;
    overallVerified: boolean;
  };
  requiredSteps: RequiredSteps;
  status: string;
}

const CompletionScreen: React.FC<CompletionScreenProps> = ({
  sessionId,
  onComplete,
  loading,
}) => {
  const [completionResult, setCompletionResult] = useState<CompletionResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    completeAndLoadResults();
  }, []);

  // Call the complete API to get verification results based on workflow config
  const completeAndLoadResults = async () => {
    try {
      setLoadingStatus(true);
      const result = await kycApiService.completeKYC(sessionId);
      console.log('[CompletionScreen] Complete result:', result);
      setCompletionResult({
        success: result.success,
        verificationResults: result.verificationResults,
        requiredSteps: result.requiredSteps,
        status: result.status,
      });
    } catch (err: any) {
      console.error('Failed to complete KYC:', err);
      setError(err.message || 'Failed to complete KYC verification');
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleDownloadReport = (format: 'pdf' | 'txt') => {
    kycApiService.downloadReport(sessionId, format);
  };

  if (loadingStatus) {
    return (
      <div className="completion-screen">
        <div className="status-message">
          <div className="spinner"></div>
          <p>Finalizing verification...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="completion-screen">
        <div className="status-message error">
          <span className="icon">⚠️</span>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const allVerified = completionResult?.verificationResults?.overallVerified;
  const results = completionResult?.verificationResults;
  const required = completionResult?.requiredSteps;

  // Helper to render verification item only if it was required
  const renderVerificationItem = (
    isRequired: boolean,
    isVerified: boolean,
    label: string
  ) => {
    if (!isRequired) return null;
    
    return (
      <div className={`verification-item ${isVerified ? 'pass' : 'fail'}`}>
        <span className="icon">{isVerified ? '✓' : '✗'}</span>
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div className="completion-screen">
      <div className="completion-card">
        {allVerified ? (
          <>
            <div className="success-icon">✓</div>
            <h2>KYC Verification Complete!</h2>
            <p className="success-message">
              Your identity has been successfully verified.
            </p>
          </>
        ) : (
          <>
            <div className="warning-icon">⚠️</div>
            <h2>KYC Verification Incomplete</h2>
            <p className="warning-message">
              Some verification steps did not pass. Please review the results below.
            </p>
          </>
        )}

        <div className="verification-summary">
          <h3>Verification Results</h3>
          <div className="verification-items">
            {/* Only show steps that were required by the workflow config */}
            {renderVerificationItem(
              required?.locationCapture ?? false,
              results?.locationVerified ?? false,
              'Location Verification'
            )}
            {renderVerificationItem(
              required?.documentOCR ?? false,
              results?.documentVerified ?? false,
              'Document Verification'
            )}
            {renderVerificationItem(
              required?.faceMatch ?? false,
              results?.faceVerified ?? false,
              'Face Verification'
            )}
            {renderVerificationItem(
              required?.livenessCheck ?? false,
              results?.livenessVerified ?? false,
              'Liveness Check'
            )}
            {renderVerificationItem(
              required?.questionnaire ?? false,
              results?.questionnaireVerified ?? false,
              'Questionnaire'
            )}
          </div>
        </div>

        <div className="session-details">
          <h3>Session Details</h3>
          <p><strong>Session ID:</strong> {sessionId}</p>
          <p><strong>Status:</strong> {completionResult?.status}</p>
        </div>

        <div className="completion-actions">
          <button
            className="btn-secondary"
            onClick={() => handleDownloadReport('pdf')}
          >
            📄 Download PDF Report
          </button>
          <button
            className="btn-secondary"
            onClick={() => handleDownloadReport('txt')}
          >
            📝 Download Text Report
          </button>
          <button
            className="btn-primary"
            onClick={onComplete}
            disabled={loading}
          >
            {loading ? 'Finalizing...' : 'Finish'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompletionScreen;

