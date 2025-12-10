// .env is loaded via --env-file flag in package.json scripts
import express from 'express';
import cors from 'cors';
import http from 'http';
import kycRoutes from './routes/kycRoutes';
import adminRoutes from './routes/adminRoutes';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Server
const server = http.createServer(app);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'eKYC Backend API'
  });
});

// KYC Routes - Main API
app.use('/kyc', kycRoutes);

// Admin Routes - Workflow Configuration
app.use('/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    availableRoutes: [
      'POST /kyc/start',
      'POST /kyc/consent',
      'POST /kyc/location',
      'POST /kyc/document/upload',
      'POST /kyc/document/ocr',
      'POST /kyc/face/verify',
      'POST /kyc/liveness-check',
      'GET /kyc/questionnaire/sets',
      'GET /kyc/questionnaire/questions',
      'POST /kyc/questionnaire/submit',
      'POST /kyc/complete',
      'GET /kyc/session/:id/summary',
      'GET /kyc/session/:id',
      'GET /kyc/sessions',
    ]
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message 
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ eKYC Backend Server running on port ${PORT}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n📋 Available Services:`);
  console.log(`   ✓ REST API (KYC Workflow)`);
  console.log(`   ✓ Document Upload & OCR`);
  console.log(`   ✓ Face Verification & Liveness Check`);
  console.log(`   ✓ Questionnaire System`);
  console.log(`   ✓ Session Management`);
  console.log(`   ✓ Report Generation`);
  console.log(`\n🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`📡 API Base URL: http://localhost:${PORT}/kyc`);
  console.log(`\n💡 Health Check: http://localhost:${PORT}/health`);
  console.log(`📚 API Docs: See EKYC_API_DOCUMENTATION.md\n`);
});

export default app;
