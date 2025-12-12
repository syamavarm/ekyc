/**
 * Form Service
 * Handles form-specific fields for KYC workflows
 */

import {
  FormData,
  FormFieldAnswer,
} from '../types/kyc.types';

export interface FormField {
  id: string;
  field: string;
  type: FormFieldType;
  options?: string[];
  answerField?: string; // Field from document OCR to verify against
  category: FormFieldCategory;
}

export type FormFieldType = 
  | 'text'           // Free text answer
  | 'multiple_choice' // Select from options
  | 'date'           // Date format
  | 'numeric'        // Number only
  | 'yes_no';        // Yes/No field

export type FormFieldCategory = 
  | 'identity'       // Fields about personal identity
  | 'document'       // Fields about document data
  | 'knowledge'      // Knowledge-based fields
  | 'financial'      // Financial information fields
  | 'employment'     // Employment related fields
  | 'risk'           // Risk assessment fields
  | 'purpose';       // Purpose/intent fields

export interface FormFieldSet {
  required: FormField[];
  optional: FormField[];
  passingScore: number; // Percentage required to pass (e.g., 0.8 = 80%)
}

export class FormService {
  private defaultFieldSets: Map<string, FormFieldSet>;
  private customFieldSets: Map<string, FormFieldSet>;

  constructor() {
    this.defaultFieldSets = new Map();
    this.customFieldSets = new Map();
    this.initializeDefaultFields();
  }

