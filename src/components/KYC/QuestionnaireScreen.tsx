import React, { useState, useEffect } from 'react';
import kycApiService, { Question } from '../../services/kycApiService';

interface QuestionnaireScreenProps {
  sessionId: string;
  /**
   * Essential OCR data for display purposes only.
   * Full OCR data for answer verification is stored in the backend
   * against the sessionId and used there for verification.
   */
  ocrData?: {
    address?: string;
    fullName?: string;
    dateOfBirth?: string;
    documentNumber?: string;
  };
  onCompleted: () => void;
  onSkip: () => void;
  loading: boolean;
  questionSet?: string;
}

const QuestionnaireScreen: React.FC<QuestionnaireScreenProps> = ({
  sessionId,
  ocrData,
  onCompleted,
  onSkip,
  loading,
  questionSet = 'basic',
}) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [status, setStatus] = useState<'loading' | 'answering' | 'submitting' | 'completed' | 'failed'>('loading');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    try {
      const questionsList = await kycApiService.getQuestions(sessionId, questionSet, false);
      setQuestions(questionsList);
      setStatus('answering');
    } catch (err: any) {
      console.error('Failed to load questions:', err);
      setError(err.message || 'Failed to load questions');
      setStatus('failed');
    }
  };

  const handleAnswerChange = (questionId: string, answer: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      handleSubmit();
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setStatus('submitting');
    setError('');

    try {
      const response = await kycApiService.submitQuestionnaire(sessionId, questionSet, answers);
      setResult(response);
      
      if (response.success) {
        setStatus('completed');
        setTimeout(() => {
          onCompleted();
        }, 3000);
      } else {
        setStatus('failed');
        setError(response.message || 'Questionnaire failed');
      }
    } catch (err: any) {
      console.error('Failed to submit questionnaire:', err);
      setError(err.message || 'Failed to submit questionnaire');
      setStatus('failed');
    }
  };

  const renderQuestion = (question: Question) => {
    const answer = answers[question.id] || '';

    switch (question.type) {
      case 'text':
        return (
          <input
            type="text"
            value={answer}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Your answer"
            className="question-input"
          />
        );

      case 'numeric':
        return (
          <input
            type="number"
            value={answer}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            placeholder="Your answer"
            className="question-input"
          />
        );

      case 'date':
        return (
          <input
            type="date"
            value={answer}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            className="question-input"
          />
        );

      case 'multiple_choice':
        return (
          <select
            value={answer}
            onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            className="question-select"
          >
            <option value="">Select an option</option>
            {question.options?.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );

      case 'yes_no':
        return (
          <div className="yes-no-buttons">
            <button
              className={`yes-no-btn ${answer === 'yes' ? 'selected' : ''}`}
              onClick={() => handleAnswerChange(question.id, 'yes')}
            >
              Yes
            </button>
            <button
              className={`yes-no-btn ${answer === 'no' ? 'selected' : ''}`}
              onClick={() => handleAnswerChange(question.id, 'no')}
            >
              No
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  if (status === 'loading') {
    return (
      <div className="questionnaire-screen">
        <div className="status-message">
          <div className="spinner"></div>
          <p>Loading questions...</p>
        </div>
      </div>
    );
  }

  if (status === 'answering' && questions.length > 0) {
    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

    return (
      <div className="questionnaire-screen">
        <div className="questionnaire-card">
          <h2>Identity Verification Questions</h2>
          <p>Please answer the following questions to verify your identity.</p>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <p className="progress-text">
            Question {currentQuestionIndex + 1} of {questions.length}
          </p>

          <div className="question-container">
            <h3 className="question-text">{currentQuestion.question}</h3>
            {renderQuestion(currentQuestion)}
          </div>

          <div className="questionnaire-actions">
            <button
              className="btn-secondary"
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
            >
              Previous
            </button>
            <button
              className="btn-secondary"
              onClick={onSkip}
            >
              Skip Questionnaire
            </button>
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={!answers[currentQuestion.id]}
            >
              {currentQuestionIndex === questions.length - 1 ? 'Submit' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'submitting') {
    return (
      <div className="questionnaire-screen">
        <div className="status-message">
          <div className="spinner"></div>
          <p>Verifying your answers...</p>
        </div>
      </div>
    );
  }

  if (status === 'completed' && result) {
    return (
      <div className="questionnaire-screen">
        <div className="status-message success">
          <p>Questionnaire completed successfully!</p>
          <p><strong>Score:</strong> {result.questionnaire.score} / {result.questionnaire.questions.length}</p>
          <p>Moving to final step...</p>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="questionnaire-screen">
        <div className="status-message error">
          <p>{error}</p>
          {result && (
            <div className="failed-questions">
              <p>Incorrect answers:</p>
              {result.questionnaire.questions
                .filter((q: any) => !q.isCorrect)
                .map((q: any, index: number) => (
                  <p key={index}>- {q.question}</p>
                ))}
            </div>
          )}
          <div className="questionnaire-actions">
            <button className="btn-primary" onClick={loadQuestions}>
              Try Again
            </button>
            <button className="btn-secondary" onClick={onSkip}>
              Skip Questionnaire
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default QuestionnaireScreen;

