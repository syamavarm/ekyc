/**
 * Test script to invoke DocumentService OCR with a sample image
 * Run with: npx ts-node test-ocr.ts <image-path>
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { DocumentService } from './src/services/documentService';

// Load environment variables
dotenv.config();

async function testOCR(imagePath: string) {
  console.log('\n' + '='.repeat(60));
  console.log('📄 Document OCR Test');
  console.log('='.repeat(60));

  // Check if Azure credentials are configured
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  
  console.log(`\n🔧 Configuration:`);
  console.log(`   Endpoint: ${endpoint ? '✅ Set' : '❌ Not set'}`);
  console.log(`   API Key: ${key ? '✅ Set' : '❌ Not set'}`);

  // Initialize DocumentService
  const documentService = new DocumentService({
    azureEndpoint: endpoint,
    azureKey: key,
  });

  // Read the image file
  console.log(`\n📁 Loading image: ${imagePath}`);
  
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Image file not found: ${imagePath}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imagePath);
  console.log(`   File size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

  // Save document
  console.log(`\n💾 Saving document...`);
  const documentData = await documentService.saveDocument(
    imageBuffer,
    'drivers_license',
    path.basename(imagePath)
  );
  console.log(`   Document ID: ${documentData.documentId}`);

  // Perform complete document analysis (OCR + Photo extraction)
  console.log(`\n🔍 Performing document analysis (OCR + Photo)...`);
  const startTime = Date.now();
  
  try {
    // Use the new analyzeDocument method that calls both models
    const { ocrResults, photoBuffer, photoUrl, ocrResultsUrl } = await documentService.analyzeDocument(documentData);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Analysis Completed in ${duration}s`);
    
    // Show extracted photo info
    if (photoBuffer && photoUrl) {
      console.log(`📸 Photo extracted: ${photoBuffer.length} bytes`);
      console.log(`📸 Photo saved to: ${photoUrl}`);
    } else {
      console.log(`📸 Photo extraction: Failed or not available`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 Extracted Data:');
    console.log('='.repeat(60));
    
    const { extractedData, confidence } = ocrResults;
    
    console.log(`\n👤 Personal Information:`);
    console.log(`   Full Name: ${extractedData.fullName || 'N/A'}`);
    console.log(`   First Name: ${extractedData.firstName || 'N/A'}`);
    console.log(`   Last Name: ${extractedData.lastName || 'N/A'}`);
    console.log(`   Date of Birth: ${extractedData.dateOfBirth || 'N/A'}`);
    console.log(`   Gender: ${extractedData.gender || 'N/A'}`);
    console.log(`   Nationality: ${extractedData.nationality || 'N/A'}`);
    
    console.log(`\n📄 Document Information:`);
    console.log(`   Document Number: ${extractedData.documentNumber || 'N/A'}`);
    console.log(`   Issue Date: ${extractedData.issueDate || 'N/A'}`);
    console.log(`   Expiry Date: ${extractedData.expiryDate || 'N/A'}`);
    
    console.log(`\n📍 Address:`);
    console.log(`   ${extractedData.address || 'N/A'}`);
    
    console.log(`\n📊 Confidence Score: ${(confidence * 100).toFixed(1)}%`);
    
    // Validate the data
    console.log('\n' + '='.repeat(60));
    console.log('✓ Validation:');
    console.log('='.repeat(60));
    
    const validation = documentService.validateDocumentData(ocrResults);
    if (validation.isValid) {
      console.log('   ✅ Document is valid');
    } else {
      console.log('   ❌ Document validation failed:');
      validation.errors.forEach(err => console.log(`      - ${err}`));
    }

    // Show all extracted fields from Azure response
    console.log('\n' + '='.repeat(60));
    console.log('📋 All Azure Extracted Fields:');
    console.log('='.repeat(60));
    
    const rawResult = ocrResults.rawResponse as any;
    if (rawResult?.analyzeResult?.documents?.[0]?.fields) {
      const fields = rawResult.analyzeResult.documents[0].fields;
      for (const [fieldName, fieldData] of Object.entries(fields)) {
        const data = fieldData as any;
        const value = data.valueString || data.valueDate || data.valueCountryRegion || data.content || 'N/A';
        const conf = data.confidence ? `(${(data.confidence * 100).toFixed(0)}%)` : '';
        console.log(`   ${fieldName}: ${value} ${conf}`);
      }
    }

    // Save results to JSON file
    const jsonPath = imagePath.replace(/\.[^.]+$/, '-ocr-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(ocrResults, null, 2));
    console.log(`\n💾 Full results saved to: ${jsonPath}`);
    
  } catch (error) {
    console.error(`\n❌ OCR Failed:`, error);
    process.exit(1);
  }
}

// Get image path from command line argument
const imagePath = process.argv[2];

if (!imagePath) {
  console.log('Usage: npx ts-node test-ocr.ts <image-path>');
  console.log('Example: npx ts-node test-ocr.ts ./sample-license.jpg');
  process.exit(1);
}

testOCR(imagePath).catch(console.error);