  /**
   * Initialize default field sets
   */
  private initializeDefaultFields(): void {
    // =====================================================
    // ACCOUNT OPENING FORM - Savings/Current Account
    // =====================================================
    const accountOpeningSet: FormFieldSet = {
      required: [
        {
          id: 'accountPurpose',
          field: 'What is the primary purpose of opening this account?',
          type: 'multiple_choice',
          options: [
            'Salary/Income deposits',
            'Business transactions',
            'Savings and investments',
            'Bill payments and expenses',
            'Other',
          ],
          category: 'purpose',
        },
        {
          id: 'employmentStatus',
          field: 'What is your current employment status?',
          type: 'multiple_choice',
          options: [
            'Employed (Full-time)',
            'Employed (Part-time)',
            'Self-employed / Business owner',
            'Freelancer / Contractor',
            'Student',
            'Retired',
            'Unemployed',
          ],
          category: 'employment',
        },
        {
          id: 'expectedMonthlyDeposit',
          field: 'What is your expected monthly deposit amount?',
          type: 'multiple_choice',
          options: [
            'Less than ₹25,000',
            '₹25,000 - ₹50,000',
            '₹50,000 - ₹1,00,000',
            '₹1,00,000 - ₹5,00,000',
            'More than ₹5,00,000',
          ],
          category: 'financial',
        },
        {
          id: 'incomeSource',
          field: 'What is your primary source of income?',
          type: 'multiple_choice',
          options: [
            'Salary/Wages',
            'Business income',
            'Rental income',
            'Investments/Dividends',
            'Pension',
            'Family support',
            'Other',
          ],
          category: 'financial',
        },
        {
          id: 'isPoliticallyExposed',
          field: 'Are you a Politically Exposed Person (PEP) or related to one?',
          type: 'yes_no',
          category: 'risk',
        },
        {
          id: 'hasExistingAccount',
          field: 'Do you have any existing accounts with our bank?',
          type: 'yes_no',
          category: 'knowledge',
        },
      ],
      optional: [
        {
          id: 'wantsDebitCard',
          field: 'Would you like to opt for a debit card with this account?',
          type: 'yes_no',
          category: 'purpose',
        },
        {
          id: 'wantsMobileBanking',
          field: 'Would you like to enable internet/mobile banking?',
          type: 'yes_no',
          category: 'purpose',
        },
      ],
      passingScore: 1.0, // All fields must be answered
    };

    // =====================================================
    // CREDIT CARD APPLICATION FORM
    // =====================================================
    const creditCardSet: FormFieldSet = {
      required: [
        {
          id: 'employmentStatus',
          field: 'What is your current employment status?',
          type: 'multiple_choice',
          options: [
            'Salaried - Private sector',
            'Salaried - Government/PSU',
            'Self-employed professional (Doctor, CA, Lawyer, etc.)',
            'Self-employed business owner',
            'Retired with pension',
          ],
          category: 'employment',
        },
        {
          id: 'annualIncome',
          field: 'What is your gross annual income?',
          type: 'multiple_choice',
          options: [
            'Less than ₹3,00,000',
            '₹3,00,000 - ₹6,00,000',
            '₹6,00,000 - ₹12,00,000',
            '₹12,00,000 - ₹25,00,000',
            '₹25,00,000 - ₹50,00,000',
            'More than ₹50,00,000',
          ],
          category: 'financial',
        },
        {
          id: 'employmentDuration',
          field: 'How long have you been in your current job/business?',
          type: 'multiple_choice',
          options: [
            'Less than 1 year',
            '1 - 2 years',
            '2 - 5 years',
            '5 - 10 years',
            'More than 10 years',
          ],
          category: 'employment',
        },
        {
          id: 'existingCreditCards',
          field: 'Do you currently hold any other credit cards?',
          type: 'multiple_choice',
          options: [
            'No, this is my first credit card',
            'Yes, 1 credit card',
            'Yes, 2-3 credit cards',
            'Yes, more than 3 credit cards',
          ],
          category: 'financial',
        },
        {
          id: 'primaryCardUsage',
          field: 'What will be your primary use for this credit card?',
          type: 'multiple_choice',
          options: [
            'Daily expenses and shopping',
            'Online transactions',
            'Travel and dining',
            'Fuel expenses',
            'Business expenses',
            'Building credit history',
          ],
          category: 'purpose',
        },
        {
          id: 'existingLoans',
          field: 'Do you have any existing loans (home, car, personal)?',
          type: 'multiple_choice',
          options: [
            'No existing loans',
            'Yes, home loan only',
            'Yes, car loan only',
            'Yes, personal loan only',
            'Yes, multiple loans',
          ],
          category: 'financial',
        },
        {
          id: 'hasDefaultedPayment',
          field: 'Have you ever defaulted on any loan or credit card payment?',
          type: 'yes_no',
          category: 'risk',
        },
        {
          id: 'desiredCreditLimit',
          field: 'What credit limit are you looking for?',
          type: 'multiple_choice',
          options: [
            'Up to ₹50,000',
            '₹50,000 - ₹1,00,000',
            '₹1,00,000 - ₹3,00,000',
            '₹3,00,000 - ₹5,00,000',
            'More than ₹5,00,000',
          ],
          category: 'financial',
        },
      ],
      optional: [
        {
          id: 'wantsAddonCard',
          field: 'Would you like to add an add-on card for a family member?',
          type: 'yes_no',
          category: 'purpose',
        },
        {
          id: 'wantsBalanceTransfer',
          field: 'Are you interested in balance transfer from other cards?',
          type: 'yes_no',
          category: 'financial',
        },
      ],
      passingScore: 1.0, // All fields must be answered
    };

    // =====================================================
    // INVESTMENT ACCOUNT / MUTUAL FUND APPLICATION
    // =====================================================
    const investmentSet: FormFieldSet = {
      required: [
        {
          id: 'investmentObjective',
          field: 'What is your primary investment objective?',
          type: 'multiple_choice',
          options: [
            'Capital preservation (low risk)',
            'Regular income (dividends/interest)',
            'Long-term wealth creation',
            'Tax saving',
            'Retirement planning',
            'Child education/marriage',
          ],
          category: 'purpose',
        },
        {
          id: 'investmentHorizon',
          field: 'What is your investment time horizon?',
          type: 'multiple_choice',
          options: [
            'Less than 1 year',
            '1 - 3 years',
            '3 - 5 years',
            '5 - 10 years',
            'More than 10 years',
          ],
          category: 'risk',
        },
        {
          id: 'riskTolerance',
          field: 'How would you describe your risk tolerance?',
          type: 'multiple_choice',
          options: [
            'Conservative - I cannot afford any loss',
            'Moderately Conservative - Small losses acceptable',
            'Moderate - Balanced risk and return',
            'Moderately Aggressive - Higher risk for higher returns',
            'Aggressive - Maximum returns, high risk acceptable',
          ],
          category: 'risk',
        },
        {
          id: 'householdIncome',
          field: 'What is your annual household income?',
          type: 'multiple_choice',
          options: [
            'Less than ₹5,00,000',
            '₹5,00,000 - ₹10,00,000',
            '₹10,00,000 - ₹25,00,000',
            '₹25,00,000 - ₹50,00,000',
            '₹50,00,000 - ₹1,00,00,000',
            'More than ₹1,00,00,000',
          ],
          category: 'financial',
        },
        {
          id: 'monthlyInvestmentPercent',
          field: 'What percentage of your income can you invest monthly?',
          type: 'multiple_choice',
          options: [
            'Less than 10%',
            '10% - 20%',
            '20% - 30%',
            '30% - 50%',
            'More than 50%',
          ],
          category: 'financial',
        },
        {
          id: 'investmentExperience',
          field: 'What is your prior investment experience?',
          type: 'multiple_choice',
          options: [
            'No experience - First time investor',
            'Beginner - Fixed deposits/Savings only',
            'Intermediate - Mutual funds experience',
            'Advanced - Direct equity/stocks experience',
            'Expert - Derivatives/F&O experience',
          ],
          category: 'knowledge',
        },
        {
          id: 'marketDropResponse',
          field: 'If your investment drops 20% in a month, what would you do?',
          type: 'multiple_choice',
          options: [
            'Sell everything immediately',
            'Sell some to reduce risk',
            'Hold and wait for recovery',
            'Invest more at lower prices',
          ],
          category: 'risk',
        },
        {
          id: 'hasEmergencyFund',
          field: 'Do you have an emergency fund (3-6 months expenses)?',
          type: 'yes_no',
          category: 'financial',
        },
      ],
      optional: [
        {
          id: 'interestedInTaxSaving',
          field: 'Are you interested in tax-saving investments (ELSS)?',
          type: 'yes_no',
          category: 'purpose',
        },
        {
          id: 'investmentPreference',
          field: 'Would you prefer SIP (systematic investment) or lumpsum?',
          type: 'multiple_choice',
          options: [
            'SIP (monthly investment)',
            'Lumpsum investment',
            'Both',
          ],
          category: 'purpose',
        },
      ],
      passingScore: 1.0, // All fields must be answered
    };

    // =====================================================
    // LOAN APPLICATION FORM (Personal/Home/Car)
    // =====================================================
    const loanApplicationSet: FormFieldSet = {
      required: [
        {
          id: 'loanType',
          field: 'What type of loan are you applying for?',
          type: 'multiple_choice',
          options: [
            'Personal Loan',
            'Home Loan',
            'Car/Vehicle Loan',
            'Education Loan',
            'Business Loan',
          ],
          category: 'purpose',
        },
        {
          id: 'loanAmount',
          field: 'What loan amount are you looking for?',
          type: 'multiple_choice',
          options: [
            'Up to ₹1,00,000',
            '₹1,00,000 - ₹5,00,000',
            '₹5,00,000 - ₹10,00,000',
            '₹10,00,000 - ₹25,00,000',
            '₹25,00,000 - ₹50,00,000',
            '₹50,00,000 - ₹1,00,00,000',
            'More than ₹1,00,00,000',
          ],
          category: 'financial',
        },
        {
          id: 'loanTenure',
          field: 'What is your preferred loan tenure?',
          type: 'multiple_choice',
          options: [
            '1 - 2 years',
            '2 - 5 years',
            '5 - 10 years',
            '10 - 15 years',
            '15 - 20 years',
            '20 - 30 years',
          ],
          category: 'financial',
        },
        {
          id: 'employmentType',
          field: 'What is your current employment type?',
          type: 'multiple_choice',
          options: [
            'Salaried - Private',
            'Salaried - Government',
            'Self-employed professional',
            'Self-employed business',
            'Pensioner',
          ],
          category: 'employment',
        },
        {
          id: 'monthlyNetIncome',
          field: 'What is your monthly net income?',
          type: 'multiple_choice',
          options: [
            'Less than ₹25,000',
            '₹25,000 - ₹50,000',
            '₹50,000 - ₹1,00,000',
            '₹1,00,000 - ₹2,00,000',
            'More than ₹2,00,000',
          ],
          category: 'financial',
        },
        {
          id: 'existingEMI',
          field: 'Do you have any existing EMI obligations?',
          type: 'multiple_choice',
          options: [
            'No existing EMIs',
            'Yes, up to ₹10,000/month',
            'Yes, ₹10,000 - ₹25,000/month',
            'Yes, ₹25,000 - ₹50,000/month',
            'Yes, more than ₹50,000/month',
          ],
          category: 'financial',
        },
        {
          id: 'creditScore',
          field: 'What is your CIBIL/Credit score range (if known)?',
          type: 'multiple_choice',
          options: [
            'Not sure / Never checked',
            'Below 600',
            '600 - 700',
            '700 - 750',
            '750 - 800',
            'Above 800',
          ],
          category: 'risk',
        },
        {
          id: 'hasDefaulted',
          field: 'Have you ever defaulted on any loan or credit card?',
          type: 'yes_no',
          category: 'risk',
        },
      ],
      optional: [
        {
          id: 'hasCoApplicant',
          field: 'Do you have a co-applicant for this loan?',
          type: 'yes_no',
          category: 'knowledge',
        },
        {
          id: 'hasCollateral',
          field: 'Do you have collateral/security to offer?',
          type: 'yes_no',
          category: 'financial',
        },
      ],
      passingScore: 1.0, // All fields must be answered
    };

    // Register all field sets
    this.defaultFieldSets.set('account_opening', accountOpeningSet);
    this.defaultFieldSets.set('credit_card', creditCardSet);
    this.defaultFieldSets.set('investment', investmentSet);
    this.defaultFieldSets.set('loan_application', loanApplicationSet);
  }

