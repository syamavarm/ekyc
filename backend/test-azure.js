#!/usr/bin/env node
/**
 * Test Azure OpenAI connection
 */

require('dotenv').config();
const { AzureOpenAI } = require('openai');

async function testAzureConnection() {
  console.log('\n🔍 Testing Azure OpenAI Connection...\n');
  console.log('Configuration:');
  console.log('  Endpoint:', process.env.AZURE_OPENAI_ENDPOINT);
  console.log('  Deployment:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
  console.log('  API Version:', process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview');
  console.log('  API Key:', process.env.AZURE_OPENAI_API_KEY ? '***' + process.env.AZURE_OPENAI_API_KEY.slice(-4) : 'MISSING');
  
  try {
    const client = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    });

    console.log('\n📡 Sending test request...');
    
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Connection successful!" if you can read this.' }
      ],
      max_tokens: 50,
    });

    console.log('\n✅ SUCCESS! Connection working!');
    console.log('Response:', response.choices[0].message.content);
    console.log('\n✅ Your Azure OpenAI is configured correctly!');
    
  } catch (error) {
    console.log('\n❌ CONNECTION FAILED!');
    console.log('Error:', error.message);
    
    if (error.status === 404) {
      console.log('\n🔧 Fix: Deployment name mismatch!');
      console.log('   Current deployment name in .env:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
      console.log('\n   Please check Azure Portal:');
      console.log('   1. Go to your OpenAI resource: hackathon-vdua-openai');
      console.log('   2. Click "Model deployments"');
      console.log('   3. Copy the EXACT deployment name');
      console.log('   4. Update AZURE_OPENAI_DEPLOYMENT_NAME in backend/.env\n');
    } else if (error.status === 401) {
      console.log('\n🔧 Fix: Invalid API key');
      console.log('   Check your AZURE_OPENAI_API_KEY in backend/.env\n');
    } else {
      console.log('\n🔧 Check your configuration in backend/.env\n');
    }
    
    process.exit(1);
  }
}

testAzureConnection();


