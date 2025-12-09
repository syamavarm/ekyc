/**
 * Questionnaire Service
 * Handles identity verification through preset questions
 */

import {
  QuestionnaireData,
  QuestionAnswer,
} from '../types/kyc.types';

export interface Question {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  answerField?: string; // Field from document OCR to verify against
  category: QuestionCategory;
}

export type QuestionType = 
  | 'text'           // Free text answer
  | 'multiple_choice' // Select from options
  | 'date'           // Date format
  | 'numeric'        // Number only
  | 'yes_no';        // Yes/No question

export type QuestionCategory = 
  | 'identity'       // Questions about personal identity
  | 'document'       // Questions about document data
  | 'knowledge'      // Knowledge-based questions
  | 'presence';      // Presence verification questions

export interface QuestionSet {
  required: Question[];
  optional: Question[];
  passingScore: number; // Percentage required to pass (e.g., 0.8 = 80%)
}

export class QuestionnaireService {
  private defaultQuestionSets: Map<string, QuestionSet>;
  private customQuestionSets: Map<string, QuestionSet>;

  constructor() {
    this.defaultQuestionSets = new Map();
    this.customQuestionSets = new Map();
    this.initializeDefaultQuestions();
  }

  /**
   * Initialize default question sets
   */
  private initializeDefaultQuestions(): void {
    // Basic identity verification questions
    const basicSet: QuestionSet = {
      required: [
        {
          id: 'q1',
          question: 'What is your year of birth?',
          type: 'numeric',
          answerField: 'dateOfBirth',
          category: 'identity',
        },
        {
          id: 'q2',
          question: 'What is your full name as it appears on your ID?',
          type: 'text',
          answerField: 'fullName',
          category: 'identity',
        },
        {
          id: 'q3',
          question: 'What is your document number?',
          type: 'text',
          answerField: 'documentNumber',
          category: 'document',
        },
      ],
      optional: [
        {
          id: 'q4',
          question: 'What is your nationality?',
          type: 'text',
          answerField: 'nationality',
          category: 'identity',
        },
      ],
      passingScore: 0.8, // 80% required
    };

    // Comprehensive verification questions
    const comprehensiveSet: QuestionSet = {
      required: [
        {
          id: 'q1',
          question: 'What is your date of birth? (YYYY-MM-DD)',
          type: 'date',
          answerField: 'dateOfBirth',
          category: 'identity',
        },
        {
          id: 'q2',
          question: 'What is your full legal name?',
          type: 'text',
          answerField: 'fullName',
          category: 'identity',
        },
        {
          id: 'q3',
          question: 'What is your document/ID number?',
          type: 'text',
          answerField: 'documentNumber',
          category: 'document',
        },
        {
          id: 'q4',
          question: 'When does your ID expire? (YYYY-MM-DD)',
          type: 'date',
          answerField: 'expiryDate',
          category: 'document',
        },
        {
          id: 'q5',
          question: 'What is your gender?',
          type: 'multiple_choice',
          options: ['Male', 'Female', 'Other', 'Prefer not to say'],
          answerField: 'gender',
          category: 'identity',
        },
      ],
      optional: [
        {
          id: 'q6',
          question: 'What is your nationality?',
          type: 'text',
          answerField: 'nationality',
          category: 'identity',
        },
        {
          id: 'q7',
          question: 'Can you confirm your current address?',
          type: 'text',
          answerField: 'address',
          category: 'identity',
        },
      ],
      passingScore: 0.75, // 75% required
    };

    // Presence verification questions (no document data needed)
    const presenceSet: QuestionSet = {
      required: [
        {
          id: 'p1',
          question: 'Are you completing this verification of your own free will?',
          type: 'yes_no',
          category: 'presence',
        },
        {
          id: 'p2',
          question: 'Are you alone during this verification process?',
          type: 'yes_no',
          category: 'presence',
        },
        {
          id: 'p3',
          question: 'Can you confirm you are the person in the submitted document?',
          type: 'yes_no',
          category: 'presence',
        },
      ],
      optional: [],
      passingScore: 1.0, // 100% required for presence verification
    };

    this.defaultQuestionSets.set('basic', basicSet);
    this.defaultQuestionSets.set('comprehensive', comprehensiveSet);
    this.defaultQuestionSets.set('presence', presenceSet);
  }