  /**
   * Get fields for a session
   */
  getFields(
    fieldSetName: string = 'account_opening',
    includeOptional: boolean = false
  ): FormField[] {
    const fieldSet = 
      this.customFieldSets.get(fieldSetName) ||
      this.defaultFieldSets.get(fieldSetName);

    if (!fieldSet) {
      throw new Error(`Field set '${fieldSetName}' not found`);
    }

    const fields = [...fieldSet.required];
    if (includeOptional) {
      fields.push(...fieldSet.optional);
    }

    return fields;
  }

  /**
   * Verify answers against document data
   */
  verifyAnswers(
    fields: FormField[],
    answers: Map<string, string>,
    documentData?: any
  ): FormData {
    const fieldAnswers: FormFieldAnswer[] = [];
    let correctCount = 0;

    for (const field of fields) {
      const userAnswer = answers.get(field.id);
      
      if (!userAnswer) {
        // Skip unanswered fields (optional fields)
        continue;
      }

      const isCorrect = this.verifyAnswer(
        field,
        userAnswer,
        documentData
      );

      if (isCorrect) {
        correctCount++;
      }

      fieldAnswers.push({
        fieldId: field.id,
        field: field.field,
        expectedAnswer: field.answerField && documentData 
          ? documentData[field.answerField]
          : undefined,
        userAnswer,
        isCorrect,
        answeredAt: new Date(),
      });
    }

    const requiredFields = fields.filter(f => 
      this.isRequiredField(f, this.getFieldSetName(fields))
    );
    const score = correctCount / requiredFields.length;
    const passingScore = this.getPassingScore(this.getFieldSetName(fields));
    const passed = score >= passingScore;

    return {
      fields: fieldAnswers,
      score: correctCount,
      passed,
      completedAt: new Date(),
    };
  }

