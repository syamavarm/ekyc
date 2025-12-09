#!/bin/bash

echo "🎬 Video KYC Setup Script"
echo "========================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "   Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"
echo ""

# Setup Backend
echo "📡 Setting up Backend..."
cd backend

if [ ! -f "package.json" ]; then
    echo "❌ Backend package.json not found"
    exit 1
fi

# Install backend dependencies
echo "   Installing backend dependencies..."
npm install

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "   Creating .env file..."
    cat > .env << 'EOF'
# Azure OpenAI Configuration (for conversations)
AZURE_OPENAI_API_KEY=your_azure_openai_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Azure Speech Configuration (for voice)
AZURE_SPEECH_API_KEY=your_azure_speech_key_here
AZURE_SPEECH_REGION=eastus
AZURE_SPEECH_VOICE=en-US-JennyNeural

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
FRONTEND_URL=http://localhost:3000
EOF
    echo ""
    echo "⚠️  IMPORTANT: Please update backend/.env with your Azure credentials!"
    echo "   1. Azure OpenAI credentials (see backend/AZURE_SETUP.md)"
    echo "   2. Azure Speech credentials (see backend/AZURE_SPEECH_SETUP.md)"
    echo ""
fi

cd ..

# Setup Frontend
echo "🎨 Setting up Frontend..."

# Install frontend dependencies
echo "   Installing frontend dependencies..."
npm install

echo ""
echo "✅ Setup Complete!"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Setup Azure OpenAI (for conversations):"
echo "   - Create Azure OpenAI resource"
echo "   - Deploy GPT-4 model"
echo "   - See backend/AZURE_SETUP.md"
echo ""
echo "2. Setup Azure Speech (for voice):"
echo "   - Create Speech Services resource"
echo "   - Copy API key and region"
echo "   - See backend/AZURE_SPEECH_SETUP.md"
echo ""
echo "3. Update backend/.env with both sets of credentials"
echo ""
echo "3. Start the application:"
echo "   ./start.sh"
echo "   (or start manually - see README.md)"
echo ""
echo "4. Open your browser:"
echo "   http://localhost:3000"
echo ""
echo "🎉 You're ready to go!"

