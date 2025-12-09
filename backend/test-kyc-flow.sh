#!/bin/bash

# eKYC API Test Script
# Tests the complete KYC workflow

set -e

BASE_URL="http://localhost:3001"
echo "🚀 Testing eKYC API Flow"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if server is running
echo "Checking if server is running..."
if ! curl -s "$BASE_URL/health" > /dev/null; then
    echo "❌ Server is not running at $BASE_URL"
    echo "Please start the server with: npm run dev"
    exit 1
fi
echo -e "${GREEN}✓${NC} Server is running"
echo ""

# 1. Start session
echo -e "${BLUE}1. Starting KYC session...${NC}"
RESPONSE=$(curl -s -X POST "$BASE_URL/kyc/start" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user-123","email":"test@example.com","mobileNumber":"+1234567890"}')

SESSION_ID=$(echo $RESPONSE | grep -o '"sessionId":"[^"]*' | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
    echo "❌ Failed to start session"
    echo $RESPONSE
    exit 1
fi

echo -e "${GREEN}✓${NC} Session started: $SESSION_ID"
echo ""

# 2. Submit consent
echo -e "${BLUE}2. Submitting consent...${NC}"
CONSENT_RESPONSE=$(curl -s -X POST "$BASE_URL/kyc/consent" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"consent\":{\"videoRecording\":true,\"locationTracking\":true,\"documentUse\":true}}")

if echo $CONSENT_RESPONSE | grep -q '"success":true'; then
    echo -e "${GREEN}✓${NC} Consent recorded"
else
    echo "❌ Failed to record consent"
    echo $CONSENT_RESPONSE
    exit 1
fi
echo ""

# 3. Submit location
echo -e "${BLUE}3. Submitting location (GPS + IP)...${NC}"
LOCATION_RESPONSE=$(curl -s -X POST "$BASE_URL/kyc/location" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"gps\":{\"latitude\":37.7749,\"longitude\":-122.4194,\"accuracy\":10}}")

if echo $LOCATION_RESPONSE | grep -q '"success":true'; then
    echo -e "${GREEN}✓${NC} Location captured"
    echo "   GPS: San Francisco, CA (37.7749, -122.4194)"
else
    echo "❌ Failed to capture location"
    echo $LOCATION_RESPONSE
    exit 1
fi
echo ""

# 4. Upload document (simulated - requires actual file)
echo -e "${BLUE}4. Document upload...${NC}"
echo "   ⚠️  Skipping document upload (requires actual image file)"
echo "   To test manually:"
echo "   curl -X POST $BASE_URL/kyc/document/upload \\"
echo "     -F \"sessionId=$SESSION_ID\" \\"
echo "     -F \"documentType=passport\" \\"
echo "     -F \"document=@/path/to/document.jpg\""
echo ""

# Create a mock document ID for testing
DOC_ID="mock-document-id-$(date +%s)"
echo "   Using mock document ID: $DOC_ID"
echo ""

# 5. Run OCR (would normally use real document ID)
echo -e "${BLUE}5. Running OCR...${NC}"
echo "   ⚠️  Skipping OCR (requires actual document upload first)"
echo ""

# 6. Face verification (simulated - requires actual file)
echo -e "${BLUE}6. Face verification...${NC}"
echo "   ⚠️  Skipping face verification (requires actual image files)"
echo "   To test manually:"
echo "   curl -X POST $BASE_URL/kyc/face/verify \\"
echo "     -F \"sessionId=$SESSION_ID\" \\"
echo "     -F \"documentId=<doc-id>\" \\"
echo "     -F \"faceImage=@/path/to/face.jpg\""
echo ""

# 7. Liveness check (simulated - requires actual files)
echo -e "${BLUE}7. Liveness check...${NC}"
echo "   ⚠️  Skipping liveness check (requires video frames)"
echo "   To test manually:"
echo "   curl -X POST $BASE_URL/kyc/liveness-check \\"
echo "     -F \"sessionId=$SESSION_ID\" \\"
echo "     -F \"frames=@frame1.jpg\" \\"
echo "     -F \"frames=@frame2.jpg\""
echo ""

# 8. Get session status
echo -e "${BLUE}8. Getting session status...${NC}"
SESSION_RESPONSE=$(curl -s -X GET "$BASE_URL/kyc/session/$SESSION_ID")

if echo $SESSION_RESPONSE | grep -q '"success":true'; then
    echo -e "${GREEN}✓${NC} Session retrieved successfully"
    STATUS=$(echo $SESSION_RESPONSE | grep -o '"status":"[^"]*' | cut -d'"' -f4)
    echo "   Current status: $STATUS"
else
    echo "❌ Failed to get session"
    echo $SESSION_RESPONSE
fi
echo ""

# 9. Get all sessions
echo -e "${BLUE}9. Getting all sessions...${NC}"
SESSIONS_RESPONSE=$(curl -s -X GET "$BASE_URL/kyc/sessions")

if echo $SESSIONS_RESPONSE | grep -q '"success":true'; then
    COUNT=$(echo $SESSIONS_RESPONSE | grep -o '"count":[0-9]*' | cut -d':' -f2)
    echo -e "${GREEN}✓${NC} Retrieved $COUNT session(s)"
else
    echo "❌ Failed to get sessions"
    echo $SESSIONS_RESPONSE
fi
echo ""

# 10. Complete session (will fail due to missing verifications)
echo -e "${BLUE}10. Attempting to complete session...${NC}"
COMPLETE_RESPONSE=$(curl -s -X POST "$BASE_URL/kyc/complete" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\"}")

if echo $COMPLETE_RESPONSE | grep -q '"success":true'; then
    echo -e "${GREEN}✓${NC} Session completed successfully"
else
    echo "   ⚠️  Session completion failed (expected - missing document/face/liveness verification)"
    OVERALL=$(echo $COMPLETE_RESPONSE | grep -o '"overallVerified":[^,}]*' | cut -d':' -f2)
    echo "   Overall verified: $OVERALL"
fi
echo ""

# Summary
echo "================================"
echo -e "${GREEN}✓ API Test Complete!${NC}"
echo "================================"
echo ""
echo "Session ID: $SESSION_ID"
echo ""
echo "✅ Tests passed:"
echo "  - Session creation"
echo "  - Consent recording"
echo "  - Location capture"
echo "  - Session retrieval"
echo ""
echo "⚠️  Manual tests needed (require actual files):"
echo "  - Document upload"
echo "  - OCR processing"
echo "  - Face verification"
echo "  - Liveness check"
echo ""
echo "📚 Documentation:"
echo "  - API Docs: backend/EKYC_API_DOCUMENTATION.md"
echo "  - Quick Start: backend/KYC_README.md"
echo "  - Summary: EKYC_IMPLEMENTATION_SUMMARY.md"
echo ""
echo "To view session summary:"
echo "curl http://localhost:3001/kyc/session/$SESSION_ID/summary | jq"
echo ""