  /**
   * Verify a single answer
   */
  private verifyAnswer(
    field: FormField,
    userAnswer: string,
    documentData?: any
  ): boolean {
    // For form-specific fields WITHOUT answerField (not tied to OCR)
    // These are application fields - just need to be answered
    if (!field.answerField) {
      return this.verifyFormAnswer(field, userAnswer);
    }

    // For document-based fields (with answerField to verify against OCR)
    if (!documentData) {
      // If no document data available but answerField exists, cannot verify
      return false;
    }

    const expectedAnswer = documentData[field.answerField];
    if (!expectedAnswer) {
      return false;
    }

    switch (field.type) {
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
   * Verify form-specific answers (not tied to document data)
   * These fields are considered "correct" if properly answered
   */
  private verifyFormAnswer(field: FormField, userAnswer: string): boolean {
    const trimmedAnswer = userAnswer.trim();
    
    // Check if answer is not empty
    if (!trimmedAnswer) {
      return false;
    }

    switch (field.type) {
      case 'multiple_choice':
        // Verify the answer is one of the valid options
        if (field.options && field.options.length > 0) {
          return field.options.some(
            opt => opt.toLowerCase() === trimmedAnswer.toLowerCase()
          );
        }
        return true;
      
      case 'yes_no':
        // Verify it's a valid yes/no response
        const validResponses = ['yes', 'no', 'y', 'n', 'true', 'false', '1', '0'];
        return validResponses.includes(trimmedAnswer.toLowerCase());
      
      case 'numeric':
        // Verify it's a valid number
        return !isNaN(parseInt(trimmedAnswer, 10));
      
      case 'date':
        // Verify it's a valid date
        const date = new Date(trimmedAnswer);
        return !isNaN(date.getTime());
      
      case 'text':
      default:
        // For text, just ensure it has some content
        return trimmedAnswer.length > 0;
    }
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
   * Add custom field set
   */
  addCustomFieldSet(name: string, fieldSet: FormFieldSet): void {
    this.customFieldSets.set(name, fieldSet);
    console.log(`[FormService] Custom field set '${name}' added`);
  }

  /**
   * Check if field is required
   */
  private isRequiredField(field: FormField, setName: string): boolean {
    const fieldSet = 
      this.customFieldSets.get(setName) ||
      this.defaultFieldSets.get(setName);
    
    if (!fieldSet) {
      return true;
    }
    
    return fieldSet.required.some(f => f.id === field.id);
  }

  /**
   * Get passing score for field set
   */
  private getPassingScore(setName: string): number {
    const fieldSet = 
      this.customFieldSets.get(setName) ||
      this.defaultFieldSets.get(setName);
    
    return fieldSet?.passingScore || 0.8;
  }

  /**
   * Get field set name from fields
   */
  private getFieldSetName(fields: FormField[]): string {
    // Try to identify which set these fields belong to
    for (const [name, set] of this.defaultFieldSets.entries()) {
      if (set.required.length === fields.length) {
        return name;
      }
    }
    
    for (const [name, set] of this.customFieldSets.entries()) {
      if (set.required.length === fields.length) {
        return name;
      }
    }
    
    return 'account_opening';
  }

  /**
   * Get available field sets
   */
  getAvailableFieldSets(): string[] {
    return [
      ...Array.from(this.defaultFieldSets.keys()),
      ...Array.from(this.customFieldSets.keys()),
    ];
  }

  /**
   * Get field set details
   */
  getFieldSetDetails(name: string): FormFieldSet | undefined {
    return (
      this.customFieldSets.get(name) ||
      this.defaultFieldSets.get(name)
    );
  }
}

