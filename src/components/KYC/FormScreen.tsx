import React, { useState, useEffect, useCallback } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';
import kycApiService, { FormField } from '../../services/kycApiService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface FormScreenProps {
  sessionId: string;
  onCompleted: () => void;
  loading: boolean;
  fieldSet?: string;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
}

// Helper functions for parsing voice input
const parseYesNo = (transcript: string): 'yes' | 'no' | null => {
  const lower = transcript.toLowerCase().trim();
  const yesPatterns = ['yes', 'yeah', 'yep', 'yup', 'sure', 'correct', 'right', 'affirmative', 'absolutely', 'definitely', 'of course', 'ok', 'okay'];
  if (yesPatterns.some(p => lower.includes(p))) return 'yes';
  const noPatterns = ['no', 'nope', 'nah', 'negative', 'incorrect', 'wrong', 'never', 'not'];
  if (noPatterns.some(p => lower.includes(p))) return 'no';
  return null;
};

const parseNumeric = (transcript: string): string | null => {
  const lower = transcript.toLowerCase().trim();
  const wordNumbers: Record<string, string> = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
    'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
    'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
    'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
    'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
    'eighty': '80', 'ninety': '90', 'hundred': '100', 'thousand': '1000'
  };
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (lower.includes(word)) return num;
  }
  const numMatch = transcript.match(/[\d,]+\.?\d*/);
  if (numMatch) return numMatch[0].replace(/,/g, '');
  return null;
};

