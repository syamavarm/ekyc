/**
 * Report Generation Service
 * Generates PDF reports and summaries for KYC sessions
 */

import { KYCSession, SessionSummaryResponse } from '../types/kyc.types';
import fs from 'fs';
import path from 'path';

export class ReportGenerationService {
  private reportsDir: string;

  constructor(reportsDir?: string) {
    this.reportsDir = reportsDir || path.join(__dirname, '../../reports');
    
    // Ensure reports directory exists
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Generate session summary
   */
  generateSessionSummary(session: KYCSession): SessionSummaryResponse {
    const duration = session.completedAt 
      ? session.completedAt.getTime() - session.createdAt.getTime()
      : undefined;

    const summary: SessionSummaryResponse = {
      sessionId: session.sessionId,
      userId: session.userId,
      status: session.status,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      duration,
      consent: session.consent,
      location: session.location,
      document: session.document,
      secureVerification: session.secureVerification,
      questionnaire: session.questionnaire,
      verificationResults: session.verificationResults,
      overallScore: session.overallScore,
    };

    return summary;
  }

  /**
   * Generate PDF report
   * TODO: Integrate with actual PDF generation library (e.g., PDFKit, Puppeteer)
   */
  async generatePDFReport(session: KYCSession): Promise<{
    filepath: string;
    buffer: Buffer;
  }> {
    try {
      console.log(`[ReportService] Generating PDF report for session: ${session.sessionId}`);

      // TODO: Integrate with PDF generation library
      // const pdfBuffer = await this.createPDFDocument(session);
      
      // Stub implementation - creates a simple text file
      const reportContent = this.generateReportContent(session);
      const filename = `kyc_report_${session.sessionId}_${Date.now()}.txt`;
      const filepath = path.join(this.reportsDir, filename);
      
      const buffer = Buffer.from(reportContent, 'utf-8');
      fs.writeFileSync(filepath, buffer);
      
      console.log(`[ReportService] Report generated: ${filepath}`);
      
      return {
        filepath,
        buffer,
      };
    } catch (error) {
      console.error('[ReportService] Error generating PDF report:', error);
      throw new Error('Failed to generate PDF report');
    }
  }

  /**
   * Create PDF document using PDFKit (stub)
   * TODO: Implement actual PDF generation
   */
  private async createPDFDocument(session: KYCSession): Promise<Buffer> {
    // Example using PDFKit:
    
    // const PDFDocument = require('pdfkit');
    // const doc = new PDFDocument();
    // const chunks: Buffer[] = [];
    
    // doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    
    // // Add content
    // doc.fontSize(20).text('eKYC Verification Report', { align: 'center' });
    // doc.moveDown();
    // doc.fontSize(12).text(`Session ID: ${session.sessionId}`);
    // doc.text(`User ID: ${session.userId}`);
    // doc.text(`Date: ${session.createdAt.toLocaleString()}`);
    // doc.moveDown();
    
    // // Add verification results
    // doc.fontSize(16).text('Verification Results:', { underline: true });
    // doc.fontSize(12);
    // doc.text(`Document Verified: ${session.verificationResults.documentVerified ? 'YES' : 'NO'}`);
    // doc.text(`Secure Verification: ${session.verificationResults.secureVerificationVerified ? 'YES' : 'NO'}`);
    // doc.text(`Location Verified: ${session.verificationResults.locationVerified ? 'YES' : 'NO'}`);
    // doc.moveDown();
    
    // // Add document details
    // if (session.document) {
    //   doc.fontSize(16).text('Document Details:', { underline: true });
    //   doc.fontSize(12);
    //   doc.text(`Type: ${session.document.documentType}`);
    //   if (session.document.ocrResults) {
    //     doc.text(`Name: ${session.document.ocrResults.extractedData.fullName}`);
    //     doc.text(`DOB: ${session.document.ocrResults.extractedData.dateOfBirth}`);
    //     doc.text(`Document Number: ${session.document.ocrResults.extractedData.documentNumber}`);
    //   }
    //   doc.moveDown();
    // }
    
    // // Add face verification details
    // if (session.faceVerification) {
    //   doc.fontSize(16).text('Face Verification:', { underline: true });
    //   doc.fontSize(12);
    //   doc.text(`Match Score: ${(session.faceVerification.matchScore * 100).toFixed(2)}%`);
    //   doc.text(`Result: ${session.faceVerification.isMatch ? 'MATCH' : 'NO MATCH'}`);
    //   doc.moveDown();
    // }
    
    // // Add location details
    // if (session.location?.gps) {
    //   doc.fontSize(16).text('Location:', { underline: true });
    //   doc.fontSize(12);
    //   doc.text(`Latitude: ${session.location.gps.latitude}`);
    //   doc.text(`Longitude: ${session.location.gps.longitude}`);
    //   doc.moveDown();
    // }
    
    // // Finalize
    // doc.end();
    
    // return new Promise((resolve) => {
    //   doc.on('end', () => {
    //     resolve(Buffer.concat(chunks));
    //   });
    // });

    throw new Error('PDF generation not implemented');
  }

  /**
   * Generate report content as text (for stub implementation)
   */
  private generateReportContent(session: KYCSession): string {
    const lines: string[] = [];
    
    lines.push('='.repeat(80));
    lines.push('eKYC VERIFICATION REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    
    // Session Info
    lines.push('SESSION INFORMATION');
    lines.push('-'.repeat(80));
    lines.push(`Session ID: ${session.sessionId}`);
    lines.push(`User ID: ${session.userId}`);
    lines.push(`Email: ${session.email || 'N/A'}`);
    lines.push(`Mobile: ${session.mobileNumber || 'N/A'}`);
    lines.push(`Status: ${session.status}`);
    lines.push(`Created: ${session.createdAt.toLocaleString()}`);
    if (session.completedAt) {
      lines.push(`Completed: ${session.completedAt.toLocaleString()}`);
      const duration = session.completedAt.getTime() - session.createdAt.getTime();
      lines.push(`Duration: ${Math.round(duration / 1000)} seconds`);
    }
    lines.push('');
    
    // Consent
    lines.push('CONSENT');
    lines.push('-'.repeat(80));
    lines.push(`Video Recording: ${session.consent.videoRecording ? 'YES' : 'NO'}`);
    lines.push(`Location Tracking: ${session.consent.locationTracking ? 'YES' : 'NO'}`);
    lines.push(`Document Use: ${session.consent.documentUse ? 'YES' : 'NO'}`);
    lines.push(`Consent Given: ${session.consent.timestamp.toLocaleString()}`);
    lines.push('');
    
    // Location
    if (session.location) {
      lines.push('LOCATION');
      lines.push('-'.repeat(80));
      if (session.location.gps) {
        lines.push(`GPS: ${session.location.gps.latitude}, ${session.location.gps.longitude}`);
        lines.push(`Accuracy: ${session.location.gps.accuracy} meters`);
      }
      if (session.location.ip) {
        lines.push(`IP Address: ${session.location.ip.address}`);
        lines.push(`Location: ${session.location.ip.city || 'N/A'}, ${session.location.ip.region || 'N/A'}, ${session.location.ip.country || 'N/A'}`);
      }
      lines.push('');
    }
    
    // Document
    if (session.document) {
      lines.push('DOCUMENT VERIFICATION');
      lines.push('-'.repeat(80));
      lines.push(`Document Type: ${session.document.documentType}`);
      lines.push(`Upload Time: ${session.document.uploadedAt.toLocaleString()}`);
      lines.push(`Valid: ${session.document.isValid ? 'YES' : 'NO'}`);
      
      if (session.document.ocrResults) {
        lines.push('');
        lines.push('Extracted Data:');
        const data = session.document.ocrResults.extractedData;
        lines.push(`  First Name: ${data.firstName || 'N/A'}`);
        lines.push(`  Last Name: ${data.lastName || 'N/A'}`);
        lines.push(`  Full Name: ${data.fullName || 'N/A'}`);
        lines.push(`  Date of Birth: ${data.dateOfBirth || 'N/A'}`);
        lines.push(`  Gender: ${data.gender || 'N/A'}`);
        lines.push(`  Address: ${data.address ? data.address.replace(/\n/g, ', ') : 'N/A'}`);
        lines.push(`  Document Number: ${data.documentNumber || 'N/A'}`);
        lines.push(`  Issue Date: ${data.issueDate || 'N/A'}`);
        lines.push(`  Expiry Date: ${data.expiryDate || 'N/A'}`);
        lines.push(`  Nationality: ${data.nationality || 'N/A'}`);
        lines.push(`  OCR Confidence: ${(session.document.ocrResults.confidence * 100).toFixed(2)}%`);
      }
      lines.push('');
    }
    
    // Secure Verification (Face + Liveness)
    if (session.secureVerification) {
      lines.push('SECURE VERIFICATION');
      lines.push('-'.repeat(80));
      lines.push(`Overall Result: ${session.secureVerification.overallResult ? 'PASS' : 'FAIL'}`);
      lines.push(`Verified: ${session.secureVerification.verifiedAt.toLocaleString()}`);
      lines.push('');
      
      // Face Match
      lines.push('Face Match:');
      lines.push(`  Match Score: ${(session.secureVerification.faceMatch.matchScore * 100).toFixed(2)}%`);
      lines.push(`  Result: ${session.secureVerification.faceMatch.isMatch ? 'MATCH' : 'NO MATCH'}`);
      lines.push(`  Confidence: ${(session.secureVerification.faceMatch.confidence * 100).toFixed(2)}%`);
      lines.push('');
      
      // Liveness
      lines.push('Liveness Check:');
      lines.push(`  Result: ${session.secureVerification.liveness.overallResult ? 'PASS' : 'FAIL'}`);
      lines.push(`  Confidence: ${(session.secureVerification.liveness.confidenceScore * 100).toFixed(2)}%`);
      for (const check of session.secureVerification.liveness.checks) {
        lines.push(`    ${check.type}: ${check.result ? 'PASS' : 'FAIL'} (${(check.confidence * 100).toFixed(2)}%)`);
      }
      lines.push('');
      
      // Face Consistency
      lines.push('Face Consistency:');
      lines.push(`  Result: ${session.secureVerification.faceConsistency.isConsistent ? 'CONSISTENT' : 'INCONSISTENT'}`);
      lines.push(`  Score: ${(session.secureVerification.faceConsistency.consistencyScore * 100).toFixed(2)}%`);
      lines.push(`  Message: ${session.secureVerification.faceConsistency.message}`);
      lines.push('');
    }
    
    // Questionnaire
    if (session.questionnaire) {
      lines.push('QUESTIONNAIRE');
      lines.push('-'.repeat(80));
      lines.push(`Score: ${session.questionnaire.score}/${session.questionnaire.questions.length}`);
      lines.push(`Passed: ${session.questionnaire.passed ? 'YES' : 'NO'}`);
      lines.push('');
      lines.push('Questions & Answers:');
      session.questionnaire.questions.forEach((qa, index) => {
        lines.push(`  ${index + 1}. ${qa.question}`);
        lines.push(`     Answer: ${qa.userAnswer}`);
        lines.push(`     Result: ${qa.isCorrect ? 'CORRECT' : 'INCORRECT'}`);
      });
      lines.push('');
    }
    
    // Verification Results Summary
    lines.push('VERIFICATION RESULTS SUMMARY');
    lines.push('-'.repeat(80));
    lines.push(`Document Verified: ${session.verificationResults.documentVerified ? 'YES' : 'NO'}`);
    lines.push(`Secure Verification: ${session.verificationResults.secureVerificationVerified ? 'YES' : 'NO'}`);
    lines.push(`Location Verified: ${session.verificationResults.locationVerified ? 'YES' : 'NO'}`);
    if (session.verificationResults.questionnaireVerified !== undefined) {
      lines.push(`Questionnaire Verified: ${session.verificationResults.questionnaireVerified ? 'YES' : 'NO'}`);
    }
    lines.push('');
    lines.push(`OVERALL STATUS: ${session.verificationResults.overallVerified ? 'VERIFIED' : 'NOT VERIFIED'}`);
    if (session.overallScore !== undefined) {
      lines.push(`Overall Score: ${(session.overallScore * 100).toFixed(2)}%`);
    }
    lines.push('');
    
    lines.push('='.repeat(80));
    lines.push('End of Report');
    lines.push('='.repeat(80));
    
    return lines.join('\n');
  }

  /**
   * Generate JSON export of session
   */
  generateJSONExport(session: KYCSession): string {
    return JSON.stringify(session, null, 2);
  }

  /**
   * Delete report file
   */
  deleteReport(sessionId: string): void {
    const files = fs.readdirSync(this.reportsDir);
    const reportFiles = files.filter(f => f.includes(sessionId));
    
    for (const file of reportFiles) {
      const filepath = path.join(this.reportsDir, file);
      fs.unlinkSync(filepath);
      console.log(`[ReportService] Report deleted: ${filepath}`);
    }
  }

  /**
   * Get report file path
   */
  getReportPath(sessionId: string): string | null {
    const files = fs.readdirSync(this.reportsDir);
    const reportFile = files.find(f => f.includes(sessionId));
    
    if (reportFile) {
      return path.join(this.reportsDir, reportFile);
    }
    
    return null;
  }
}

