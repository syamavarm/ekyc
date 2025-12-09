# Video KYC AI Agent Backend

Real AI-powered agent backend for Video KYC verification using **Azure OpenAI** and **Azure AI Speech**.

## Features

- 🤖 **GPT-4 powered conversations** - Natural, context-aware responses (Azure OpenAI)
- 🎤 **Azure Speech STT** - Accurate speech-to-text transcription
- 🔊 **Azure Neural TTS** - High-quality text-to-speech with 200+ voices
- 🔄 **Real-time WebSocket** - Bidirectional communication
- 📝 **Session Management** - Track verification progress
- 🚀 **Deployable** - Ready for production deployment
- ☁️ **Azure Enterprise Ready** - Enterprise-grade AI with SLA

## Prerequisites

- Node.js 18+
- Azure OpenAI resource (for GPT-4)
- Azure Speech Services resource (for voice)

## Setup

1. **Install dependencies:**
```bash
cd backend
npm install
```

2. **Configure environment:**

Create a `.env` file:
```bash
# Azure OpenAI (for conversations)
AZURE_OPENAI_API_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4

# Azure Speech (for voice)
AZURE_SPEECH_API_KEY=your_speech_key
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=en-US-JennyNeural

# Server config
PORT=3001
FRONTEND_URL=http://localhost:3000
```

3. **Get Your Azure Credentials:**

**Azure OpenAI (for GPT-4):**
- Create Azure OpenAI resource in [Azure Portal](https://portal.azure.com)
- Deploy GPT-4 model
- Copy endpoint and API key
- See [AZURE_SETUP.md](./AZURE_SETUP.md)

**Azure Speech Services (for voice):**
- Create Speech Services resource
- Copy API key and region
- Choose voice from 200+ options
- See [AZURE_SPEECH_SETUP.md](./AZURE_SPEECH_SETUP.md)

## Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## API Endpoints

### REST API

- `GET /health` - Health check
- `GET /sessions` - List all active sessions
- `POST /api/start-session` - Create new session

### WebSocket

Connect to `ws://localhost:3001`

**Message Types:**

1. **Start Session:**
```json
{
  "type": "start",
  "sessionId": "kyc-123",
  "data": {
    "userId": "user-123",
    "mobileNumber": "9876543210"
  }
}
```

2. **Send Text:**
```json
{
  "type": "text",
  "sessionId": "kyc-123",
  "data": {
    "text": "I'm ready"
  }
}
```

3. **Send Audio:**
```json
{
  "type": "audio",
  "sessionId": "kyc-123",
  "data": {
    "audio": "base64_encoded_audio"
  }
}
```

**Server Responses:**

```json
{
  "type": "agent_response",
  "sessionId": "kyc-123",
  "data": {
    "text": "Hello! Welcome to Video KYC...",
    "audio": "base64_encoded_audio",
    "state": "greeting"
  }
}
```

## Deployment

### Deploy to Heroku

```bash
heroku create your-kyc-backend
heroku config:set OPENAI_API_KEY=your_key
git push heroku main
```

### Deploy to Railway

```bash
railway login
railway init
railway add
railway up
```

### Deploy to Render

1. Connect your GitHub repository
2. Set environment variables
3. Deploy

### Deploy to AWS/GCP/Azure

Use Docker:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/server.js"]
```

## Architecture

```
┌─────────────┐         WebSocket          ┌──────────────┐
│   Frontend  │ ◄────────────────────────► │   Backend    │
│   (React)   │                             │  (Node.js)   │
└─────────────┘                             └──────┬───────┘
                                                   │
                                                   ▼
                                            ┌──────────────┐
                                            │  OpenAI API  │
                                            │              │
                                            │  • GPT-4     │
                                            │  • Whisper   │
                                            │  • TTS       │
                                            └──────────────┘
```

## Conversation Flow

1. **Greeting** - Agent welcomes user
2. **Document Request** - Agent asks to show ID
3. **Document Verification** - Agent verifies document
4. **Face Verification** - Agent verifies face
5. **Completion** - Agent confirms verification complete

## Cost Estimation

Per verification session (3 minutes):
- **GPT-4** (Azure OpenAI): ~$0.03-0.06
- **Speech-to-Text** (Azure Speech): ~$0.05
- **Text-to-Speech** (Azure Speech): ~$0.02
- **Total: ~$0.10-0.13 per verification**

For 1000 verifications/month: **~$100-130**

Benefits of Azure AI Speech:
- 200+ voices (vs 6)
- Better quality
- More languages
- Real-time streaming
- Custom voices option

[Azure Speech Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/)

## Security

- ✅ CORS configured
- ✅ Environment variables for secrets
- ✅ Session isolation
- ✅ Input validation
- ⚠️ Add authentication in production
- ⚠️ Add rate limiting
- ⚠️ Add request logging

## Troubleshooting

**"OpenAI API key not configured"**
- Add your API key to `.env`

**"WebSocket connection failed"**
- Check if backend is running
- Verify PORT matches frontend config

**"Audio transcription failed"**
- Check audio format (WebM supported)
- Verify audio file size < 25MB

## License

MIT

