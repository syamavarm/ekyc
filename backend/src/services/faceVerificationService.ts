/**
 * Face Verification Service
 * Handles face matching between live capture and document photo using face-api.js
 * 
 * This implementation uses @vladmandic/face-api which runs locally without any API keys.
 * When Azure Face API access becomes available, you can switch to it by updating the config.
 */

import { FaceVerificationData } from '../types/kyc.types';
import * as faceapi from '@vladmandic/face-api';
import * as canvas from 'canvas';
import * as path from 'path';
import * as fs from 'fs';

// Configure face-api to use node-canvas
const { Canvas, Image, ImageData } = canvas;
// @ts-ignore - face-api needs canvas polyfills for Node.js
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

export class FaceVerificationService {
  private azureFaceEndpoint?: string;
  private azureFaceKey?: string;
  private matchThreshold: number;
  private modelsLoaded: boolean = false;
  private modelsPath: string;
  private useAzure: boolean = false;

  constructor(config?: {
    azureEndpoint?: string;
    azureKey?: string;
    matchThreshold?: number;
    modelsPath?: string;
  }) {
    this.azureFaceEndpoint = config?.azureEndpoint;
    this.azureFaceKey = config?.azureKey;
    this.matchThreshold = config?.matchThreshold || 0.45; // Stricter threshold - distance < 0.45 means same person
    // Use models from the npm package directly
    this.modelsPath = config?.modelsPath || path.join(__dirname, '../../node_modules/@vladmandic/face-api/model');
    
    // Use Azure if credentials are provided
    this.useAzure = !!(this.azureFaceEndpoint && this.azureFaceKey);
    
    if (this.useAzure) {
      console.log('[FaceVerificationService] Configured to use Azure Face API');
    } else {
      console.log('[FaceVerificationService] Configured to use local face-api.js');
    }
  }

  /**
   * Load face-api.js models (required before first use)
   */
  private async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;

    try {
      console.log('[FaceVerificationService] Loading face detection models...');
      console.log(`[FaceVerificationService] Models path: ${this.modelsPath}`);

      // Check if models directory exists
      if (!fs.existsSync(this.modelsPath)) {
        throw new Error(`Models directory not found: ${this.modelsPath}`);
      }

      // Load the required models
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(this.modelsPath);
      await faceapi.nets.tinyFaceDetector.loadFromDisk(this.modelsPath); // Better for small faces
      await faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelsPath);