const findBestMatch = (transcript: string, options: string[]): string | null => {
  const lower = transcript.toLowerCase().trim();
  const directMatch = options.find(opt => lower.includes(opt.toLowerCase()));
  if (directMatch) return directMatch;
  
  for (const option of options) {
    const optionWords = option.toLowerCase().split(/\s+/);
    const transcriptWords = lower.split(/\s+/);
    const matchCount = optionWords.filter(ow => 
      transcriptWords.some(tw => tw.includes(ow) || ow.includes(tw))
    ).length;
    if (matchCount >= optionWords.length * 0.5) return option;
  }
  
  const numberPatterns = [
    { pattern: /(?:option|number|choice)?\s*(?:one|1|first)/i, index: 0 },
    { pattern: /(?:option|number|choice)?\s*(?:two|2|second)/i, index: 1 },
    { pattern: /(?:option|number|choice)?\s*(?:three|3|third)/i, index: 2 },
    { pattern: /(?:option|number|choice)?\s*(?:four|4|fourth)/i, index: 3 },
    { pattern: /(?:option|number|choice)?\s*(?:five|5|fifth)/i, index: 4 },
  ];
  for (const { pattern, index } of numberPatterns) {
    if (pattern.test(lower) && options[index]) return options[index];
  }
  return null;
};

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
  const [status, setStatus] = useState<'loading' | 'answering' | 'reviewing' | 'submitting' | 'completed' | 'failed'>('loading');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [voiceError, setVoiceError] = useState<string>('');
  const [isEditingFromReview, setIsEditingFromReview] = useState(false);
  
  // react-speech-recognition hook
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
    isMicrophoneAvailable,
  } = useSpeechRecognition();
  
  // Track audio played for instructions
  const audioPlayedRef = React.useRef<Set<number>>(new Set());
  const hasStartedRef = React.useRef(false);
  const lastProcessedTranscript = React.useRef<string>('');
  
  // Auto-listen timer ref
  const autoListenTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Debounce timer for answer matching
  const matchDebounceRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Flag to prevent processing transcripts during question playback
  // This prevents TTS audio from being captured as user input
  const isReadyToListenRef = React.useRef<boolean>(false);
  
  // Track the field index when listening started to prevent cross-field interference
  const listeningFieldIndexRef = React.useRef<number>(-1);
  
  // Config
  const MATCH_DEBOUNCE_MS = 1200; // Wait 1.2s after user stops speaking to match

  // Try to match answer from transcript
  const tryMatchAnswer = useCallback((text: string) => {
    if (!text || fields.length === 0) return;
    if (text === lastProcessedTranscript.current) return;
    
    // Don't process if not ready to listen (TTS might still be playing)
    if (!isReadyToListenRef.current) {
      console.log('[FormScreen] Ignoring transcript - not ready to listen yet');
      return;
    }
    
    // Don't process if this transcript was from a different field
    if (listeningFieldIndexRef.current !== currentFieldIndex) {
      console.log('[FormScreen] Ignoring transcript - field index mismatch', {
        listeningFor: listeningFieldIndexRef.current,
        currentField: currentFieldIndex
      });
      return;
    }
    
    const currentField = fields[currentFieldIndex];
    let answer: string | null = null;
    let isDiscreteSelection = false;
    
    switch (currentField.type) {
      case 'yes_no':
        answer = parseYesNo(text);
        isDiscreteSelection = true;
        break;
      case 'numeric':
        answer = parseNumeric(text);
        isDiscreteSelection = true; // Voice numeric is a complete answer
        break;
      case 'multiple_choice':
        if (currentField.options) {
          answer = findBestMatch(text, currentField.options);
          isDiscreteSelection = true;
        }
        break;
      case 'text':
      default:
        // For text fields, accept the transcript as-is
        if (text.trim().length > 0) {
          answer = text.trim();
          isDiscreteSelection = true; // Voice text is a complete answer
        }
        break;
    }
    
    if (answer) {
      lastProcessedTranscript.current = text;
      
      // Stop listening immediately to prevent further processing
      isReadyToListenRef.current = false;
      SpeechRecognition.stopListening();
      
      handleAnswerChange(currentField.id, answer, isDiscreteSelection);
      resetTranscript();
      
      uiEventLoggerService.logEvent('voice_answer_recognized', {
        fieldId: currentField.id,
        fieldType: currentField.type,
        recognized: true,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, currentFieldIndex, resetTranscript, isEditingFromReview]);

  // Debounced transcript processing - waits for user to finish speaking
  useEffect(() => {
    if (!transcript) return;
    
    // Don't process if we're not ready to listen (e.g., TTS is playing)
    if (!isReadyToListenRef.current) return;
    
    // Clear any pending match attempt
    if (matchDebounceRef.current) {
      clearTimeout(matchDebounceRef.current);
    }
    
    // Wait for transcript to stabilize before matching
    matchDebounceRef.current = setTimeout(() => {
      tryMatchAnswer(transcript);
    }, MATCH_DEBOUNCE_MS);
    
    return () => {
      if (matchDebounceRef.current) {
        clearTimeout(matchDebounceRef.current);
      }
    };
  }, [transcript, tryMatchAnswer]);

  // Toggle voice input (manual mic button click)
  const toggleVoiceInput = () => {
    if (listening) {
      stopListeningAndReset();
    } else {
      startListening(currentFieldIndex);
    }
  };

  // Start listening in continuous mode
  // Safe to start immediately because we always stop listening BEFORE TTS plays
  const startListening = (forFieldIndex: number) => {
    setVoiceError('');
    resetTranscript();
    lastProcessedTranscript.current = '';
    listeningFieldIndexRef.current = forFieldIndex;
    isReadyToListenRef.current = true;
    SpeechRecognition.startListening({ continuous: true, language: 'en-US' });
  };
  
  // Stop listening and reset all state
  // This is critical to call BEFORE TTS plays to prevent TTS audio capture
  const stopListeningAndReset = () => {
    SpeechRecognition.stopListening();
    isReadyToListenRef.current = false;
    listeningFieldIndexRef.current = -1;
    if (matchDebounceRef.current) clearTimeout(matchDebounceRef.current);
    resetTranscript();
    lastProcessedTranscript.current = '';
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListeningAndReset();
      if (autoListenTimerRef.current) clearTimeout(autoListenTimerRef.current);
      if (autoAdvanceTimerRef.current) clearTimeout(autoAdvanceTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play intro first, then load fields
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    
    const playIntroAndLoad = async () => {
      if (onStepInstruction) {
        await onStepInstruction(
          'Please answer a few questions to complete your verification process. You can speak your answers or type them.',
          true,
          true
        );
      }
      await loadFields();
    };
    
    playIntroAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play instruction when field changes, then auto-start listening
  useEffect(() => {
    if (status !== 'answering' || fields.length === 0) return;
    if (audioPlayedRef.current.has(currentFieldIndex)) return;
    
    const currentField = fields[currentFieldIndex];
    if (!currentField) return;
    
    let cancelled = false;
    
    const playInstructionThenListen = async () => {
      audioPlayedRef.current.add(currentFieldIndex);
      
      // CRITICAL: Stop listening BEFORE TTS plays
      // This prevents TTS audio from being captured by the microphone
      stopListeningAndReset();
      
      // Play the instruction audio and wait for it to complete
      if (onStepInstruction) {
        await onStepInstruction(currentField.field, true, true); // wait for audio
      }
      
      if (cancelled) return;
      
      // Skip auto-listen for date fields
      if (currentField.type === 'date') return;
      if (!browserSupportsSpeechRecognition) return;
      
      // Start listening IMMEDIATELY after TTS finishes
      // No delay needed because mic was OFF during TTS, so no TTS audio was captured
      // This ensures we don't miss any user input
      startListening(currentFieldIndex);
    };
    
    // Small initial delay before playing instruction
    const timer = setTimeout(playInstructionThenListen, 300);
    
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (autoListenTimerRef.current) {
        clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFieldIndex, status, fields, browserSupportsSpeechRecognition]);

  const loadFields = async () => {
    try {
      const fieldsList = await kycApiService.getFormFields(sessionId, fieldSet, false);
      setFields(fieldsList);
      setStatus('answering');
      uiEventLoggerService.logEvent('form_started', { fieldSet, totalFields: fieldsList.length });
    } catch (err: any) {
      console.error('Failed to load form fields:', err);
      setError(err.message || 'Failed to load form fields');
      setStatus('failed');
      uiEventLoggerService.logError('form_load_failed', err.message);
    }
  };

  // Auto-advance timer ref
  const autoAdvanceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleAnswerChange = (fieldId: string, answer: string, isDiscreteSelection: boolean = false) => {
    setAnswers(prev => ({ ...prev, [fieldId]: answer }));
    
    // Auto-advance only for discrete selections (yes/no, multiple choice) during first pass
    // Don't auto-advance for text/numeric inputs as user might still be typing
    if (!isEditingFromReview && isDiscreteSelection) {
      // Clear any pending auto-advance
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
      
      // Small delay to show the selection, then advance
      autoAdvanceTimerRef.current = setTimeout(() => {
        const currentField = fields[currentFieldIndex];
        
        // Log the answer
        uiEventLoggerService.logEvent('form_answer_submitted', {
          fieldId: currentField.id,
          fieldText: currentField.field,
          fieldType: currentField.type,
          fieldIndex: currentFieldIndex + 1,
          totalFields: fields.length,
          answerRecorded: true,
          autoAdvanced: true,
        });

        if (currentFieldIndex < fields.length - 1) {
          // Stop listening and reset before advancing to prevent interference
          stopListeningAndReset();
          setCurrentFieldIndex(prev => prev + 1);
        } else {
          // Last question - go to review
          setStatus('reviewing');
        }
      }, 400); // Short delay for visual feedback
    }
  };

  // Go back to editing from review
  const handleEditFromReview = (fieldIndex?: number) => {
    setIsEditingFromReview(true);
    if (fieldIndex !== undefined) {
      setCurrentFieldIndex(fieldIndex);
    }
    setStatus('answering');
  };

  const handleSubmit = async () => {
    setStatus('submitting');
    setError('');

    // No audio - just submit silently

    try {
      const response = await kycApiService.submitForm(sessionId, fieldSet, answers);
      setResult(response);
      
      if (response.success) {
        setStatus('completed');
        uiEventLoggerService.logEvent('form_completed', { success: true, score: response.form?.score });

        if (onStepInstruction) {
          await onStepInstruction('Thank you for your inputs.', true, true);
        }
        
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

  // Manually confirm answer for text/numeric/date fields during first pass
  const handleConfirmAnswer = () => {
    const currentField = fields[currentFieldIndex];
    const answer = answers[currentField.id];
    
    if (!answer) return;
    
    // Stop listening and reset
    if (listening) stopListeningAndReset();
    
    // Log the answer
    uiEventLoggerService.logEvent('form_answer_submitted', {
      fieldId: currentField.id,
      fieldText: currentField.field,
      fieldType: currentField.type,
      fieldIndex: currentFieldIndex + 1,
      totalFields: fields.length,
      answerRecorded: true,
      autoAdvanced: false,
    });

    if (currentFieldIndex < fields.length - 1) {
      setCurrentFieldIndex(prev => prev + 1);
    } else {
      // Last question - go to review
      setStatus('reviewing');
    }
  };

  // Check if current field is a text input type (needs manual confirm button during first pass)
  const isTextInputField = (fieldType: string) => {
    return ['text', 'numeric', 'date'].includes(fieldType);
  };

  const renderField = (field: FormField) => {
    const answer = answers[field.id] || '';
    const showConfirmButton = !isEditingFromReview && isTextInputField(field.type);

    switch (field.type) {
      case 'text':
        return (
          <div className="voice-input-wrapper">
            <input
              type="text"
              value={listening ? transcript || answer : answer}
              onChange={(e) => handleAnswerChange(field.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer && !isEditingFromReview) {
                  handleConfirmAnswer();
                }
              }}
              placeholder={browserSupportsSpeechRecognition ? "Type or speak your answer" : "Type your answer"}
              className={`form-field-input ${listening && transcript ? 'interim' : ''}`}
            />
            {showConfirmButton && answer && (
              <button className="input-confirm-btn" onClick={handleConfirmAnswer}>
                Continue →
              </button>
            )}
          </div>
        );

      case 'numeric':
        return (
          <div className="voice-input-wrapper">
            <input
              type="text"
              inputMode="numeric"
              value={listening ? transcript || answer : answer}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                  handleAnswerChange(field.id, val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer && !isEditingFromReview) {
                  handleConfirmAnswer();
                }
              }}
              placeholder={browserSupportsSpeechRecognition ? "Say a number or type" : "Enter a number"}
              className={`form-field-input ${listening && transcript ? 'interim' : ''}`}
            />
            {showConfirmButton && answer && (
              <button className="input-confirm-btn" onClick={handleConfirmAnswer}>
                Continue →
              </button>
            )}
          </div>
        );

      case 'date':
        return (
          <div className="voice-input-wrapper">
            <input
              type="date"
              value={answer}
              onChange={(e) => {
                handleAnswerChange(field.id, e.target.value);
                // Auto-advance on date selection during first pass
                if (!isEditingFromReview && e.target.value) {
                  setTimeout(() => {
                    if (currentFieldIndex < fields.length - 1) {
                      setCurrentFieldIndex(prev => prev + 1);
                    } else {
                      setStatus('reviewing');
                    }
                  }, 400);
                }
              }}
              className="form-field-input"
            />
          </div>
        );

      case 'multiple_choice':
        return (
          <div className="form-field-options">
            {field.options?.map((opt, idx) => (
              <button
                key={opt}
                className={`option-btn ${answer === opt ? 'selected' : ''}`}
                onClick={() => handleAnswerChange(field.id, opt, true)}
              >
                <span className="option-number">{idx + 1}</span>
                {opt}
              </button>
            ))}
            {listening && transcript && (
              <div className="voice-interim-hint">
                Hearing: "{transcript}"
              </div>
            )}
          </div>
        );

      case 'yes_no':
        return (
          <div className="yes-no-container">
            <div className="yes-no-buttons">
              <button
                className={`yes-no-btn ${answer === 'yes' ? 'selected' : ''}`}
                onClick={() => handleAnswerChange(field.id, 'yes', true)}
              >
                Yes
              </button>
              <button
                className={`yes-no-btn ${answer === 'no' ? 'selected' : ''}`}
                onClick={() => handleAnswerChange(field.id, 'no', true)}
              >
                No
              </button>
            </div>
            {listening && transcript && (
              <div className="voice-interim-hint">
                Hearing: "{transcript}"
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // Voice input button
  const VoiceInputButton = () => {
    if (!browserSupportsSpeechRecognition) return null;
    
    return (
      <button 
        className={`voice-input-btn ${listening ? 'listening' : ''}`}
        onClick={toggleVoiceInput}
        type="button"
        aria-label={listening ? 'Stop listening' : 'Start voice input'}
        disabled={!isMicrophoneAvailable}
      >
        {listening ? (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        )}
        {listening && <span className="listening-pulse"></span>}
      </button>
    );
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="form-screen">
        <div className="form-status-standalone">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  // Answering state
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
            <div className="field-header">
              <h3 className="field-text">{currentField.field}</h3>
              <VoiceInputButton />
            </div>
            {renderField(currentField)}
            
            {voiceError && (
              <div className="voice-error">{voiceError}</div>
            )}
            
            {listening && (
              <div className="voice-listening-indicator">
                <span className="voice-waves">
                  <span></span><span></span><span></span>
                </span>
                Listening...
              </div>
            )}
          </div>
        </div>

        {/* Show done button when editing from review */}
        {isEditingFromReview && (
          <div className="form-actions-standalone">
            <button
              className="btn-primary"
              onClick={() => setStatus('reviewing')}
            >
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  // Reviewing state - preview all answers before confirm
  if (status === 'reviewing') {
    return (
      <div className="form-screen">
        <div className="form-card form-card-review">
          <h3 className="review-title">Review Your Answers</h3>
          <p className="review-subtitle">Tap any item to edit</p>
          
          <div className="review-answers">
            {fields.map((field, index) => (
              <div 
                key={field.id} 
                className="review-item review-item-clickable"
                onClick={() => handleEditFromReview(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleEditFromReview(index);
                  }
                }}
              >
                <div className="review-question">
                  <span className="review-number">{index + 1}.</span>
                  {field.field}
                </div>
                <div className="review-answer">
                  {answers[field.id] || <span className="review-empty">Not answered</span>}
                  <span className="review-edit-icon">✎</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-actions-standalone">
          <button
            className="btn-primary"
            onClick={handleSubmit}
          >
            Confirm
          </button>
        </div>
      </div>
    );
  }

  // Submitting state
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
