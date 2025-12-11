import React, { useState, useEffect, useCallback } from 'react';
import './AdminWorkflowConfig.css';
import SessionReplayPage from './SessionReplayPage';

interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  secureVerification: boolean;
  questionnaire: boolean;
  locationRadiusKm?: number;
  enableSessionRecording?: boolean;
}

interface QuestionSet {
  id: string;
  name: string;
  description: string;
  questionCount: number;
}

interface WorkflowConfiguration {
  configId: string;
  name: string;
  steps: WorkflowSteps;
  formId?: string;
  createdAt: string;
  isActive: boolean;
}

interface OCRResults {
  extractedData: {
    fullName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
    nationality?: string;
    address?: string;
    [key: string]: any;
  };
  confidence: number;
}

interface VerificationResults {
  documentVerified: boolean;
  secureVerified: boolean;
  locationVerified: boolean;
  questionnaireVerified?: boolean;
  overallVerified: boolean;
}

interface KYCSession {
  sessionId: string;
  userId: string;
  mobileNumber?: string;
  email?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  workflowConfigId?: string;
  document?: {
    documentType: string;
    ocrResults?: OCRResults;
    isValid: boolean;
  };
  secureVerification?: {
    faceMatch: {
      matchScore: number;
      isMatch: boolean;
      confidence: number;
    };
    liveness: {
      overallResult: boolean;
      confidenceScore: number;
    };
    faceConsistency: {
      isConsistent: boolean;
      consistencyScore: number;
    };
    overallResult: boolean;
  };
  verificationResults: VerificationResults;
  overallScore?: number;
}

type TabType = 'configurations' | 'sessions';

