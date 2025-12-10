/**
 * Face Verification Service
 * Handles face matching between live capture and document using Azure Face API
 */

import { FaceVerificationData } from '../types/kyc.types';
import axios from 'axios';

export class FaceVerificationService {
  private azureFaceEndpoint?: string;
  private azureFaceKey?: string;

  constructor(config?: {
    azureEndpoint?: string;
    azureKey?: string;
  }) {
    this.azureFaceEndpoint = config?.azureEndpoint;
    this.azureFaceKey = config?.azureKey;
    
    if (this.azureFaceEndpoint && this.azureFaceKey) {
      console.log('[FaceVerificationService] Configured with Azure Face API');
    } else {
      console.log('[FaceVerificationService] WARNING: Azure Face API credentials not configured');
    }
  }

  /**
   * Verify face match between live capture and document image
   */
  async verifyFaceMatch(
    liveFaceImage: Buffer,
    documentImage: Buffer
  ): Promise<FaceVerificationData> {
    console.log('[FaceVerificationService] Starting face verification...');

    if (!this.azureFaceEndpoint || !this.azureFaceKey) {
      console.error('[FaceVerificationService] Azure Face API credentials not configured');
      return {
        matchScore: 0,
        isMatch: false,
        threshold: 0.5,
        confidence: 0,
        verifiedAt: new Date(),
        error: 'Azure Face API credentials not configured',
      };
    }

    const baseEndpoint = this.azureFaceEndpoint.replace(/\/$/, '');
    const detectUrl = `${baseEndpoint}/face/v1.0/detect?returnFaceId=true&returnFaceLandmarks=true&recognitionModel=recognition_04&detectionModel=detection_03&faceIdTimeToLive=86400`;
    const verifyUrl = `${baseEndpoint}/face/v1.0/verify`;

    try {
      // Step 1: Detect face in document image
      console.log(`[FaceVerificationService] Detecting face in document (${documentImage.length} bytes)...`);
      
      const detectDocResponse = await axios.post(detectUrl, documentImage, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Ocp-Apim-Subscription-Key': this.azureFaceKey,
        },
      });

      console.log('[FaceVerificationService] Document detect response:', JSON.stringify(detectDocResponse.data));

      if (!detectDocResponse.data?.length) {
        return {
          matchScore: 0,
          isMatch: false,
          threshold: 0.5,
          confidence: 0,
          verifiedAt: new Date(),
          error: 'No face detected in document image',
        };
      }

      const documentFaceId = detectDocResponse.data[0].faceId;
      console.log(`[FaceVerificationService] Document faceId: ${documentFaceId}`);

      // Step 2: Detect face in live capture
      console.log(`[FaceVerificationService] Detecting face in live capture (${liveFaceImage.length} bytes)...`);
      
      const detectLiveResponse = await axios.post(detectUrl, liveFaceImage, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Ocp-Apim-Subscription-Key': this.azureFaceKey,
        },
      });

      console.log('[FaceVerificationService] Live detect response:', JSON.stringify(detectLiveResponse.data));

      if (!detectLiveResponse.data?.length) {
        return {
          matchScore: 0,
          isMatch: false,
          threshold: 0.5,
          confidence: 0,
          verifiedAt: new Date(),
          error: 'No face detected in live capture',
        };
      }

      const liveFaceId = detectLiveResponse.data[0].faceId;
      console.log(`[FaceVerificationService] Live faceId: ${liveFaceId}`);

      // Step 3: Verify face match
      console.log('[FaceVerificationService] Verifying face match...');
      
      const verifyResponse = await axios.post(verifyUrl, {
        faceId1: documentFaceId,
        faceId2: liveFaceId,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.azureFaceKey,
        },
      });

      const { isIdentical, confidence } = verifyResponse.data;
      console.log(`[FaceVerificationService] Result: isIdentical=${isIdentical}, confidence=${confidence}`);

      return {
        matchScore: confidence,
        isMatch: isIdentical,
        threshold: 0.5,
        confidence,
        verifiedAt: new Date(),
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[FaceVerificationService] Azure API error:', error.response?.status, error.response?.data);
        return {
          matchScore: 0,
          isMatch: false,
          threshold: 0.5,
          confidence: 0,
          verifiedAt: new Date(),
          error: `Azure Face API error: ${error.response?.data?.error?.message || error.message}`,
        };
      }
      throw error;
    }
  }
}
