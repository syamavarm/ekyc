/**
 * Document Service
 * Handles document upload, storage, and OCR processing
 * Uses Azure Document Intelligence (Form Recognizer) for OCR
 */

import {
  DocumentData,
  DocumentType,
  OCRResults,
} from '../types/kyc.types';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import axios, { AxiosError } from 'axios';

// Azure Document Intelligence API response types
interface AzureAnalyzeResult {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  createdDateTime: string;
  lastUpdatedDateTime: string;
  analyzeResult?: {
    apiVersion: string;
    modelId: string;
    stringIndexType: string;
    content: string;
    documents: AzureDocument[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface AzureDocument {
  docType: string;
  boundingRegions: Array<{
    pageNumber: number;
    polygon: number[];
  }>;
  fields: Record<string, AzureField>;
  confidence: number;
}

interface AzureField {
  type: string;
  valueString?: string;
  valueDate?: string;
  valueCountryRegion?: string;
  valueObject?: Record<string, AzureField>;
  content?: string;
  confidence: number;
}

export class DocumentService {
  private storageDir: string;
  private azureDocumentIntelligenceEndpoint?: string;
  private azureDocumentIntelligenceKey?: string;
  private useMockData: boolean;

  constructor(config?: {
    storageDir?: string;
    azureEndpoint?: string;
    azureKey?: string;
    useMockData?: boolean;
  }) {
    this.storageDir = config?.storageDir || path.join(__dirname, '../../uploads');
    this.azureDocumentIntelligenceEndpoint = config?.azureEndpoint || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    this.azureDocumentIntelligenceKey = config?.azureKey || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    this.useMockData = config?.useMockData ?? (!this.azureDocumentIntelligenceEndpoint || !this.azureDocumentIntelligenceKey);

    // Ensure storage directory exists
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (this.useMockData) {
      console.log('[DocumentService] Running in MOCK mode - Azure credentials not configured');
    } else {
      console.log('[DocumentService] Azure Document Intelligence configured');
    }
  }

  /**
   * Save uploaded document
   */
  async saveDocument(
    fileBuffer: Buffer,
    documentType: DocumentType,
    originalFilename: string
  ): Promise<DocumentData> {
    const documentId = uuidv4();
    const fileExtension = path.extname(originalFilename);
    const filename = `${documentId}${fileExtension}`;
    const filepath = path.join(this.storageDir, filename);

    fs.writeFileSync(filepath, fileBuffer);

    const documentData: DocumentData = {
      documentId,
      documentType,
      uploadedAt: new Date(),
      imageUrl: `/uploads/${filename}`,
      imageBuffer: fileBuffer,
      isValid: false,
    };

    console.log(`[DocumentService] Document saved: ${documentId}`);
    return documentData;
  }

  /**
   * Save both front and back sides of a document
   */
  async saveDocumentBothSides(
    frontBuffer: Buffer,
    backBuffer: Buffer,
    documentType: DocumentType,
    originalFilename: string
  ): Promise<DocumentData> {
    const documentId = uuidv4();
    const fileExtension = path.extname(originalFilename) || '.jpg';
    
    // Save front side
    const frontFilename = `${documentId}-front${fileExtension}`;
    const frontFilepath = path.join(this.storageDir, frontFilename);
    fs.writeFileSync(frontFilepath, frontBuffer);
    
    // Save back side
    const backFilename = `${documentId}-back${fileExtension}`;
    const backFilepath = path.join(this.storageDir, backFilename);
    fs.writeFileSync(backFilepath, backBuffer);

    const documentData: DocumentData = {
      documentId,
      documentType,
      uploadedAt: new Date(),
      imageUrl: `/uploads/${frontFilename}`,
      imageBuffer: frontBuffer,
      isValid: false,
      backImageUrl: `/uploads/${backFilename}`,
      backImageBuffer: backBuffer,
    };

    console.log(`[DocumentService] Document (both sides) saved: ${documentId}`);
    console.log(`[DocumentService] Front: ${frontFilename}, Back: ${backFilename}`);
    return documentData;
  }

  /**
   * Perform OCR on document using Azure Document Intelligence
   */
  async performOCR(documentData: DocumentData): Promise<OCRResults> {
    try {
      console.log(`[DocumentService] Starting OCR for document: ${documentData.documentId}`);
      const hasBothSides = !!documentData.backImageBuffer;
      
      let ocrResults: OCRResults;

      if (this.useMockData) {
        console.log(`[DocumentService] Using mock OCR data`);
        ocrResults = this.generateMockOCRResults(documentData.documentType);
      } else {
        console.log(`[DocumentService] Calling Azure Document Intelligence API`);
        
        // Process front side
        console.log(`[DocumentService] Processing FRONT side...`);
        const frontResults = await this.azureDocumentIntelligenceOCR(documentData);
        
        // If back side exists, process it and merge results
        if (hasBothSides && documentData.backImageBuffer) {
          console.log(`[DocumentService] Processing BACK side...`);
          const backDocumentData: DocumentData = {
            ...documentData,
            imageBuffer: documentData.backImageBuffer,
          };
          const backResults = await this.azureDocumentIntelligenceOCR(backDocumentData);
          
          // Merge front and back results
          ocrResults = this.mergeOCRResults(frontResults, backResults);
          console.log(`[DocumentService] Merged OCR results from front and back sides`);
        } else {
          ocrResults = frontResults;
        }
      }
      
      console.log(`[DocumentService] OCR completed for document: ${documentData.documentId}`);
      return ocrResults;
    } catch (error) {
      console.error('[DocumentService] Error performing OCR:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to perform OCR on document: ${error.message}`);
      }
      throw new Error('Failed to perform OCR on document');
    }
  }

  /**
   * Merge OCR results from front and back sides of document
   */
  private mergeOCRResults(frontResults: OCRResults, backResults: OCRResults): OCRResults {
    console.log('[DocumentService] Merging OCR results from both sides...');
    
    const mergedData = {
      ...frontResults.extractedData,
      // Override with back side data if front side is missing it
      address: frontResults.extractedData.address || backResults.extractedData.address,
      // Some IDs have additional fields on back
      ...Object.fromEntries(
        Object.entries(backResults.extractedData).filter(([key, value]) => {
          const frontValue = (frontResults.extractedData as any)[key];
          return value && (!frontValue || frontValue === '');
        })
      ),
    };
    
    const avgConfidence = ((frontResults.confidence || 0) + (backResults.confidence || 0)) / 2;
    
    return {
      ...frontResults,
      extractedData: mergedData,
      confidence: avgConfidence,
    };
  }

  /**
   * Azure Document Intelligence OCR
   */
  private async azureDocumentIntelligenceOCR(documentData: DocumentData): Promise<OCRResults> {
    if (!this.azureDocumentIntelligenceEndpoint || !this.azureDocumentIntelligenceKey) {
      throw new Error('Azure Document Intelligence credentials not configured');
    }

    const baseEndpoint = this.azureDocumentIntelligenceEndpoint.replace(/\/$/, '');
    const analyzeEndpoint = `${baseEndpoint}/documentintelligence/documentModels/prebuilt-idDocument:analyze?api-version=2024-11-30&stringIndexType=utf16CodeUnit`;
    
    console.log(`[DocumentService] Submitting document to Azure: ${analyzeEndpoint}`);

    try {
      const submitResponse = await axios.post(
        analyzeEndpoint,
        documentData.imageBuffer,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Ocp-Apim-Subscription-Key': this.azureDocumentIntelligenceKey,
          },
        }
      );

      const operationLocation = submitResponse.headers['operation-location'];
      if (!operationLocation) {
        throw new Error('No operation-location header in Azure response');
      }

      console.log(`[DocumentService] Analysis submitted, polling: ${operationLocation}`);

      const result = await this.pollForAnalysisResult(operationLocation);
      return this.parseAzureOCRResults(result, documentData.documentType);
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as { error?: { message?: string } } | undefined;
        
        if (status === 401) throw new Error('Azure Document Intelligence: Invalid API key');
        if (status === 404) throw new Error('Azure Document Intelligence: Endpoint not found');
        if (status === 429) throw new Error('Azure Document Intelligence: Rate limit exceeded');
        
        throw new Error(`Azure Document Intelligence error: ${errorData?.error?.message || axiosError.message}`);
      }
      throw error;
    }
  }