      this.modelsLoaded = true;
      console.log('[FaceVerificationService] Face detection models loaded successfully');
    } catch (error) {
      console.error('[FaceVerificationService] Failed to load models:', error);
      throw new Error('Failed to load face detection models');
    }
  }

  /**
   * Convert image buffer to canvas Image for face-api.js
   */
  private async bufferToImage(imageBuffer: Buffer): Promise<canvas.Image> {
    const img = new Image();
    img.src = imageBuffer;
    return img;
  }

  /**
   * Verify face match between live capture and document photo
   */
  async verifyFaceMatch(
    liveFaceImage: Buffer,
    documentPhotoImage: Buffer
  ): Promise<FaceVerificationData> {
    try {
      console.log('[FaceVerificationService] Starting face verification...');

      // If Azure is configured, use it (placeholder for future)
      if (this.useAzure) {
        return this.azureFaceVerification(liveFaceImage, documentPhotoImage);
      }

      // Use local face-api.js
      return this.localFaceVerification(liveFaceImage, documentPhotoImage);
    } catch (error) {
      console.error('[FaceVerificationService] Error during face verification:', error);
      throw new Error(`Failed to verify face match: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Local face verification using face-api.js
   */
  private async localFaceVerification(
    image1Buffer: Buffer,
    image2Buffer: Buffer
  ): Promise<FaceVerificationData> {
    // Ensure models are loaded
    await this.loadModels();

    console.log('[FaceVerificationService] Processing images with face-api.js...');

    // Load images
    const img1 = await this.bufferToImage(image1Buffer);
    const img2 = await this.bufferToImage(image2Buffer);

    // Detection options - use lower thresholds for ID photos
    const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 });

    // Detect faces and get face descriptors (128-dimension face encoding)
    console.log('[FaceVerificationService] Detecting face in live capture...');
    let detection1 = await faceapi
      .detectSingleFace(img1 as any, ssdOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    // Try tiny face detector if SSD didn't find a face
    if (!detection1) {
      console.log('[FaceVerificationService] Trying tiny face detector for live capture...');
      detection1 = await faceapi
        .detectSingleFace(img1 as any, tinyOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();
    }

    console.log('[FaceVerificationService] Detecting face in document photo...');
    let detection2 = await faceapi
      .detectSingleFace(img2 as any, ssdOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    // Try tiny face detector if SSD didn't find a face
    if (!detection2) {
      console.log('[FaceVerificationService] Trying tiny face detector for document photo...');
      detection2 = await faceapi
        .detectSingleFace(img2 as any, tinyOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();
    }

    if (!detection1) {
      console.error('[FaceVerificationService] No face detected in live capture image');
      return {
        matchScore: 0,
        isMatch: false,
        threshold: this.matchThreshold,
        confidence: 0,
        verifiedAt: new Date(),
        error: 'No face detected in live capture image',
      };
    }

    if (!detection2) {
      console.error('[FaceVerificationService] No face detected in document photo');
      return {
        matchScore: 0,
        isMatch: false,
        threshold: this.matchThreshold,
        confidence: 0,
        verifiedAt: new Date(),
        error: 'No face detected in document photo',
      };
    }

    // Calculate euclidean distance between face descriptors
    // Lower distance = more similar faces
    const distance = faceapi.euclideanDistance(
      detection1.descriptor,
      detection2.descriptor
    );

    // Convert distance to similarity score (0-1 range)
    // Distance of 0 = perfect match (score 1.0)
    // Distance of 1 = no match (score 0.0)
    // Typical threshold: distance < 0.45 means same person (stricter to avoid false positives)
    const matchScore = Math.max(0, 1 - distance);
    const isMatch = distance < this.matchThreshold;

    console.log(`[FaceVerificationService] Face comparison complete`);
    console.log(`[FaceVerificationService] Distance: ${distance.toFixed(4)}`);
    console.log(`[FaceVerificationService] Match score: ${matchScore.toFixed(4)}`);
    console.log(`[FaceVerificationService] Is match: ${isMatch} (threshold: ${this.matchThreshold})`);

    return {
      matchScore,
      isMatch,
      threshold: this.matchThreshold,
      confidence: matchScore,
      verifiedAt: new Date(),
      details: {
        distance,
        liveFaceDetectionScore: detection1.detection.score,
        documentFaceDetectionScore: detection2.detection.score,
      },
    };
  }

  /**
   * Azure Face API integration (placeholder for future use)
   * TODO: Implement when Azure access is available
   */
  private async azureFaceVerification(
    image1: Buffer,
    image2: Buffer
  ): Promise<FaceVerificationData> {
    // TODO: Implement Azure Face API integration when credentials are available
    // See the commented code below for the implementation pattern
    
    throw new Error('Azure Face API not yet configured. Using local face-api.js instead.');
    
    // Example Azure Face API integration:
    // Step 1: Detect faces in both images
    // const detectEndpoint = `${this.azureFaceEndpoint}/face/v1.0/detect`;
    // ... (rest of Azure implementation)
  }

  /**
   * Detect face in image
   */
  async detectFace(imageBuffer: Buffer): Promise<{
    faceDetected: boolean;
    faceCount: number;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }> {
    try {
      console.log('[FaceVerificationService] Detecting face in image...');
      
      await this.loadModels();

      const img = await this.bufferToImage(imageBuffer);
      
      // Detection options - use lower thresholds for various image types
      const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
      const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 });
      
      // Try SSD MobileNet first
      let detections = await faceapi.detectAllFaces(img as any, ssdOptions);
      
      // If no faces found, try tiny face detector (better for small/distant faces)
      if (detections.length === 0) {
        console.log('[FaceVerificationService] Trying tiny face detector...');
        detections = await faceapi.detectAllFaces(img as any, tinyOptions);
      }

      if (detections.length === 0) {
        console.log('[FaceVerificationService] No face detected');
        return {
          faceDetected: false,
          faceCount: 0,
          confidence: 0,
        };
      }

      // Get the most confident detection
      const bestDetection = detections.reduce((best, current) => 
        current.score > best.score ? current : best
      );

      console.log(`[FaceVerificationService] Detected ${detections.length} face(s), best confidence: ${bestDetection.score.toFixed(4)}`);

      return {
        faceDetected: true,
        faceCount: detections.length,
        confidence: bestDetection.score,
        boundingBox: {
          x: bestDetection.box.x,
          y: bestDetection.box.y,
          width: bestDetection.box.width,
          height: bestDetection.box.height,
        },
      };
    } catch (error) {
      console.error('[FaceVerificationService] Error detecting face:', error);
      return {
        faceDetected: false,
        faceCount: 0,
        confidence: 0,
      };
    }
  }

  /**
   * Validate face image quality
   */
  validateFaceImage(imageBuffer: Buffer): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check image size
    if (imageBuffer.length < 1000) {
      errors.push('Image is too small');
    }
    if (imageBuffer.length > 10 * 1024 * 1024) { // 10MB
      errors.push('Image is too large (max 10MB)');
    }

    // Check image format by looking at magic bytes
    const isJpeg = imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8;
    const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && 
                  imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;
    
    if (!isJpeg && !isPng) {
      errors.push('Image must be JPEG or PNG format');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

}
