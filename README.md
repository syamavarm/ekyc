# Video KYC Application with AI Agent

A complete Video KYC (Know Your Customer) solution with a real AI agent powered by OpenAI's GPT-4, Whisper, and TTS APIs.

## 🌟 Features

### Frontend (React + WebRTC)
- 📱 Mobile number + OTP authentication
- 📹 WebRTC video calling interface
- 🎨 Modern UI with Teams/Google Meet style controls
- 🤖 Real-time AI agent visualization
- 💬 Speech bubbles showing agent messages
- 🎤 Voice interaction support

### Backend (Node.js + Azure Services)
- 🧠 **GPT-4** - Natural conversation AI via Azure OpenAI
- 🎤 **Azure Speech STT** - Speech-to-text with 100+ languages
- 🔊 **Azure Neural TTS** - High-quality voice with 200+ voices
- ☁️ **Enterprise Ready** - Azure services with SLA
- 🔄 **WebSocket** - Real-time bidirectional communication
- 📊 **Session Management** - Track verification progress

## 📁 Project Structure

```
ekyc/
├── backend/                 # AI Agent Backend
│   ├── src/
│   │   ├── server.ts       # WebSocket & HTTP server
│   │   ├── aiAgent.ts      # OpenAI integration
│   │   ├── sessionManager.ts
│   │   └── types.ts
│   ├── package.json
│   └── README.md
│
├── src/                     # React Frontend
│   ├── components/
│   │   ├── KYC/
│   │   │   ├── KYCForm.tsx
│   │   │   └── KYCForm.css
│   │   └── VideoCall/
│   │       ├── VideoCall.tsx
│   │       ├── VideoCall.css
│   │       ├── AIAgent.tsx
│   │       └── Icons.tsx
│   ├── services/
│   │   ├── aiAgentService.ts
│   │   ├── websocketService.ts
│   │   └── speechService.ts
│   ├── hooks/
│   │   └── useWebRTC.ts
│   └── App.tsx
│
├── package.json
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Azure OpenAI resource ([Setup guide](backend/AZURE_SETUP.md))
- Azure Speech Services resource ([Setup guide](backend/AZURE_SPEECH_SETUP.md))

### 1. Setup Backend

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
# Azure OpenAI (conversations)
AZURE_OPENAI_API_KEY=your_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4

# Azure Speech (voice)
AZURE_SPEECH_API_KEY=your_speech_key
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=en-US-JennyNeural

PORT=3001
FRONTEND_URL=http://localhost:3000
EOF

# See backend/AZURE_SETUP.md and backend/AZURE_SPEECH_SETUP.md guide

# Start backend server
npm run dev
```

Backend will run on **http://localhost:3001**

### 2. Setup Frontend

```bash
# Navigate to root
cd ..

# Install dependencies
npm install

# Start React app
npm start
```

Frontend will open at **http://localhost:3000**

## 🧪 Testing the Application

1. **Enter Mobile Number**: Enter any 10+ digit number (e.g., `9876543210`)
2. **Enter OTP**: Enter last 4 digits of the mobile number (e.g., `3210`)
3. **Video Call Starts**: Your camera will activate
4. **AI Agent Joins**: After 2 seconds, AI agent connects
5. **AI Greets You**: Agent speaks: "Hello! Welcome to Video KYC..."
6. **Show Document**: When asked, show your ID to camera
7. **Confirm**: Say "ready" or click the green ✓ button
8. **Verification**: Agent verifies document and face
9. **Complete**: Agent confirms verification is complete

## 🎤 Voice Commands

The AI agent understands natural language. You can say:
- "ready"
- "here"
- "I'm showing my document"
- "yes"
- "show"

## 🔧 Configuration

### Backend Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...              # Your OpenAI API key

# Optional
PORT=3001                           # Backend port
NODE_ENV=development                # Environment
FRONTEND_URL=http://localhost:3000  # CORS origin
```

### Frontend WebSocket URL

Edit `src/services/websocketService.ts`:

```typescript
constructor(backendUrl: string = 'ws://localhost:3001') {
  this.backendUrl = backendUrl;
}
```

## 🌐 Deployment

### Deploy Backend

#### Heroku
```bash
cd backend
heroku create your-kyc-backend
heroku config:set OPENAI_API_KEY=your_key
git push heroku main
```

#### Railway
```bash
cd backend
railway login
railway init
railway up
```

#### Render
1. Connect GitHub repository
2. Set environment variables
3. Deploy

### Deploy Frontend

#### Vercel
```bash
vercel deploy
```

#### Netlify
```bash
netlify deploy --prod
```

## 💰 Cost Estimation

OpenAI API costs per verification session:
- **GPT-4 Turbo**: $0.02-0.05
- **Whisper**: $0.01
- **TTS**: $0.02

**Total: ~$0.05-0.08 per verification**

For 1000 verifications/month: ~$50-80

## 🔒 Security Recommendations

For production deployment:

- [ ] Add authentication (JWT tokens)
- [ ] Implement rate limiting
- [ ] Add request validation
- [ ] Enable HTTPS/WSS
- [ ] Store sessions in Redis/database
- [ ] Add logging (Winston, Morgan)
- [ ] Implement error tracking (Sentry)
- [ ] Add video recording for audit trails
- [ ] Implement document OCR verification
- [ ] Add face matching with ID photo

## 🧪 Testing Backend Directly

Use WebSocket client (e.g., wscat):

```bash
npm install -g wscat
wscat -c ws://localhost:3001
```

Send message:
```json
{
  "type": "start",
  "sessionId": "test-123",
  "data": {
    "userId": "user-123",
    "mobileNumber": "9876543210"
  }
}
```

## 📊 API Endpoints

### REST API

- `GET /health` - Health check
- `GET /sessions` - List active sessions
- `POST /api/start-session` - Create new session

### WebSocket

- `start` - Initialize session
- `text` - Send user text
- `audio` - Send user audio (base64)
- `state` - Update conversation state

## 🐛 Troubleshooting

**Backend won't start:**
- Check OpenAI API key is set
- Verify Node.js version (18+)
- Check port 3001 is available

**Frontend can't connect:**
- Ensure backend is running
- Check WebSocket URL matches backend
- Verify CORS is configured

**AI agent not responding:**
- Check OpenAI API key is valid
- Verify you have API credits
- Check browser console for errors

**Audio not working:**
- Enable microphone permissions
- Check browser supports Web Speech API
- Try Chrome/Edge (best support)

## 📚 Technology Stack

**Frontend:**
- React 18
- TypeScript
- WebRTC
- Web Speech API
- WebSocket Client

**Backend:**
- Node.js + Express
- TypeScript
- WebSocket (ws)
- OpenAI API
- Session Management

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.

## 📧 Support

For issues or questions, please open a GitHub issue.

---

**Built with ❤️ using OpenAI GPT-4, Whisper, and TTS**
