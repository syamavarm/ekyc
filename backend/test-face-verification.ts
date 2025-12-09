/**
 * Test script for Face Verification Service
 * Run with: npx tsx test-face-verification.ts
 */

import { FaceVerificationService } from './src/services/faceVerificationService';
import * as fs from 'fs';
import * as path from 'path';

async function testFaceVerification() {
  console.log('=== Face Verification Service Test ===\n');

  const faceService = new FaceVerificationService({
    matchThreshold: 0.6, // Euclidean distance threshold (lower = stricter)
  });

  // Test 1: Face Detection
  console.log('--- Test 1: Face Detection ---');
  try {
    // Use a sample image from uploads folder
    const uploadsDir = path.join(__dirname, 'uploads');
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.jpg') && !f.includes('-photo'));
    
    if (files.length === 0) {
      console.log('No test images found in uploads folder');
    } else {
      const testImagePath = path.join(uploadsDir, files[0]);
      console.log(`Testing with image: ${files[0]}`);
      
      const imageBuffer = fs.readFileSync(testImagePath);
      const detectionResult = await faceService.detectFace(imageBuffer);
      
      console.log('Detection Result:');
      console.log(`  - Face detected: ${detectionResult.faceDetected}`);
      console.log(`  - Face count: ${detectionResult.faceCount}`);
      console.log(`  - Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      if (detectionResult.boundingBox) {
        console.log(`  - Bounding box: (${Math.round(detectionResult.boundingBox.x)}, ${Math.round(detectionResult.boundingBox.y)}) ${Math.round(detectionResult.boundingBox.width)}x${Math.round(detectionResult.boundingBox.height)}`);
      }
    }
  } catch (error) {
    console.error('Face detection test failed:', error);
  }

  // Test 2: Face Verification (comparing two faces)
  console.log('\n--- Test 2: Face Verification ---');
  try {
    const uploadsDir = path.join(__dirname, 'uploads');
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.jpg'));
    
    // Find a document image and its corresponding photo
    const docImage = files.find(f => !f.includes('-photo') && !f.includes('-ocr'));
    const photoImage = files.find(f => f.includes('-photo'));
    
    if (docImage && photoImage) {
      console.log(`Document image: ${docImage}`);
      console.log(`Photo image: ${photoImage}`);
      
      const docBuffer = fs.readFileSync(path.join(uploadsDir, docImage));
      const photoBuffer = fs.readFileSync(path.join(uploadsDir, photoImage));
      
      const verificationResult = await faceService.verifyFaceMatch(photoBuffer, docBuffer);
      
      console.log('\nVerification Result:');
      console.log(`  - Match Score: ${(verificationResult.matchScore * 100).toFixed(2)}%`);
      console.log(`  - Is Match: ${verificationResult.isMatch ? 'YES ✓' : 'NO ✗'}`);
      console.log(`  - Threshold: ${verificationResult.threshold}`);
      console.log(`  - Confidence: ${(verificationResult.confidence * 100).toFixed(2)}%`);
      if (verificationResult.details) {
        console.log(`  - Distance: ${verificationResult.details.distance?.toFixed(4)}`);
      }
      if (verificationResult.error) {
        console.log(`  - Error: ${verificationResult.error}`);
      }
    } else {
      console.log('Could not find suitable test images for verification');
      console.log('Available files:', files);
    }
  } catch (error) {
    console.error('Face verification test failed:', error);
  }

  // Test 3: Image Validation
  console.log('\n--- Test 3: Image Validation ---');
  try {
    const testBuffer = Buffer.from('small'); // Too small
    const validationResult = faceService.validateFaceImage(testBuffer);
    console.log('Small image validation:');
    console.log(`  - Valid: ${validationResult.isValid}`);
    console.log(`  - Errors: ${validationResult.errors.join(', ') || 'None'}`);
    
    // Test with a real image
    const uploadsDir = path.join(__dirname, 'uploads');
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.jpg'));
    if (files.length > 0) {
      const realImageBuffer = fs.readFileSync(path.join(uploadsDir, files[0]));
      const realValidation = faceService.validateFaceImage(realImageBuffer);
      console.log(`\nReal image (${files[0]}) validation:`);
      console.log(`  - Valid: ${realValidation.isValid}`);
      console.log(`  - Errors: ${realValidation.errors.join(', ') || 'None'}`);
    }
  } catch (error) {
    console.error('Image validation test failed:', error);
  }

  console.log('\n=== Test Complete ===');
}

// Run the test
testFaceVerification().catch(console.error);

