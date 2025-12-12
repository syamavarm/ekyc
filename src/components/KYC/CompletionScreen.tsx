import React, { useState, useEffect, useRef } from 'react';
import kycApiService, { RequiredSteps } from '../../services/kycApiService';
import { playVoice, isAudioReady } from '../../services/audioService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface CompletionScreenProps {
  sessionId: string;
}

interface CompletionResult {
  requiredSteps: RequiredSteps;
}

const CompletionScreen: React.FC<CompletionScreenProps> = ({
  sessionId,
}) => {
  const [completionResult, setCompletionResult] = useState<CompletionResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const audioPlayedRef = useRef(false);

  useEffect(() => {
    completeAndLoadResults();
  }, []);

  // Play completion audio when results are loaded
  useEffect(() => {
    if (!loadingStatus && !audioPlayedRef.current) {
      audioPlayedRef.current = true;
      if (isAudioReady()) {
        playVoice('Thank you for completing the verification process. Your submission has been received and will be reviewed.', false);
      }
    }
  }, [loadingStatus]);

  // Call the complete API - results are stored on server for admin review
  const completeAndLoadResults = async () => {
    try {
      setLoadingStatus(true);
      const result = await kycApiService.completeKYC(sessionId);
      console.log('[CompletionScreen] Complete result:', result);
      setCompletionResult({
        requiredSteps: result.requiredSteps,
      });
      
      // Log session completion for timeline replay
      uiEventLoggerService.logSessionCompleted(result.success, result.verificationResults);
    } catch (err: any) {
      console.error('Failed to complete KYC:', err);
      
      // Log session failure for timeline replay
      uiEventLoggerService.logSessionCompleted(false, { error: err.message });
      
      // Even if there's an error, show completion screen with defaults
      setCompletionResult({ 
        requiredSteps: {
          locationCapture: false,
          documentOCR: false,
          secureVerification: false,
          form: false,
        }
      });
    } finally {
      setLoadingStatus(false);
    }
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

  const required = completionResult?.requiredSteps;

  // Helper to render completed step (neutral - no pass/fail)
  const renderCompletedStep = (isRequired: boolean, label: string) => {
    if (!isRequired) return null;
    
    return (
      <div className="verification-item completed">
        <span className="icon">✓</span>
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div className="completion-screen">
      <div className="completion-card">
        <div className="completion-header">
          <span className="success-icon-inline">✓</span>
          <h2>Verification Process Complete</h2>
        </div>
        <p className="completion-message">
          Thank you for completing the verification process. Your submission has been received and will be reviewed.
        </p>

        <div className="verification-summary">
          <h3>Steps Completed</h3>
          <div className="verification-items">
            {renderCompletedStep(required?.locationCapture ?? false, 'Location Capture')}
            {renderCompletedStep(required?.documentOCR ?? false, 'Document Verification')}
            {renderCompletedStep(required?.secureVerification ?? false, 'Face Verification')}
            {renderCompletedStep(required?.form ?? false, 'Additional Data Collection')}
          </div>
        </div>

        <div className="session-details">
          <p><strong>Reference ID:</strong> {sessionId}</p>
        </div>
      </div>
    </div>
  );
};

export default CompletionScreen;