const AdminWorkflowConfig: React.FC = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('configurations');
  
  // Session replay state
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<WorkflowConfiguration | null>(null);
  
  // Form state for modal
  const [workflowName, setWorkflowName] = useState<string>('');
  const [steps, setSteps] = useState<WorkflowSteps>({
    locationCapture: true,
    documentOCR: true,
    secureVerification: true,
    questionnaire: true,
    locationRadiusKm: undefined,
    enableSessionRecording: true, // Default enabled for video-KYC
  });
  const [selectedForm, setSelectedForm] = useState<string>('');
  
  // Data state
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [existingConfigs, setExistingConfigs] = useState<WorkflowConfiguration[]>([]);
  const [sessions, setSessions] = useState<KYCSession[]>([]);
  
  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  // Fetch data on mount
  useEffect(() => {
    fetchQuestionSets();
    fetchExistingConfigs();
    fetchSessions();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/questionnaire/sets`);
      const data = await response.json();
      
      if (data.success && data.questionSets) {
        setQuestionSets(data.questionSets);
        const basicSet = data.questionSets.find((qs: QuestionSet) => qs.id === 'basic');
        if (basicSet) {
          setSelectedForm(basicSet.id);
        }
      }
    } catch (err) {
      console.error('Error fetching question sets:', err);
    }
  };

  const fetchExistingConfigs = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/admin/workflows`);
      const data = await response.json();
      
      if (data.success && data.configurations) {
        setExistingConfigs(data.configurations);
      }
    } catch (err) {
      console.error('Error fetching existing configs:', err);
    }
  };

  const fetchSessions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/sessions`);
      const data = await response.json();
      
      if (data.success && data.sessions) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const handleStepToggle = (stepName: keyof WorkflowSteps) => {
    setSteps(prev => ({
      ...prev,
      [stepName]: !prev[stepName],
    }));
  };

  const resetModalForm = useCallback(() => {
    setWorkflowName('');
    setSteps({
      locationCapture: true,
      documentOCR: true,
      secureVerification: true,
      questionnaire: true,
      locationRadiusKm: undefined,
      enableSessionRecording: true,
    });
    setSelectedForm(questionSets.find(qs => qs.id === 'basic')?.id || '');
    setEditingConfig(null);
  }, [questionSets]);

  const openCreateModal = () => {
    resetModalForm();
    setIsModalOpen(true);
  };

  const openEditModal = (config: WorkflowConfiguration) => {
    setEditingConfig(config);
    setWorkflowName(config.name);
    setSteps(config.steps);
    setSelectedForm(config.formId || '');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetModalForm();
    setError('');
    setSuccess('');
  };

  const validateConfiguration = (): boolean => {
    if (!workflowName.trim()) {
      setError('Workflow name is required');
      return false;
    }

    const hasEnabledStep = Object.values(steps).some(step => step === true);
    if (!hasEnabledStep) {
      setError('At least one workflow step must be enabled');
      return false;
    }

    return true;
  };

  const handleSaveConfiguration = async () => {
    setError('');
    setSuccess('');

    if (!validateConfiguration()) {
      return;
    }

    setIsLoading(true);

    try {
      if (editingConfig) {
        // Update existing configuration
        const response = await fetch(`${API_BASE_URL}/admin/workflow/${editingConfig.configId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: workflowName,
            steps,
            formId: steps.questionnaire ? selectedForm : undefined,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setSuccess('Configuration updated successfully!');
          await fetchExistingConfigs();
          setTimeout(closeModal, 1500);
        } else {
          setError(data.message || 'Failed to update configuration');
        }
      } else {
        // Create new configuration
        const response = await fetch(`${API_BASE_URL}/admin/workflow/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: workflowName,
            steps,
            formId: steps.questionnaire ? selectedForm : undefined,
            createdBy: 'admin',
          }),
        });

        const data = await response.json();

        if (data.success) {
          setSuccess('Configuration created successfully!');
          await fetchExistingConfigs();
          
          // Copy link to clipboard
          if (data.linkUrl) {
            navigator.clipboard.writeText(data.linkUrl);
            setSuccess('Configuration created! Link copied to clipboard.');
          }
          
          setTimeout(closeModal, 1500);
        } else {
          setError(data.message || 'Failed to create configuration');
        }
      }
    } catch (err: any) {
      console.error('Error saving configuration:', err);
      setError(err.message || 'Failed to save configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (config: WorkflowConfiguration) => {
    try {
      const endpoint = config.isActive ? 'deactivate' : 'activate';
      const response = await fetch(`${API_BASE_URL}/admin/workflow/${config.configId}/${endpoint}`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        await fetchExistingConfigs();
        setSuccess(`Configuration ${config.isActive ? 'deactivated' : 'activated'} successfully!`);
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.message || 'Failed to update configuration');
      }
    } catch (err: any) {
      console.error('Error toggling configuration:', err);
      setError(err.message || 'Failed to update configuration');
    }
  };

  const handleDeleteConfig = async (config: WorkflowConfiguration) => {
    if (!window.confirm(`Are you sure you want to delete "${config.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/workflow/${config.configId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        await fetchExistingConfigs();
        setSuccess('Configuration deleted successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.message || 'Failed to delete configuration');
      }
    } catch (err: any) {
      console.error('Error deleting configuration:', err);
      setError(err.message || 'Failed to delete configuration');
    }
  };

  const handleCopyLink = (configId: string) => {
    const link = `${window.location.origin}/kyc/${configId}`;
    navigator.clipboard.writeText(link);
    setSuccess('Link copied to clipboard!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleDownloadReport = async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/session/${sessionId}/summary?format=txt`);
      
      if (!response.ok) {
        throw new Error('Failed to download report');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kyc_report_${sessionId}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setSuccess('Report downloaded successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error downloading report:', err);
      setError(err.message || 'Failed to download report');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'status-badge success';
      case 'failed':
        return 'status-badge danger';
      case 'expired':
        return 'status-badge warning';
      default:
        return 'status-badge info';
    }
  };

  const renderConfigurationForm = () => (
    <div className="modal-form">
      <div className="form-section">
        <h3>Workflow Details</h3>
        
        <div className="form-group">
          <label htmlFor="workflowName">
            Workflow Name <span className="required">*</span>
          </label>
          <input
            id="workflowName"
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            placeholder="e.g., Standard KYC, Quick Verification"
            className="form-input"
          />
        </div>
      </div>

      <div className="form-section">
        <h3>Workflow Steps</h3>
        <div className="steps-grid-modal">
          <div className="step-item">
            <div className="step-info-compact">
              <span className="step-icon-small">📄</span>
              <span>Document OCR</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={steps.documentOCR}
                onChange={() => handleStepToggle('documentOCR')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="step-item">
            <div className="step-info-compact">
              <span className="step-icon-small">📍</span>
              <span>Location Capture</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={steps.locationCapture}
                onChange={() => handleStepToggle('locationCapture')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {steps.locationCapture && steps.documentOCR && (
            <div className="step-item full-width">
              <label className="config-label">
                Location Radius (km)
              </label>
              <div className="radius-input-group">
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={steps.locationRadiusKm || ''}
                  placeholder="Not set"
                  onChange={(e) => {
                    const value = e.target.value;
                    setSteps(prev => ({
                      ...prev,
                      locationRadiusKm: value === '' ? undefined : Math.max(0, Math.min(500, parseInt(value) || 0))
                    }));
                  }}
                  className="radius-input"
                />
                <span className="radius-unit">km</span>
              </div>
              <p className="config-hint">
                {steps.locationRadiusKm && steps.locationRadiusKm > 0
                  ? `User must be within ${steps.locationRadiusKm} km of document address`
                  : 'No radius: Country comparison only'}
              </p>
            </div>
          )}

          <div className="step-item">
            <div className="step-info-compact">
              <span className="step-icon-small">🛡️</span>
              <span>Face & Liveness Anti-Spoofing</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={steps.secureVerification}
                onChange={() => handleStepToggle('secureVerification')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="step-item">
            <div className="step-info-compact">
              <span className="step-icon-small">❓</span>
              <span>Questionnaire</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={steps.questionnaire}
                onChange={() => handleStepToggle('questionnaire')}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="step-item">
            <div className="step-info-compact">
              <span className="step-icon-small">🎬</span>
              <span>Session Recording</span>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={steps.enableSessionRecording !== false}
                onChange={() => setSteps(prev => ({
                  ...prev,
                  enableSessionRecording: !prev.enableSessionRecording
                }))}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      {steps.questionnaire && (
        <div className="form-section">
          <h3>Question Set</h3>
          <div className="form-group">
            <select
              value={selectedForm}
              onChange={(e) => setSelectedForm(e.target.value)}
              className="form-select"
            >
              <option value="">Select a question set...</option>
              {questionSets.map((qs) => (
                <option key={qs.id} value={qs.id}>
                  {qs.name} ({qs.questionCount} questions)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <span className="alert-icon">✓</span>
          {success}
        </div>
      )}
    </div>
  );

  const renderConfigurationsTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h2>Workflow Configurations</h2>
        <button className="btn-primary" onClick={openCreateModal}>
          + Create Configuration
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Steps</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {existingConfigs.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-row">
                  No configurations yet. Create your first one!
                </td>
              </tr>
            ) : (
              existingConfigs.map((config) => (
                <tr key={config.configId} className={!config.isActive ? 'inactive-row' : ''}>
                  <td className="name-cell">
                    <strong>{config.name}</strong>
                    <span className="config-id">ID: {config.configId.slice(0, 8)}...</span>
                  </td>
                  <td className="steps-cell">
                    <div className="step-badges">
                      {config.steps.documentOCR && <span className="step-badge">OCR</span>}
                      {config.steps.locationCapture && <span className="step-badge">Location</span>}
                      {config.steps.secureVerification && <span className="step-badge">Face+Live</span>}
                      {config.steps.questionnaire && <span className="step-badge">Quiz</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${config.isActive ? 'active' : 'inactive'}`}>
                      {config.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="date-cell">
                    {new Date(config.createdAt).toLocaleDateString()}
                  </td>
                  <td className="actions-cell">
                    <button
                      className="btn-icon btn-edit"
                      onClick={() => openEditModal(config)}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn-icon btn-copy"
                      onClick={() => handleCopyLink(config.configId)}
                      title="Copy Link"
                    >
                      🔗
                    </button>
                    <button
                      className={`btn-icon ${config.isActive ? 'btn-deactivate' : 'btn-activate'}`}
                      onClick={() => handleToggleActive(config)}
                      title={config.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {config.isActive ? '⏸️' : '▶️'}
                    </button>
                    <button
                      className="btn-icon btn-delete"
                      onClick={() => handleDeleteConfig(config)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSessionsTab = () => (
    <div className="tab-content">
      <div className="tab-header">
        <h2>KYC Sessions</h2>
        <button className="btn-secondary" onClick={fetchSessions}>
          ↻ Refresh
        </button>
      </div>

      <div className="table-container sessions-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Mobile Number</th>
              <th>OCR Details</th>
              <th>Checks & Scores</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
                  No sessions found.
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.sessionId}>
                  <td className="session-id-cell">
                    <code>{session.sessionId.slice(0, 8)}...</code>
                    <button
                      className="btn-mini"
                      onClick={() => {
                        navigator.clipboard.writeText(session.sessionId);
                        setSuccess('Session ID copied!');
                        setTimeout(() => setSuccess(''), 2000);
                      }}
                      title="Copy full ID"
                    >
                      📋
                    </button>
                  </td>
                  <td>
                    {session.mobileNumber || <span className="muted">N/A</span>}
                  </td>
                  <td className="ocr-cell">
                    {session.document?.ocrResults?.extractedData ? (
                      <div className="ocr-details">
                        <div className="ocr-row">
                          <span className="ocr-label">Name:</span>
                          <span>{session.document.ocrResults.extractedData.fullName || 'N/A'}</span>
                        </div>
                        <div className="ocr-row">
                          <span className="ocr-label">DOB:</span>
                          <span>{session.document.ocrResults.extractedData.dateOfBirth || 'N/A'}</span>
                        </div>
                        {session.document.ocrResults.extractedData.address && (
                          <div className="ocr-row">
                            <span className="ocr-label">Address:</span>
                            <span>{session.document.ocrResults.extractedData.address.replace(/\n/g, ', ')}</span>
                          </div>
                        )}
                        <div className="ocr-row">
                          <span className="ocr-label">Doc #:</span>
                          <span>{session.document.ocrResults.extractedData.documentNumber || 'N/A'}</span>
                        </div>
                        <div className="ocr-row">
                          <span className="ocr-label">Confidence:</span>
                          <span>{((session.document.ocrResults.confidence || 0) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    ) : (
                      <span className="muted">No OCR data</span>
                    )}
                  </td>
                  <td className="checks-cell">
                    <div className="checks-grid">
                      <div className={`check-item ${session.verificationResults.documentVerified ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{session.verificationResults.documentVerified ? '✓' : '✗'}</span>
                        <span>Document</span>
                      </div>
                      {/* Face Match */}
                      {session.secureVerification && (
                        <div className={`check-item ${session.secureVerification.faceMatch.isMatch ? 'passed' : 'failed'}`}>
                          <span className="check-icon">
                            {session.secureVerification.faceMatch.isMatch ? '✓' : '✗'}
                          </span>
                          <span>Face Match ({(session.secureVerification.faceMatch.matchScore * 100).toFixed(0)}%)</span>
                        </div>
                      )}
                      {/* Liveness */}
                      {session.secureVerification && (
                        <div className={`check-item ${session.secureVerification.liveness.overallResult ? 'passed' : 'failed'}`}>
                          <span className="check-icon">
                            {session.secureVerification.liveness.overallResult ? '✓' : '✗'}
                          </span>
                          <span>Liveness ({(session.secureVerification.liveness.confidenceScore * 100).toFixed(0)}%)</span>
                        </div>
                      )}
                      {/* Face Consistency */}
                      {session.secureVerification && (
                        <div className={`check-item ${session.secureVerification.faceConsistency.isConsistent ? 'passed' : 'failed'}`}>
                          <span className="check-icon">
                            {session.secureVerification.faceConsistency.isConsistent ? '✓' : '✗'}
                          </span>
                          <span>Consistency ({(session.secureVerification.faceConsistency.consistencyScore * 100).toFixed(0)}%)</span>
                        </div>
                      )}
                      <div className={`check-item ${session.verificationResults.locationVerified ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{session.verificationResults.locationVerified ? '✓' : '✗'}</span>
                        <span>Location</span>
                      </div>
                      {session.verificationResults.questionnaireVerified !== undefined && (
                        <div className={`check-item ${session.verificationResults.questionnaireVerified ? 'passed' : 'failed'}`}>
                          <span className="check-icon">{session.verificationResults.questionnaireVerified ? '✓' : '✗'}</span>
                          <span>Quiz</span>
                        </div>
                      )}
                    </div>
                    {session.overallScore !== undefined && (
                      <div className="overall-score">
                        Overall: <strong>{(session.overallScore * 100).toFixed(0)}%</strong>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={getStatusBadgeClass(session.status)}>
                      {session.status}
                    </span>
                  </td>
                  <td className="date-cell">
                    {formatDate(session.createdAt)}
                  </td>
                  <td className="actions-cell">
                    <button
                      className="btn-icon btn-replay"
                      onClick={() => setReplaySessionId(session.sessionId)}
                      title="View Replay"
                    >
                      🎬
                    </button>
                    <button
                      className="btn-icon btn-download"
                      onClick={() => handleDownloadReport(session.sessionId)}
                      title="Download Report"
                    >
                      📥
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // If viewing session replay, show the replay page
  if (replaySessionId) {
    return (
      <SessionReplayPage
        sessionId={replaySessionId}
        onBack={() => setReplaySessionId(null)}
      />
    );
  }

  return (
    <div className="admin-workflow-config">
      <div className="admin-header">
        <h1>🔧 KYC Admin Dashboard</h1>
        <p>Manage workflow configurations and monitor KYC sessions</p>
      </div>

      {/* Global alerts */}
      {success && !isModalOpen && (
        <div className="global-alert alert-success">
          <span className="alert-icon">✓</span>
          {success}
        </div>
      )}
      {error && !isModalOpen && (
        <div className="global-alert alert-error">
          <span className="alert-icon">⚠️</span>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="admin-container">
        <div className="tabs-container">
          <button
            className={`tab-button ${activeTab === 'configurations' ? 'active' : ''}`}
            onClick={() => setActiveTab('configurations')}
          >
            <span className="tab-icon">⚙️</span>
            Workflow Configurations
          </button>
          <button
            className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <span className="tab-icon">📋</span>
            Sessions
          </button>
        </div>

        <div className="tab-panel">
          {activeTab === 'configurations' && renderConfigurationsTab()}
          {activeTab === 'sessions' && renderSessionsTab()}
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingConfig ? 'Edit Configuration' : 'Create New Configuration'}</h2>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {renderConfigurationForm()}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModal} disabled={isLoading}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSaveConfiguration}
                disabled={isLoading}
              >
                {isLoading ? 'Saving...' : (editingConfig ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWorkflowConfig;
