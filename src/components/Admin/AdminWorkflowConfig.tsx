import React, { useState, useEffect } from 'react';
import './AdminWorkflowConfig.css';

interface WorkflowSteps {
  locationCapture: boolean;
  documentOCR: boolean;
  faceMatch: boolean;
  livenessCheck: boolean;
  questionnaire: boolean;
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
  description?: string;
  steps: WorkflowSteps;
  formId?: string;
  createdAt: string;
  isActive: boolean;
}

const AdminWorkflowConfig: React.FC = () => {
  const [workflowName, setWorkflowName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [steps, setSteps] = useState<WorkflowSteps>({
    locationCapture: true,
    documentOCR: true,
    faceMatch: true,
    livenessCheck: true,
    questionnaire: true,
  });
  const [selectedForm, setSelectedForm] = useState<string>('');
  const [questionSets, setQuestionSets] = useState<QuestionSet[]>([]);
  const [generatedLink, setGeneratedLink] = useState<string>('');
  const [configId, setConfigId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [existingConfigs, setExistingConfigs] = useState<WorkflowConfiguration[]>([]);
  const [showConfigList, setShowConfigList] = useState<boolean>(false);

  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  // Load question sets on mount
  useEffect(() => {
    fetchQuestionSets();
    fetchExistingConfigs();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/kyc/questionnaire/sets`);
      const data = await response.json();
      
      if (data.success && data.questionSets) {
        setQuestionSets(data.questionSets);
        // Set default to 'basic' if available
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

  const handleStepToggle = (stepName: keyof WorkflowSteps) => {
    setSteps(prev => ({
      ...prev,
      [stepName]: !prev[stepName],
    }));
  };

  const validateConfiguration = (): boolean => {
    if (!workflowName.trim()) {
      setError('Workflow name is required');
      return false;
    }

    // Check if at least one step is enabled
    const hasEnabledStep = Object.values(steps).some(step => step === true);
    if (!hasEnabledStep) {
      setError('At least one workflow step must be enabled');
      return false;
    }

    return true;
  };

  const handleGenerateLink = async () => {
    setError('');
    setSuccess('');
    setGeneratedLink('');
    setConfigId('');

    if (!validateConfiguration()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/workflow/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workflowName,
          description: description || undefined,
          steps,
          formId: steps.questionnaire ? selectedForm : undefined,
          createdBy: 'admin', // In production, use actual admin user ID
        }),
      });

      const data = await response.json();

      if (data.success) {
        setGeneratedLink(data.linkUrl);
        setConfigId(data.configId);
        setSuccess('Workflow configuration created successfully!');
        
        // Refresh configs list
        await fetchExistingConfigs();
      } else {
        setError(data.message || 'Failed to create workflow configuration');
      }
    } catch (err: any) {
      console.error('Error creating workflow configuration:', err);
      setError(err.message || 'Failed to create workflow configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setSuccess('Link copied to clipboard!');
    }
  };

  const handleReset = () => {
    setWorkflowName('');
    setDescription('');
    setSteps({
      locationCapture: true,
      documentOCR: true,
      faceMatch: true,
      livenessCheck: true,
      questionnaire: true,
    });
    setSelectedForm(questionSets.find(qs => qs.id === 'basic')?.id || '');
    setGeneratedLink('');
    setConfigId('');
    setError('');
    setSuccess('');
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
      } else {
        setError(data.message || 'Failed to delete configuration');
      }
    } catch (err: any) {
      console.error('Error deleting configuration:', err);
      setError(err.message || 'Failed to delete configuration');
    }
  };

  return (
    <div className="admin-workflow-config">
      <div className="admin-header">
        <h1>🔧 KYC Workflow Configuration</h1>
        <p>Configure and generate custom KYC workflow links</p>
      </div>

      <div className="admin-container">
        <div className="config-form">
          {/* Workflow Name and Description */}
          <div className="form-section">
            <h2>Workflow Details</h2>
            
            <div className="form-group">
              <label htmlFor="workflowName">
                Workflow Name <span className="required">*</span>
              </label>
              <input
                id="workflowName"
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="e.g., Standard KYC, Quick Verification, Enhanced KYC"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="description">Description (Optional)</label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this workflow..."
                className="form-textarea"
                rows={3}
              />
            </div>
          </div>

          {/* Workflow Steps Configuration */}
          <div className="form-section">
            <h2>Select Workflow Steps</h2>
            <p className="section-subtitle">Choose which steps users must complete</p>

            <div className="steps-grid">
              <div className="step-card">
                <div className="step-header">
                  <div className="step-icon">📍</div>
                  <div className="step-info">
                    <h3>Location Capture</h3>
                    <p>Capture user's GPS and IP-based location</p>
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
              </div>

              <div className="step-card">
                <div className="step-header">
                  <div className="step-icon">📄</div>
                  <div className="step-info">
                    <h3>Document OCR</h3>
                    <p>Upload and extract data from ID documents</p>
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
              </div>

              <div className="step-card">
                <div className="step-header">
                  <div className="step-icon">👤</div>
                  <div className="step-info">
                    <h3>Face Match</h3>
                    <p>Verify face matches document photo</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={steps.faceMatch}
                      onChange={() => handleStepToggle('faceMatch')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div className="step-card">
                <div className="step-header">
                  <div className="step-icon">🎭</div>
                  <div className="step-info">
                    <h3>Liveness Check</h3>
                    <p>Verify user is a real person (not a photo/video)</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={steps.livenessCheck}
                      onChange={() => handleStepToggle('livenessCheck')}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div className="step-card">
                <div className="step-header">
                  <div className="step-icon">❓</div>
                  <div className="step-info">
                    <h3>Questionnaire</h3>
                    <p>Ask verification questions based on document</p>
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
              </div>
            </div>
          </div>

          {/* Form Selection (if questionnaire is enabled) */}
          {steps.questionnaire && (
            <div className="form-section">
              <h2>Select Question Set</h2>
              <p className="section-subtitle">Choose which questionnaire to present to users</p>

              <div className="form-group">
                <label htmlFor="formSelect">Question Set</label>
                <select
                  id="formSelect"
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
                {selectedForm && (
                  <div className="form-hint">
                    {questionSets.find((qs) => qs.id === selectedForm)?.description}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="form-actions">
            <button
              className="btn-secondary"
              onClick={handleReset}
              disabled={isLoading}
            >
              Reset
            </button>
            <button
              className="btn-primary"
              onClick={handleGenerateLink}
              disabled={isLoading}
            >
              {isLoading ? 'Generating...' : 'Generate Link'}
            </button>
          </div>

          {/* Error/Success Messages */}
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

          {/* Generated Link Display */}
          {generatedLink && (
            <div className="generated-link-section">
              <h2>🎉 Workflow Link Generated!</h2>
              <p className="section-subtitle">Share this link with users to start the configured KYC workflow</p>

              <div className="link-display">
                <div className="link-info">
                  <div className="link-label">Configuration ID:</div>
                  <div className="link-value">{configId}</div>
                </div>
                <div className="link-info">
                  <div className="link-label">Generated Link:</div>
                  <div className="link-value">
                    <a 
                      href={generatedLink} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="link-url"
                    >
                      {generatedLink}
                    </a>
                  </div>
                </div>
              </div>

              <button className="btn-copy" onClick={handleCopyLink}>
                📋 Copy Link to Clipboard
              </button>
            </div>
          )}
        </div>

        {/* Existing Configurations */}
        <div className="existing-configs-section">
          <div className="section-header">
            <h2>Existing Configurations</h2>
            <button
              className="btn-toggle-list"
              onClick={() => setShowConfigList(!showConfigList)}
            >
              {showConfigList ? 'Hide' : 'Show'} ({existingConfigs.length})
            </button>
          </div>

          {showConfigList && (
            <div className="configs-list">
              {existingConfigs.length === 0 ? (
                <p className="no-configs">No configurations yet. Create your first one above!</p>
              ) : (
                existingConfigs.map((config) => (
                  <div key={config.configId} className={`config-item ${!config.isActive ? 'inactive' : ''}`}>
                    <div className="config-header">
                      <h3>{config.name}</h3>
                      <span className={`status-badge ${config.isActive ? 'active' : 'inactive'}`}>
                        {config.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {config.description && <p className="config-description">{config.description}</p>}
                    <div className="config-steps">
                      {Object.entries(config.steps).map(([step, enabled]) => (
                        enabled && (
                          <span key={step} className="step-badge">
                            {step.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                        )
                      ))}
                    </div>
                    <div className="config-meta">
                      <span>ID: {config.configId}</span>
                      <span>Created: {new Date(config.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="config-actions">
                      <button
                        className={`btn-sm ${config.isActive ? 'btn-warning' : 'btn-success'}`}
                        onClick={() => handleToggleActive(config)}
                      >
                        {config.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn-sm btn-info"
                        onClick={() => {
                          const link = `${window.location.origin}/kyc/${config.configId}`;
                          navigator.clipboard.writeText(link);
                          setSuccess('Link copied!');
                        }}
                      >
                        Copy Link
                      </button>
                      <button
                        className="btn-sm btn-danger"
                        onClick={() => handleDeleteConfig(config)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminWorkflowConfig;

