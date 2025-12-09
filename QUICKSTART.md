# 🚀 Quick Start Guide

Get your Video KYC AI Agent running in 5 minutes!

## Step 1: Setup Azure Resources

### A. Azure OpenAI (for conversations)
1. Go to https://portal.azure.com
2. Create **Azure OpenAI** resource
3. Deploy **GPT-4** model (deployment name: `gpt-4`)
4. Copy endpoint and API key

📖 **Guide:** [backend/AZURE_SETUP.md](backend/AZURE_SETUP.md)

### B. Azure Speech Services (for voice)
1. In Azure Portal, create **Speech Services** resource
2. Choose region: **East US** (or your preferred region)
3. Copy API key and region

📖 **Guide:** [backend/AZURE_SPEECH_SETUP.md](backend/AZURE_SPEECH_SETUP.md)

## Step 2: Run Setup

```bash
./setup.sh
```

This installs all dependencies for both frontend and backend.

## Step 3: Configure Backend

Edit `backend/.env`:

```bash
# Azure OpenAI (conversations)
AZURE_OPENAI_API_KEY=your_openai_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Azure Speech (voice)
AZURE_SPEECH_API_KEY=your_speech_key_here
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=en-US-JennyNeural

PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

## Step 4: Start Application

**Option A - One Command (Recommended):**
```bash
./start.sh
```

**Option B - Manual (Two Terminals):**

Terminal 1 (Backend):
```bash
cd backend
npm run dev
```

Terminal 2 (Frontend):
```bash
npm start
```

## Step 5: Test It!

1. Open http://localhost:3000
2. Enter mobile: `9876543210`
3. Enter OTP: `3210` (last 4 digits)
4. Allow camera access
5. Wait for AI agent to join
6. Listen to the greeting
7. When asked, show your ID
8. Say "ready" or click ✓
9. Watch the AI verify!

## 🎤 Voice Commands

- "ready"
- "here"  
- "I'm showing my document"
- "yes"

## 🔧 Troubleshooting

**"Azure OpenAI API key and endpoint are required"**
→ Check `backend/.env` has your Azure OpenAI credentials

**"Azure Speech API key and region are required"**
→ Check `backend/.env` has your Azure Speech credentials
→ Verify region matches your Speech resource (e.g., `eastus`)

**Backend won't start**
→ Make sure port 3001 is free: `lsof -ti:3001 | xargs kill -9`

**Frontend won't start**
→ Make sure port 3000 is free: `lsof -ti:3000 | xargs kill -9`

**AI agent not responding**
→ Check backend logs for errors
→ Verify API key is valid
→ Check you have OpenAI credits

**No audio**
→ Allow microphone permissions
→ Use Chrome or Edge

## 💰 Costs

Each verification costs approximately **$0.10-0.13**

Azure AI benefits:
- ✅ **200+ voices** (vs 6 with OpenAI)
- ✅ **100+ languages** support
- ✅ **Better quality** neural voices
- ✅ 99.9% SLA guarantee
- ✅ Enterprise support
- ✅ Regional data residency

## 📚 Next Steps

- Read [README.md](README.md) for full documentation
- Check [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment
- Explore the code in `src/` and `backend/src/`

## 🆘 Need Help?

- Check logs: `npm run dev` (shows all errors)
- Test backend: `curl http://localhost:3001/health`
- Test WebSocket: `wscat -c ws://localhost:3001`

---

**Enjoy your AI-powered Video KYC! 🎉**

