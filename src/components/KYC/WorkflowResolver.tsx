import React, { useState, useEffect } from 'react';
import EKYCWorkflow from './EKYCWorkflow';
import KYCForm from './KYCForm';

interface WorkflowResolverProps {
  configId: string;
}

interface WorkflowConfiguration {
  configId: string;
  name: string;
  steps: {
    locationCapture: boolean;
    documentOCR: boolean;
    secureVerification: boolean;
    form: boolean;
    locationRadiusKm?: number;
  };
  formId?: string;
  isActive: boolean;
}

const WorkflowResolver: React.FC<WorkflowResolverProps> = ({ configId }) => {
  const [config, setConfig] = useState<WorkflowConfiguration | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [started, setStarted] = useState<boolean>(false);
  const [userData, setUserData] = useState<{
    userId: string;
    email?: string;
    mobileNumber: string;
    sessionId: string;
  } | null>(null);
  const [completed, setCompleted] = useState<boolean>(false);
  const [completedSessionId, setCompletedSessionId] = useState<string>('');

  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  useEffect(() => {
    fetchConfiguration();
  }, [configId]);

  const fetchConfiguration = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/workflow/${configId}`);
      const data = await response.json();

      if (data.success && data.configuration) {
        if (!data.configuration.isActive) {
          setError('This workflow configuration is no longer active.');
        } else {
          setConfig(data.configuration);
        }
      } else {
        setError('Workflow configuration not found. Please check the link and try again.');
      }
    } catch (err: any) {
      console.error('Error fetching workflow configuration:', err);
      setError('Failed to load workflow configuration. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartKYC = (formData: { mobileNumber: string; otp: string; sessionId: string; userId: string; email?: string }) => {
    setUserData({
      userId: formData.userId,
      email: formData.email,
      mobileNumber: formData.mobileNumber,
      sessionId: formData.sessionId,
    });
    setStarted(true);
  };

  const handleWorkflowComplete = (sessionId: string) => {
    setCompletedSessionId(sessionId);
    setCompleted(true);
  };

  const handleStartNew = () => {
    setUserData(null);
    setStarted(false);
    setCompleted(false);
    setCompletedSessionId('');
  };

  if (loading) {
    return (
      <div className="workflow-resolver-loading">
        <div className="loading-container">
          <div className="spinner"></div>
          <h2>Loading KYC Workflow...</h2>
          <p>Please wait while we prepare your verification process.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="workflow-resolver-error">
        <div className="error-container">
          <div className="error-icon">⚠️</div>
          <h2>Unable to Load Workflow</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => window.location.href = '/'}>
            Go to Homepage
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="workflow-resolver-error">
        <div className="error-container">
          <div className="error-icon">❌</div>
          <h2>Configuration Not Found</h2>
          <p>The requested workflow configuration could not be found.</p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="completion-page">
        <div className="completion-container">
          <div className="success-icon-large">✓</div>
          <h1>KYC Verification Complete!</h1>
          <p>Your identity has been successfully verified.</p>
          <p className="session-id">Session ID: {completedSessionId}</p>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="workflow-start-page">
        <KYCForm onStartKYC={handleStartKYC} workflowConfigId={configId} />
      </div>
    );
  }

  return (
    <EKYCWorkflow
      sessionId={userData!.sessionId}
      userId={userData!.userId}
      email={userData!.email}
      mobileNumber={userData!.mobileNumber}
      onComplete={handleWorkflowComplete}
      onCancel={handleStartNew}
      workflowConfigId={configId}
      workflowSteps={config.steps}
      formFieldSetId={config.formId}
    />
  );
};

export default WorkflowResolver;