  /**
   * Get questions for a session
   */
  getQuestions(
    questionSetName: string = 'basic',
    includeOptional: boolean = false
  ): Question[] {
    const questionSet = 
      this.customQuestionSets.get(questionSetName) ||
      this.defaultQuestionSets.get(questionSetName);

    if (!questionSet) {
      throw new Error(`Question set '${questionSetName}' not found`);
    }

    const questions = [...questionSet.required];
    if (includeOptional) {
      questions.push(...questionSet.optional);
    }

    return questions;
  }

  /**
   * Verify answers against document data
   */
  verifyAnswers(
    questions: Question[],
    answers: Map<string, string>,
    documentData?: any
  ): QuestionnaireData {
    const questionAnswers: QuestionAnswer[] = [];
    let correctCount = 0;

    for (const question of questions) {
      const userAnswer = answers.get(question.id);
      
      if (!userAnswer) {
        // Skip unanswered questions (optional questions)
        continue;
      }

      const isCorrect = this.verifyAnswer(
        question,
        userAnswer,
        documentData
      );

      if (isCorrect) {
        correctCount++;
      }

      questionAnswers.push({
        question: question.question,
        expectedAnswer: question.answerField && documentData 
          ? documentData[question.answerField]
          : undefined,
        userAnswer,
        isCorrect,
        answeredAt: new Date(),
      });
    }

    const requiredQuestions = questions.filter(q => 
      this.isRequiredQuestion(q, this.getQuestionSetName(questions))
    );
    const score = correctCount / requiredQuestions.length;
    const passingScore = this.getPassingScore(this.getQuestionSetName(questions));
    const passed = score >= passingScore;

    return {
      questions: questionAnswers,
      score: correctCount,
      passed,
      completedAt: new Date(),
    };
  }

  /**
   * Verify a single answer
   */
  private verifyAnswer(
    question: Question,
    userAnswer: string,
    documentData?: any
  ): boolean {
    // For presence verification questions (no document data needed)
    if (question.category === 'presence') {
      return this.verifyPresenceAnswer(question, userAnswer);
    }

    // For document-based questions
    if (!documentData || !question.answerField) {
      // If no document data available, cannot verify
      return false;
    }

    const expectedAnswer = documentData[question.answerField];
    if (!expectedAnswer) {
      return false;
    }

    switch (question.type) {
      case 'text':
        return this.compareText(userAnswer, expectedAnswer);
      
      case 'numeric':
        return this.compareNumeric(userAnswer, expectedAnswer);
      
      case 'date':
        return this.compareDate(userAnswer, expectedAnswer);
      
      case 'multiple_choice':
        return this.compareExact(userAnswer, expectedAnswer);
      
      case 'yes_no':
        return this.compareYesNo(userAnswer, expectedAnswer);
      
      default:
        return false;
    }
  }

  /**
   * Verify presence verification answers
   */
  private verifyPresenceAnswer(question: Question, userAnswer: string): boolean {
    // For presence questions, we expect 'yes' or affirmative answers
    const affirmativeAnswers = ['yes', 'y', 'true', '1', 'correct', 'confirm'];
    return affirmativeAnswers.includes(userAnswer.toLowerCase().trim());
  }