  /**
   * Poll Azure for analysis completion
   */
  private async pollForAnalysisResult(
    operationLocation: string,
    maxAttempts: number = 30,
    intervalMs: number = 1000
  ): Promise<AzureAnalyzeResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get<AzureAnalyzeResult>(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': this.azureDocumentIntelligenceKey!,
        },
      });

      const { status } = response.data;

      if (status === 'succeeded') {
        console.log(`[DocumentService] Analysis succeeded after ${attempt + 1} attempts`);
        return response.data;
      }
      
      if (status === 'failed') {
        throw new Error(`Azure analysis failed: ${response.data.error?.message || 'Unknown error'}`);
      }

      console.log(`[DocumentService] Analysis status: ${status}, attempt ${attempt + 1}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Azure analysis timed out after ${maxAttempts} attempts`);
  }

  /**
   * Parse Azure Document Intelligence response into OCRResults
   */
  private parseAzureOCRResults(azureResult: AzureAnalyzeResult, documentType: DocumentType): OCRResults {
    const analyzeResult = azureResult.analyzeResult;
    
    if (!analyzeResult?.documents?.length) {
      return {
        documentType,
        extractedData: {},
        confidence: 0,
        processedAt: new Date(),
        rawResponse: azureResult,
      };
    }

    const doc = analyzeResult.documents[0];
    const fields = doc.fields;
    const extractedData: OCRResults['extractedData'] = {};

    // Full name
    if (fields.FirstName?.valueString && fields.LastName?.valueString) {
      extractedData.firstName = fields.FirstName.valueString;
      extractedData.lastName = fields.LastName.valueString;
      extractedData.fullName = `${fields.FirstName.valueString} ${fields.LastName.valueString}`;
    }

    // Date of birth
    if (fields.DateOfBirth?.valueDate) {
      extractedData.dateOfBirth = fields.DateOfBirth.valueDate;
    }

    // Document number
    const documentNumberField = 
      fields.DocumentNumber?.valueString ||
      fields.MachineReadableZone?.valueObject?.DocumentNumber?.valueString ||
      fields.IDNumber?.valueString;
    if (documentNumberField) {
      extractedData.documentNumber = documentNumberField;
    }

    // Expiry date
    if (fields.DateOfExpiration?.valueDate) {
      extractedData.expiryDate = fields.DateOfExpiration.valueDate;
    }

    // Issue date
    if (fields.DateOfIssue?.valueDate) {
      extractedData.issueDate = fields.DateOfIssue.valueDate;
    }

    // Nationality
    if (fields.CountryRegion?.valueCountryRegion) {
      extractedData.nationality = fields.CountryRegion.valueCountryRegion;
    }

    // Gender
    if (fields.Sex?.valueString) {
      extractedData.gender = fields.Sex.valueString;
    }

    // Address
    if (fields.Address?.content) {
      extractedData.address = fields.Address.content;
    }

    // Place of birth
    if (fields.PlaceOfBirth?.valueString) {
      extractedData.placeOfBirth = fields.PlaceOfBirth.valueString;
    }

    return {
      documentType,
      extractedData,
      confidence: doc.confidence,
      processedAt: new Date(),
      rawResponse: azureResult,
    };
  }

  /**
   * Analyze document - just performs OCR and saves results
   */
  async analyzeDocument(documentData: DocumentData): Promise<{ 
    ocrResults: OCRResults; 
    ocrResultsUrl: string | null 
  }> {
    console.log('[DocumentService] Starting document analysis (OCR only)');
    
    const ocrResults = await this.performOCR(documentData);
    console.log(`[DocumentService] OCR confidence: ${(ocrResults.confidence * 100).toFixed(1)}%`);

    // Save OCR results to uploads folder
    const ocrResultsFilename = `${documentData.documentId}-ocr-results.json`;
    const ocrResultsPath = path.join(this.storageDir, ocrResultsFilename);
    const ocrResultsUrl = `/uploads/${ocrResultsFilename}`;
    
    const ocrResultsForStorage = {
      ...ocrResults,
      rawResponse: undefined, // Don't store raw response
    };
    
    fs.writeFileSync(ocrResultsPath, JSON.stringify(ocrResultsForStorage, null, 2));
    console.log(`[DocumentService] OCR results saved: ${ocrResultsPath}`);

    return { ocrResults, ocrResultsUrl };
  }

  /**
   * Generate mock OCR results for testing
   */
  private generateMockOCRResults(documentType: DocumentType): OCRResults {
    return {
      documentType,
      extractedData: {
        fullName: 'John Michael Doe',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1990-01-15',
        documentNumber: 'AB1234567',
        expiryDate: '2030-12-31',
        issueDate: '2020-01-01',
        nationality: 'USA',
        gender: 'M',
        address: '123 Main Street, San Francisco, CA 94102',
        placeOfBirth: 'New York, NY',
      },
      confidence: 0.95,
      processedAt: new Date(),
      rawResponse: { mock: true },
    };
  }

  /**
   * Validate document data extracted from OCR
   */
  validateDocumentData(ocrResults: OCRResults): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!ocrResults.extractedData.fullName && 
        (!ocrResults.extractedData.firstName || !ocrResults.extractedData.lastName)) {
      errors.push('Name is missing or incomplete');
    }

    if (!ocrResults.extractedData.dateOfBirth) {
      errors.push('Date of birth is missing');
    } else {
      const dob = new Date(ocrResults.extractedData.dateOfBirth);
      if (isNaN(dob.getTime())) {
        errors.push('Invalid date of birth format');
      } else {
        const age = this.calculateAge(dob);
        if (age < 18) errors.push('User must be at least 18 years old');
        if (age > 120) errors.push('Invalid date of birth');
      }
    }

    if (!ocrResults.extractedData.documentNumber) {
      errors.push('Document number is missing');
    }

    if (ocrResults.extractedData.expiryDate) {
      if (new Date(ocrResults.extractedData.expiryDate) < new Date()) {
        errors.push('Document has expired');
      }
    }

    if (ocrResults.confidence < 0.7) {
      errors.push('Document quality is too low. Please provide a clearer image');
    }

    return { isValid: errors.length === 0, errors };
  }

  private calculateAge(dob: Date): number {
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * Delete document file
   */
  deleteDocument(documentId: string): void {
    const files = fs.readdirSync(this.storageDir);
    const file = files.find(f => f.startsWith(documentId));
    if (file) {
      fs.unlinkSync(path.join(this.storageDir, file));
      console.log(`[DocumentService] Document deleted: ${documentId}`);
    }
  }
}
