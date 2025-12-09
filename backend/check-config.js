#!/usr/bin/env node
/**
 * Configuration checker for Azure OpenAI and Speech
 */

require('dotenv').config();

console.log('\n🔍 Checking Azure Configuration...\n');
console.log('=' .repeat(60));

// Check Azure OpenAI
console.log('\n📘 Azure OpenAI Configuration:');
console.log('  API Key:', process.env.AZURE_OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
console.log('  Endpoint:', process.env.AZURE_OPENAI_ENDPOINT || '❌ Missing');
console.log('  Deployment Name:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '❌ Missing');
console.log('  API Version:', process.env.AZURE_OPENAI_API_VERSION || 'Using default');

if (process.env.AZURE_OPENAI_ENDPOINT) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint.startsWith('https://') || !endpoint.includes('.openai.azure.com')) {
    console.log('  ⚠️  Endpoint format might be incorrect');
    console.log('      Should be: https://your-resource.openai.azure.com');
  }
}

// Check Azure Speech
console.log('\n🔊 Azure Speech Configuration:');
console.log('  API Key:', process.env.AZURE_SPEECH_API_KEY ? '✅ Set' : '❌ Missing');
console.log('  Region:', process.env.AZURE_SPEECH_REGION || '❌ Missing');
console.log('  Voice:', process.env.AZURE_SPEECH_VOICE || 'en-US-JennyNeural (default)');

// Check server config
console.log('\n⚙️  Server Configuration:');
console.log('  Port:', process.env.PORT || '3001 (default)');
console.log('  Frontend URL:', process.env.FRONTEND_URL || 'http://localhost:3000 (default)');

console.log('\n' + '='.repeat(60));

// Summary
let issues = [];

if (!process.env.AZURE_OPENAI_API_KEY) issues.push('Azure OpenAI API Key');
if (!process.env.AZURE_OPENAI_ENDPOINT) issues.push('Azure OpenAI Endpoint');
if (!process.env.AZURE_OPENAI_DEPLOYMENT_NAME) issues.push('Azure OpenAI Deployment Name');
if (!process.env.AZURE_SPEECH_API_KEY) issues.push('Azure Speech API Key');
if (!process.env.AZURE_SPEECH_REGION) issues.push('Azure Speech Region');

if (issues.length > 0) {
  console.log('\n❌ Missing Configuration:');
  issues.forEach(issue => console.log(`   - ${issue}`));
  console.log('\n📝 Please update your backend/.env file');
  console.log('   See backend/.env.example for template\n');
  process.exit(1);
} else {
  console.log('\n✅ All configuration values are set!');
  console.log('\n⚠️  IMPORTANT: Make sure your Azure OpenAI deployment name matches EXACTLY');
  console.log('   Current deployment name: ' + process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
  console.log('\n   To verify:');
  console.log('   1. Go to Azure Portal → Your OpenAI resource');
  console.log('   2. Click "Model deployments"');
  console.log('   3. Check the exact deployment name');
  console.log('   4. Update AZURE_OPENAI_DEPLOYMENT_NAME in .env if different\n');
}


