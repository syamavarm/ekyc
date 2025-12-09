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
  boundingRegions?: Array<{
    pageNumber: number;
    polygon: number[];
  }>;
}

// Azure Layout Analysis response types
interface AzureLayoutResult {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  createdDateTime: string;
  lastUpdatedDateTime: string;
  analyzeResult?: {
    apiVersion: string;
    modelId: string;
    content: string;
    pages: AzureLayoutPage[];
    figures?: AzureLayoutFigure[];
  };
  error?: {
    code: string;
    message: string;
  };
}

interface AzureLayoutPage {
  pageNumber: number;
  width: number;
  height: number;
  unit: string;
  words?: Array<{
    content: string;
    polygon: number[];
    confidence: number;
  }>;
}

interface AzureLayoutFigure {
  id: string;
  boundingRegions: Array<{
    pageNumber: number;
    polygon: number[];
  }>;
  spans: Array<{
    offset: number;
    length: number;
  }>;
  caption?: {
    content: string;
    boundingRegions: Array<{
      pageNumber: number;
      polygon: number[];
    }>;
  };
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

    // Save file to disk
    fs.writeFileSync(filepath, fileBuffer);

    const documentData: DocumentData = {
      documentId,
      documentType,
      uploadedAt: new Date(),
      imageUrl: `/uploads/${filename}`,
      imageBuffer: fileBuffer,
      isValid: false, // Will be set after OCR
    };