  /**
   * Compare text answers (fuzzy matching)
   */
  private compareText(userAnswer: string, expectedAnswer: string): boolean {
    const normalize = (str: string) => 
      str.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    
    const normalizedUser = normalize(userAnswer);
    const normalizedExpected = normalize(expectedAnswer);
    
    // Exact match
    if (normalizedUser === normalizedExpected) {
      return true;
    }
    
    // Calculate similarity score (Levenshtein distance-based)
    const similarity = this.calculateSimilarity(normalizedUser, normalizedExpected);
    return similarity >= 0.85; // 85% similarity threshold
  }

  /**
   * Compare numeric answers
   */
  private compareNumeric(userAnswer: string, expectedAnswer: string): boolean {
    const userNum = parseInt(userAnswer, 10);
    const expectedNum = parseInt(expectedAnswer.toString(), 10);
    
    if (isNaN(userNum) || isNaN(expectedNum)) {
      return false;
    }
    
    return userNum === expectedNum;
  }

  /**
   * Compare date answers
   */
  private compareDate(userAnswer: string, expectedAnswer: string): boolean {
    try {
      const userDate = new Date(userAnswer);
      const expectedDate = new Date(expectedAnswer);
      
      if (isNaN(userDate.getTime()) || isNaN(expectedDate.getTime())) {
        return false;
      }
      
      // Compare year, month, day
      return (
        userDate.getFullYear() === expectedDate.getFullYear() &&
        userDate.getMonth() === expectedDate.getMonth() &&
        userDate.getDate() === expectedDate.getDate()
      );
    } catch {
      return false;
    }
  }

  /**
   * Compare exact answers (case-insensitive)
   */
  private compareExact(userAnswer: string, expectedAnswer: string): boolean {
    return userAnswer.toLowerCase().trim() === expectedAnswer.toLowerCase().trim();
  }

  /**
   * Compare yes/no answers
   */
  private compareYesNo(userAnswer: string, expectedAnswer: string): boolean {
    const normalize = (str: string) => {
      const lower = str.toLowerCase().trim();
      if (['yes', 'y', 'true', '1'].includes(lower)) return 'yes';
      if (['no', 'n', 'false', '0'].includes(lower)) return 'no';
      return lower;
    };
    
    return normalize(userAnswer) === normalize(expectedAnswer);
  }

  /**
   * Calculate string similarity (0-1)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) {
      return 1.0;
    }
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Add custom question set
   */
  addCustomQuestionSet(name: string, questionSet: QuestionSet): void {
    this.customQuestionSets.set(name, questionSet);
    console.log(`[QuestionnaireService] Custom question set '${name}' added`);
  }

  /**
   * Check if question is required
   */
  private isRequiredQuestion(question: Question, setName: string): boolean {
    const questionSet = 
      this.customQuestionSets.get(setName) ||
      this.defaultQuestionSets.get(setName);
    
    if (!questionSet) {
      return true;
    }
    
    return questionSet.required.some(q => q.id === question.id);
  }

  /**
   * Get passing score for question set
   */
  private getPassingScore(setName: string): number {
    const questionSet = 
      this.customQuestionSets.get(setName) ||
      this.defaultQuestionSets.get(setName);
    
    return questionSet?.passingScore || 0.8;
  }

  /**
   * Get question set name from questions
   */
  private getQuestionSetName(questions: Question[]): string {
    // Try to identify which set these questions belong to
    for (const [name, set] of this.defaultQuestionSets.entries()) {
      if (set.required.length === questions.length) {
        return name;
      }
    }
    
    for (const [name, set] of this.customQuestionSets.entries()) {
      if (set.required.length === questions.length) {
        return name;
      }
    }
    
    return 'basic';
  }

  /**
   * Get available question sets
   */
  getAvailableQuestionSets(): string[] {
    return [
      ...Array.from(this.defaultQuestionSets.keys()),
      ...Array.from(this.customQuestionSets.keys()),
    ];
  }

  /**
   * Get question set details
   */
  getQuestionSetDetails(name: string): QuestionSet | undefined {
    return (
      this.customQuestionSets.get(name) ||
      this.defaultQuestionSets.get(name)
    );
  }
}

