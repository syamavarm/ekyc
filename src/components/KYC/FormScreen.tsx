import React, { useState, useEffect } from 'react';
import kycApiService, { FormField } from '../../services/kycApiService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface FormScreenProps {
  sessionId: string;
  onCompleted: () => void;
  loading: boolean;
  fieldSet?: string;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
}

const FormScreen: React.FC<FormScreenProps> = ({
  sessionId,
  onCompleted,
  loading,
  fieldSet = 'account_opening',
  onStepInstruction,
}) => {
  const [fields, setFields] = useState<FormField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [status, setStatus] = useState<'loading' | 'answering' | 'submitting' | 'completed' | 'failed'>('loading');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  
  // Track audio played for instructions
  const audioPlayedRef = React.useRef<Set<number>>(new Set());

  useEffect(() => {
    loadFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play instruction when field changes
  useEffect(() => {
    const playFieldInstruction = async () => {
      if (status !== 'answering' || fields.length === 0) return;
      if (audioPlayedRef.current.has(currentFieldIndex)) return;
      
      audioPlayedRef.current.add(currentFieldIndex);
      
      const currentField = fields[currentFieldIndex];
      if (onStepInstruction && currentField) {
        await onStepInstruction(currentField.field);
      }
    };
    
    const timer = setTimeout(playFieldInstruction, 300);
    return () => clearTimeout(timer);
  }, [currentFieldIndex, status, fields, onStepInstruction]);

  const loadFields = async () => {
    try {
      const fieldsList = await kycApiService.getFormFields(sessionId, fieldSet, false);
      setFields(fieldsList);
      setStatus('answering');
      
      // Log form started
      uiEventLoggerService.logEvent('form_started', { 
        fieldSet,
        totalFields: fieldsList.length 
      });
    } catch (err: any) {
      console.error('Failed to load form fields:', err);
      setError(err.message || 'Failed to load form fields');
      setStatus('failed');
      uiEventLoggerService.logError('form_load_failed', err.message);
    }
  };

  const handleAnswerChange = (fieldId: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [fieldId]: answer }));
  };

  const handleNext = () => {
    // Log field answered (field text shown, answer recorded - actual answer not logged for privacy)
    const currentField = fields[currentFieldIndex];
    uiEventLoggerService.logEvent('form_answer_submitted', {
      fieldId: currentField.id,
      fieldText: currentField.field,
      fieldType: currentField.type,
      fieldIndex: currentFieldIndex + 1,
      totalFields: fields.length,
      answerRecorded: true, // Indicates answer was provided, actual value not logged
    });

    if (currentFieldIndex < fields.length - 1) {
      setCurrentFieldIndex(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handlePrevious = () => {
    if (currentFieldIndex > 0) {
      setCurrentFieldIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setStatus('submitting');
    setError('');

    if (onStepInstruction) {
      await onStepInstruction('Submitting your answers. Please wait.');
    }

    try {
      const response = await kycApiService.submitForm(sessionId, fieldSet, answers);
      setResult(response);
      
      if (response.success) {
        setStatus('completed');
        
        uiEventLoggerService.logEvent('form_completed', {
          success: true,
          score: response.form?.score,
        });

        if (onStepInstruction) {
          await onStepInstruction('Form completed successfully. Proceeding to next step.', true, true);
        }
        
        // Small pause then advance
        await new Promise(resolve => setTimeout(resolve, 1000));
        onCompleted();
      } else {
        setStatus('failed');
        setError(response.message || 'Form submission failed');
        uiEventLoggerService.logError('form_failed', response.message);
      }
    } catch (err: any) {
      console.error('Failed to submit form:', err);
      setError(err.message || 'Failed to submit form');
      setStatus('failed');
      uiEventLoggerService.logError('form_submit_error', err.message);
    }
  };

  const renderField = (field: FormField) => {
    const answer = answers[field.id] || '';

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={answer}
            onChange={(e) => handleAnswerChange(field.id, e.target.value)}
            placeholder="Type your answer"
            className="form-field-input"
          />
        );

      case 'numeric':
        return (
          <input
            type="number"
            value={answer}
            onChange={(e) => handleAnswerChange(field.id, e.target.value)}
            placeholder="Enter a number"
            className="form-field-input"
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={answer}
            onChange={(e) => handleAnswerChange(field.id, e.target.value)}
            className="form-field-input"
          />
        );

      case 'multiple_choice':
        return (
          <div className="form-field-options">
            {field.options?.map(opt => (
              <button
                key={opt}
                className={`option-btn ${answer === opt ? 'selected' : ''}`}
                onClick={() => handleAnswerChange(field.id, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        );

      case 'yes_no':
        return (
          <div className="yes-no-buttons">
            <button
              className={`yes-no-btn ${answer === 'yes' ? 'selected' : ''}`}
              onClick={() => handleAnswerChange(field.id, 'yes')}
            >
              Yes
            </button>
            <button
              className={`yes-no-btn ${answer === 'no' ? 'selected' : ''}`}
              onClick={() => handleAnswerChange(field.id, 'no')}
            >
              No
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  // Loading state - spinner only, instruction shown in overlay
  if (status === 'loading') {
    return (
      <div className="form-screen">
        <div className="form-status-standalone">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  // Answering state - show field card
  if (status === 'answering' && fields.length > 0) {
    const currentField = fields[currentFieldIndex];
    const progress = ((currentFieldIndex + 1) / fields.length) * 100;

    return (
      <div className="form-screen">
        <div className="form-card form-card-minimal">
          <div className="form-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <span className="progress-text">
              {currentFieldIndex + 1} / {fields.length}
            </span>
          </div>

          <div className="field-container">
            <h3 className="field-text">{currentField.field}</h3>
            {renderField(currentField)}
          </div>
        </div>

        <div className="form-actions-standalone">
          <button
            className="btn-secondary"
            onClick={handlePrevious}
            disabled={currentFieldIndex === 0}
          >
            Previous
          </button>
          <button
            className="btn-primary"
            onClick={handleNext}
            disabled={!answers[currentField.id]}
          >
            {currentFieldIndex === fields.length - 1 ? 'Submit' : 'Next'}
          </button>
        </div>
      </div>
    );
  }

  // Submitting state - spinner only
  if (status === 'submitting') {
    return (
      <div className="form-screen">
        <div className="form-status-standalone">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  // Completed state
  if (status === 'completed' && result) {
    return (
      <div className="form-screen">
        <div className="form-status-standalone success">
          <p>✓ Form completed</p>
        </div>
      </div>
    );
  }

  // Failed state
  if (status === 'failed') {
    return (
      <div className="form-screen">
        <div className="form-card form-card-minimal">
          <div className="form-error">
            <p>{error}</p>
          </div>
        </div>
        <div className="form-actions-standalone">
          <button className="btn-primary" onClick={loadFields}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default FormScreen;