    console.log(`[DocumentService] Document saved: ${documentId}`);
    return documentData;
  }

  /**
   * Perform OCR on document using Azure Document Intelligence (Form Recognizer)
   */
  async performOCR(
    documentData: DocumentData
  ): Promise<OCRResults> {
    try {
      console.log(`[DocumentService] Starting OCR for document: ${documentData.documentId}`);

      let ocrResults: OCRResults;

      if (this.useMockData) {
        console.log(`[DocumentService] Using mock OCR data`);
        ocrResults = this.generateMockOCRResults(documentData.documentType);
      } else {
        console.log(`[DocumentService] Calling Azure Document Intelligence API`);
        ocrResults = await this.azureDocumentIntelligenceOCR(documentData);
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
   * Azure Document Intelligence OCR integration
   * Uses the prebuilt-idDocument model for ID document analysis
   */
  private async azureDocumentIntelligenceOCR(
    documentData: DocumentData
  ): Promise<OCRResults> {
    if (!this.azureDocumentIntelligenceEndpoint || !this.azureDocumentIntelligenceKey) {
      throw new Error('Azure Document Intelligence credentials not configured');
    }

    // Remove trailing slash from endpoint if present
    const baseEndpoint = this.azureDocumentIntelligenceEndpoint.replace(/\/$/, '');
    
    // Use prebuilt-idDocument model for ID documents
    // Note: Use /formrecognizer/ path for Form Recognizer resources
    const analyzeEndpoint = `${baseEndpoint}/formrecognizer/documentModels/prebuilt-idDocument:analyze?api-version=2023-07-31`;
    
    console.log(`[DocumentService] Submitting document to Azure: ${analyzeEndpoint}`);

    try {
      // Step 1: Submit document for analysis
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

      // Get operation location from response headers
      const operationLocation = submitResponse.headers['operation-location'];
      
      if (!operationLocation) {
        throw new Error('No operation-location header in Azure response');
      }

      console.log(`[DocumentService] Analysis submitted, polling: ${operationLocation}`);

      // Step 2: Poll for results
      const result = await this.pollForAnalysisResult(operationLocation);
      
      // Step 3: Parse and return OCR results
      return this.parseAzureOCRResults(result, documentData.documentType);
      
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const errorData = axiosError.response?.data as { error?: { message?: string } } | undefined;
        
        if (status === 401) {
          throw new Error('Azure Document Intelligence: Invalid API key');
        } else if (status === 404) {
          throw new Error('Azure Document Intelligence: Endpoint not found');
        } else if (status === 429) {
          throw new Error('Azure Document Intelligence: Rate limit exceeded');
        }
        
        const errorMessage = errorData?.error?.message || axiosError.message;
        throw new Error(`Azure Document Intelligence error: ${errorMessage}`);
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
        const errorMessage = response.data.error?.message || 'Unknown error';
        throw new Error(`Azure analysis failed: ${errorMessage}`);
      }

      // Status is 'running' or 'notStarted', wait and retry
      console.log(`[DocumentService] Analysis status: ${status}, attempt ${attempt + 1}/${maxAttempts}`);
      await this.sleep(intervalMs);
    }

    throw new Error(`Azure analysis timed out after ${maxAttempts} attempts`);
  }

  /**
   * Parse Azure Document Intelligence response into OCRResults
   */
  private parseAzureOCRResults(
    azureResult: AzureAnalyzeResult,
    documentType: DocumentType
  ): OCRResults {
    const analyzeResult = azureResult.analyzeResult;
    
    if (!analyzeResult || !analyzeResult.documents || analyzeResult.documents.length === 0) {
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

    // Map Azure field names to our standard field names
    const extractedData: OCRResults['extractedData'] = {};

    // Full name extraction
    if (fields.FirstName?.valueString && fields.LastName?.valueString) {
      extractedData.firstName = fields.FirstName.valueString;
      extractedData.lastName = fields.LastName.valueString;
      extractedData.fullName = `${fields.FirstName.valueString} ${fields.LastName.valueString}`;
    }

    // Date of birth
    if (fields.DateOfBirth?.valueDate) {
      extractedData.dateOfBirth = fields.DateOfBirth.valueDate;
    }

    // Document number (varies by document type)
    const mrzDocNumber = fields.MachineReadableZone?.valueObject?.DocumentNumber?.valueString;
    const documentNumberField = 
      fields.DocumentNumber?.valueString ||
      mrzDocNumber ||
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

    // Nationality / Country
    if (fields.CountryRegion?.valueCountryRegion) {
      extractedData.nationality = fields.CountryRegion.valueCountryRegion;
    }

    // Gender / Sex
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

    // Store photo region if available for later extraction
    if (fields.Photo?.boundingRegions) {
      extractedData.photoRegion = fields.Photo.boundingRegions;
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
   * Helper to sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Azure Layout Analysis for extracting photos/figures from documents
   * Uses the prebuilt-layout model to detect figures in the document
   */
  async extractPhotoWithLayoutModel(
    documentData: DocumentData
  ): Promise<{ photoBuffer: Buffer | null; photoRegion: any | null }> {
    if (this.useMockData) {
      console.log('[DocumentService] Layout analysis skipped in mock mode');
      return { photoBuffer: null, photoRegion: null };
    }

    if (!this.azureDocumentIntelligenceEndpoint || !this.azureDocumentIntelligenceKey) {
      console.log('[DocumentService] Azure credentials not configured for layout analysis');
      return { photoBuffer: null, photoRegion: null };
    }

    try {
      console.log('[DocumentService] Starting layout analysis for photo extraction');
      
      const baseEndpoint = this.azureDocumentIntelligenceEndpoint.replace(/\/$/, '');
      // Use prebuilt-layout with formrecognizer path (stable API)
      const analyzeEndpoint = `${baseEndpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30&stringIndexType=utf16CodeUnit&output=figures`;
      
      console.log(`[DocumentService] Submitting to layout model: ${analyzeEndpoint}`);

      // Submit document for layout analysis
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
        throw new Error('No operation-location header in layout response');
      }

      console.log(`[DocumentService] Layout analysis submitted, polling...`);

      // Poll for results
      const result = await this.pollForLayoutResult(operationLocation);

      console.log(`[DocumentService] Layout result: ${JSON.stringify(result)}`);
      
      // Extract photo from layout results
      return await this.extractPhotoFromLayoutResult(result, documentData);
      
    } catch (error) {
      console.error('[DocumentService] Layout analysis error:', error);
      return { photoBuffer: null, photoRegion: null };
    }
  }

  /**
   * Poll Azure for layout analysis completion
   */
  private async pollForLayoutResult(
    operationLocation: string,
    maxAttempts: number = 30,
    intervalMs: number = 1000
  ): Promise<AzureLayoutResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get<AzureLayoutResult>(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': this.azureDocumentIntelligenceKey!,
        },
      });

      const { status } = response.data;

      if (status === 'succeeded') {
        console.log(`[DocumentService] Layout analysis succeeded after ${attempt + 1} attempts`);
        return response.data;
      }
      
      if (status === 'failed') {
        const errorMessage = response.data.error?.message || 'Unknown error';
        throw new Error(`Layout analysis failed: ${errorMessage}`);
      }

      console.log(`[DocumentService] Layout status: ${status}, attempt ${attempt + 1}/${maxAttempts}`);
      await this.sleep(intervalMs);
    }

    throw new Error(`Layout analysis timed out after ${maxAttempts} attempts`);
  }

  /**
   * Extract photo from layout analysis results
   * Looks for figures in the layout response and extracts the largest one (likely the ID photo)
   */
  private async extractPhotoFromLayoutResult(
    layoutResult: AzureLayoutResult,
    documentData: DocumentData
  ): Promise<{ photoBuffer: Buffer | null; photoRegion: any | null }> {
    const analyzeResult = layoutResult.analyzeResult;
    const pages = analyzeResult?.pages;
    const figures = analyzeResult?.figures;

    // Log what we received from layout API
    console.log(`[DocumentService] Layout result - pages: ${pages?.length || 0}, figures: ${figures?.length || 0}`);
    
    // Check if figures exist in the response (even at different paths)
    const rawResult = layoutResult as any;
    if (!figures && rawResult.analyzeResult) {
      console.log(`[DocumentService] Available keys in analyzeResult: ${Object.keys(rawResult.analyzeResult).join(', ')}`);
    }

    // If figures are available, use them
    if (figures && figures.length > 0) {
      console.log(`[DocumentService] Found ${figures.length} figure(s) in document`);
      
      let largestFigure = figures[0];
      let largestArea = 0;

      for (const figure of figures) {
        if (figure.boundingRegions && figure.boundingRegions.length > 0) {
          const polygon = figure.boundingRegions[0].polygon;
          const area = this.calculatePolygonArea(polygon);
          console.log(`[DocumentService] Figure ${figure.id}: area=${area.toFixed(0)}`);
          
          if (area > largestArea) {
            largestArea = area;
            largestFigure = figure;
          }
        }
      }

      if (largestFigure.boundingRegions && largestFigure.boundingRegions.length > 0) {
        const region = largestFigure.boundingRegions[0];
        const page = pages?.[0];
        return await this.cropPhotoFromRegion(region, documentData, page);
      }
    }

    // Heuristic approach: Find the photo region by analyzing text-free areas
    console.log('[DocumentService] Using heuristic photo detection for ID card');
    
    if (!pages || pages.length === 0 || !documentData.imageBuffer) {
      return { photoBuffer: null, photoRegion: null };
    }

    try {
      // @ts-ignore - sharp is an optional dependency
      const sharp = await import('sharp');
      
      // Get actual image dimensions
      const metadata = await sharp.default(documentData.imageBuffer).metadata();
      const imgWidth = metadata.width || 1;
      const imgHeight = metadata.height || 1;
      
      console.log(`[DocumentService] Image dimensions: ${imgWidth}x${imgHeight}`);

      // For ID cards (driver's license, passport, etc.), photo is typically:
      // - Left side for driver's licenses (left 35%)
      // - Right side for some passports
      // We'll use the left side heuristic which covers most ID cards
      
      // Calculate photo region (left 35% of image, top 75% height)
      const photoLeft = Math.round(imgWidth * 0.02);  // 2% margin from left
      const photoTop = Math.round(imgHeight * 0.15);  // 15% from top
      const photoWidth = Math.round(imgWidth * 0.33); // 33% width
      const photoHeight = Math.round(imgHeight * 0.65); // 65% height

      console.log(`[DocumentService] Heuristic photo region: left=${photoLeft}, top=${photoTop}, width=${photoWidth}, height=${photoHeight}`);

      // Extract the photo region
      const photoBuffer = await sharp.default(documentData.imageBuffer)
        .extract({
          left: photoLeft,
          top: photoTop,
          width: photoWidth,
          height: photoHeight
        })
        .toBuffer();

      const photoRegion = {
        pageNumber: 1,
        polygon: [
          photoLeft, photoTop,
          photoLeft + photoWidth, photoTop,
          photoLeft + photoWidth, photoTop + photoHeight,
          photoLeft, photoTop + photoHeight
        ]
      };

      console.log(`[DocumentService] Heuristic photo extracted: ${photoBuffer.length} bytes`);
      return { photoBuffer, photoRegion };

    } catch (error) {
      console.error('[DocumentService] Heuristic photo extraction failed:', error);
      return { photoBuffer: null, photoRegion: null };
    }
  }

  /**
   * Crop photo from document using bounding region
   */
  private async cropPhotoFromRegion(
    region: { pageNumber: number; polygon: number[] },
    documentData: DocumentData,
    page?: AzureLayoutPage
  ): Promise<{ photoBuffer: Buffer | null; photoRegion: any }> {
    const polygon = region.polygon;
    
    if (!polygon || polygon.length < 8 || !documentData.imageBuffer) {
      return { photoBuffer: null, photoRegion: region };
    }

    // Calculate bounding box from polygon
    const xCoords = [polygon[0], polygon[2], polygon[4], polygon[6]];
    const yCoords = [polygon[1], polygon[3], polygon[5], polygon[7]];
    
    let left = Math.min(...xCoords);
    let top = Math.min(...yCoords);
    let right = Math.max(...xCoords);
    let bottom = Math.max(...yCoords);
    
    // If page dimensions are in inches, convert to pixels (assuming 72 DPI for PDF, need actual image dimensions)
    // For images, coordinates are usually in pixels already
    
    let width = right - left;
    let height = bottom - top;

    console.log(`[DocumentService] Photo crop region: left=${left.toFixed(0)}, top=${top.toFixed(0)}, width=${width.toFixed(0)}, height=${height.toFixed(0)}`);

    try {
      // @ts-ignore - sharp is an optional dependency
      const sharp = await import('sharp');
      
      // Get actual image dimensions
      const metadata = await sharp.default(documentData.imageBuffer).metadata();
      const imgWidth = metadata.width || 1;
      const imgHeight = metadata.height || 1;
      
      console.log(`[DocumentService] Image dimensions: ${imgWidth}x${imgHeight}`);
      
      // If Azure returned coordinates in a different scale, normalize them
      if (page && page.unit === 'inch') {
        // Convert inches to pixels (assuming 72 DPI base, scale to actual image)
        const scaleX = imgWidth / (page.width * 72);
        const scaleY = imgHeight / (page.height * 72);
        left *= 72 * scaleX;
        top *= 72 * scaleY;
        width *= 72 * scaleX;
        height *= 72 * scaleY;
      } else if (page) {
        // Scale coordinates to actual image dimensions
        const scaleX = imgWidth / page.width;
        const scaleY = imgHeight / page.height;
        left *= scaleX;
        top *= scaleY;
        width *= scaleX;
        height *= scaleY;
      }

      // Ensure coordinates are within bounds
      left = Math.max(0, Math.round(left));
      top = Math.max(0, Math.round(top));
      width = Math.min(imgWidth - left, Math.round(width));
      height = Math.min(imgHeight - top, Math.round(height));

      console.log(`[DocumentService] Adjusted crop: left=${left}, top=${top}, width=${width}, height=${height}`);

      if (width <= 0 || height <= 0) {
        console.log('[DocumentService] Invalid crop dimensions');
        return { photoBuffer: null, photoRegion: region };
      }

      const photoBuffer = await sharp.default(documentData.imageBuffer)
        .extract({ left, top, width, height })
        .toBuffer();
      
      console.log(`[DocumentService] Photo extracted successfully: ${photoBuffer.length} bytes`);
      return { photoBuffer, photoRegion: region };
      
    } catch (error) {
      console.error('[DocumentService] Photo crop error:', error);
      return { photoBuffer: null, photoRegion: region };
    }
  }

  /**
   * Calculate area of a polygon from coordinate array
   */
  private calculatePolygonArea(polygon: number[]): number {
    if (polygon.length < 8) return 0;
    
    // Shoelace formula for polygon area
    const n = polygon.length / 2;
    let area = 0;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += polygon[i * 2] * polygon[j * 2 + 1];
      area -= polygon[j * 2] * polygon[i * 2 + 1];
    }
    
    return Math.abs(area) / 2;
  }

  /**
   * Perform complete document analysis (OCR + Photo extraction)
   * Uses prebuilt-idDocument for OCR and prebuilt-layout for photo extraction
   * Layout model provides more accurate photo coordinates than the Photo field in OCR
   * Saves OCR results and extracted photo to uploads folder
   */
  async analyzeDocument(
    documentData: DocumentData
  ): Promise<{ ocrResults: OCRResults; photoBuffer: Buffer | null; photoUrl: string | null; ocrResultsUrl: string | null }> {
    console.log('[DocumentService] Starting complete document analysis');
    console.log('[DocumentService] Calling prebuilt-idDocument (OCR) and prebuilt-layout (Photo) in parallel...');
    
    // Run both models in parallel for speed
    const [ocrResults, layoutResult] = await Promise.all([
      this.performOCR(documentData),
      this.extractPhotoWithLayoutModel(documentData)
    ]);
    
    console.log(`[DocumentService] OCR confidence: ${(ocrResults.confidence * 100).toFixed(1)}%`);
    console.log(`[DocumentService] Layout photo extracted: ${layoutResult.photoBuffer ? 'Yes' : 'No'}`);

    // Use layout model results for photo (more accurate than OCR Photo field)
    let photoBuffer = layoutResult.photoBuffer;
    
    // Update photo region in OCR results with layout model coordinates
    if (layoutResult.photoRegion) {
      ocrResults.extractedData.photoRegion = [layoutResult.photoRegion];
      console.log(`[DocumentService] Photo region from layout: [${layoutResult.photoRegion.polygon.join(', ')}]`);
    }
    
    // Fallback to OCR Photo field only if layout model didn't find a photo
    if (!photoBuffer && ocrResults.extractedData.photoRegion && ocrResults.extractedData.photoRegion.length > 0) {
      console.log('[DocumentService] Fallback: Trying OCR Photo field...');
      const photoResult = await this.extractPhotoFromOCRRegion(ocrResults, documentData);
      photoBuffer = photoResult.photoBuffer;
      
      if (photoBuffer) {
        console.log(`[DocumentService] Photo extracted from OCR Photo field: ${photoBuffer.length} bytes`);
      }
    }

    // Save extracted photo to uploads folder
    let photoUrl: string | null = null;
    if (photoBuffer) {
      const photoFilename = `${documentData.documentId}-photo.jpg`;
      const photoPath = path.join(this.storageDir, photoFilename);
      
      fs.writeFileSync(photoPath, photoBuffer);
      photoUrl = `/uploads/${photoFilename}`;
      
      console.log(`[DocumentService] Extracted photo saved: ${photoPath}`);
      
      // Also store in OCR results
      ocrResults.photoUrl = photoUrl;
      ocrResults.photoBuffer = photoBuffer;
    } else {
      console.log('[DocumentService] No photo could be extracted');
    }

    // Save OCR results to uploads folder (without the buffer to keep JSON clean)
    const ocrResultsFilename = `${documentData.documentId}-ocr-results.json`;
    const ocrResultsPath = path.join(this.storageDir, ocrResultsFilename);
    const ocrResultsUrl = `/uploads/${ocrResultsFilename}`;
    
    // Create a copy without the buffer for JSON storage
    const ocrResultsForStorage = {
      ...ocrResults,
      photoBuffer: undefined, // Don't store buffer in JSON
      rawResponse: undefined, // Don't store raw response to keep file smaller
    };
    
    fs.writeFileSync(ocrResultsPath, JSON.stringify(ocrResultsForStorage, null, 2));
    console.log(`[DocumentService] OCR results saved: ${ocrResultsPath}`);

    console.log('[DocumentService] Document analysis complete');

    return {
      ocrResults,
      photoBuffer,
      photoUrl,
      ocrResultsUrl
    };
  }

  /**
   * Extract photo using the Photo field bounding region from OCR results
   * This uses the exact coordinates returned by Azure's prebuilt-idDocument model
   */
  private async extractPhotoFromOCRRegion(
    ocrResults: OCRResults,
    documentData: DocumentData
  ): Promise<{ photoBuffer: Buffer | null }> {
    const photoRegion = ocrResults.extractedData.photoRegion;
    
    if (!photoRegion || photoRegion.length === 0 || !documentData.imageBuffer) {
      return { photoBuffer: null };
    }

    const region = photoRegion[0];
    const polygon = region.polygon;
    
    if (!polygon || polygon.length < 8) {
      console.log('[DocumentService] Invalid photo polygon from OCR');
      return { photoBuffer: null };
    }

    try {
      // @ts-ignore - sharp is an optional dependency
      const sharp = await import('sharp');
      
      // Get actual image dimensions
      const metadata = await sharp.default(documentData.imageBuffer).metadata();
      const imgWidth = metadata.width || 1;
      const imgHeight = metadata.height || 1;
      
      console.log(`[DocumentService] Image dimensions: ${imgWidth}x${imgHeight}`);
      console.log(`[DocumentService] Photo polygon from OCR: [${polygon.join(', ')}]`);

      // Calculate bounding box from polygon
      // Polygon format: [x1, y1, x2, y2, x3, y3, x4, y4]
      const xCoords = [polygon[0], polygon[2], polygon[4], polygon[6]];
      const yCoords = [polygon[1], polygon[3], polygon[5], polygon[7]];
      
      let left = Math.min(...xCoords);
      let top = Math.min(...yCoords);
      let width = Math.max(...xCoords) - left;
      let height = Math.max(...yCoords) - top;

      // Ensure coordinates are within bounds
      left = Math.max(0, Math.round(left));
      top = Math.max(0, Math.round(top));
      width = Math.min(imgWidth - left, Math.round(width));
      height = Math.min(imgHeight - top, Math.round(height));

      console.log(`[DocumentService] Photo crop region: left=${left}, top=${top}, width=${width}, height=${height}`);

      if (width <= 0 || height <= 0) {
        console.log('[DocumentService] Invalid crop dimensions');
        return { photoBuffer: null };
      }

      const photoBuffer = await sharp.default(documentData.imageBuffer)
        .extract({ left, top, width, height })
        .toBuffer();
      
      console.log(`[DocumentService] Photo extracted from OCR region: ${photoBuffer.length} bytes`);
      return { photoBuffer };
      
    } catch (error) {
      console.error('[DocumentService] Photo extraction from OCR region failed:', error);
      return { photoBuffer: null };
    }
  }

  /**
   * Extract photo from ID document using the Photo field bounding region
   * @deprecated Use extractPhotoFromOCRRegion instead
   */
  private async cropPhotoFromIdDocument(
    ocrResults: OCRResults,
    documentData: DocumentData
  ): Promise<{ photoBuffer: Buffer | null }> {
    const photoRegion = ocrResults.extractedData.photoRegion;
    
    if (!photoRegion || photoRegion.length === 0 || !documentData.imageBuffer) {
      return { photoBuffer: null };
    }

    const region = photoRegion[0];
    const polygon = region.polygon;
    
    if (!polygon || polygon.length < 8) {
      console.log('[DocumentService] Invalid photo polygon from OCR');
      return { photoBuffer: null };
    }

    try {
      // @ts-ignore - sharp is an optional dependency
      const sharp = await import('sharp');
      
      // Get actual image dimensions
      const metadata = await sharp.default(documentData.imageBuffer).metadata();
      const imgWidth = metadata.width || 1;
      const imgHeight = metadata.height || 1;
      
      console.log(`[DocumentService] Image dimensions: ${imgWidth}x${imgHeight}`);

      // Calculate bounding box from polygon (Azure returns pixel coordinates for images)
      const xCoords = [polygon[0], polygon[2], polygon[4], polygon[6]];
      const yCoords = [polygon[1], polygon[3], polygon[5], polygon[7]];
      
      let left = Math.min(...xCoords);
      let top = Math.min(...yCoords);
      let width = Math.max(...xCoords) - left;
      let height = Math.max(...yCoords) - top;

      // Ensure coordinates are within bounds
      left = Math.max(0, Math.round(left));
      top = Math.max(0, Math.round(top));
      width = Math.min(imgWidth - left, Math.round(width));
      height = Math.min(imgHeight - top, Math.round(height));

      console.log(`[DocumentService] Photo crop: left=${left}, top=${top}, width=${width}, height=${height}`);

      if (width <= 0 || height <= 0) {
        console.log('[DocumentService] Invalid crop dimensions');
        return { photoBuffer: null };
      }

      const photoBuffer = await sharp.default(documentData.imageBuffer)
        .extract({ left, top, width, height })
        .toBuffer();
      
      console.log(`[DocumentService] Photo extracted: ${photoBuffer.length} bytes`);
      return { photoBuffer };
      
    } catch (error) {
      console.error('[DocumentService] Photo extraction error:', error);
      return { photoBuffer: null };
    }
  }

  /**
   * Generate mock OCR results for testing
   */
  private generateMockOCRResults(documentType: DocumentType): OCRResults {
    const mockData: OCRResults = {
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

    return mockData;
  }

  /**
   * Validate document data extracted from OCR
   */
  validateDocumentData(ocrResults: OCRResults): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check required fields
    if (!ocrResults.extractedData.fullName && 
        (!ocrResults.extractedData.firstName || !ocrResults.extractedData.lastName)) {
      errors.push('Name is missing or incomplete');
    }

    if (!ocrResults.extractedData.dateOfBirth) {
      errors.push('Date of birth is missing');
    } else {
      // Validate DOB format and age
      const dob = new Date(ocrResults.extractedData.dateOfBirth);
      if (isNaN(dob.getTime())) {
        errors.push('Invalid date of birth format');
      } else {
        const age = this.calculateAge(dob);
        if (age < 18) {
          errors.push('User must be at least 18 years old');
        }
        if (age > 120) {
          errors.push('Invalid date of birth');
        }
      }
    }

    if (!ocrResults.extractedData.documentNumber) {
      errors.push('Document number is missing');
    }

    // Check expiry date
    if (ocrResults.extractedData.expiryDate) {
      const expiryDate = new Date(ocrResults.extractedData.expiryDate);
      if (expiryDate < new Date()) {
        errors.push('Document has expired');
      }
    }

    // Check confidence score
    if (ocrResults.confidence < 0.7) {
      errors.push('Document quality is too low. Please provide a clearer image');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Extract photo from document using bounding regions from OCR
   * Note: This requires the sharp library for image manipulation
   */
  async extractDocumentPhoto(
    ocrResults: OCRResults,
    documentData: DocumentData
  ): Promise<Buffer | null> {
    const photoRegion = ocrResults.extractedData.photoRegion;
    
    if (!photoRegion || photoRegion.length === 0 || !documentData.imageBuffer) {
      console.log('[DocumentService] No photo region found in OCR results');
      return null;
    }

    try {
      // The polygon contains [x1, y1, x2, y2, x3, y3, x4, y4] coordinates
      const polygon = photoRegion[0].polygon;
      
      if (!polygon || polygon.length < 8) {
        console.log('[DocumentService] Invalid photo polygon');
    return null;
      }

      // Calculate bounding box from polygon
      const xCoords = [polygon[0], polygon[2], polygon[4], polygon[6]];
      const yCoords = [polygon[1], polygon[3], polygon[5], polygon[7]];
      
      const left = Math.min(...xCoords);
      const top = Math.min(...yCoords);
      const right = Math.max(...xCoords);
      const bottom = Math.max(...yCoords);
      
      const width = right - left;
      const height = bottom - top;

      // Try to use sharp for image extraction if available
      try {
        // @ts-ignore - sharp is an optional dependency
        const sharp = await import('sharp');
        const extractedPhoto = await sharp.default(documentData.imageBuffer)
          .extract({
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(width),
            height: Math.round(height),
          })
          .toBuffer();
        
        console.log('[DocumentService] Photo extracted successfully');
        return extractedPhoto;
      } catch (importError) {
        console.log('[DocumentService] sharp library not available for photo extraction');
        console.log('[DocumentService] Photo region bounds:', { left, top, width, height });
        return null;
      }
    } catch (error) {
      console.error('[DocumentService] Error extracting photo:', error);
      return null;
    }
  }

  /**
   * Calculate age from date of birth
   */
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
      const filepath = path.join(this.storageDir, file);
      fs.unlinkSync(filepath);
      console.log(`[DocumentService] Document deleted: ${documentId}`);
    }
  }
}

