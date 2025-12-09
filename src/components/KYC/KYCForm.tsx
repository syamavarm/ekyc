import React, { useState } from 'react';
import './KYCForm.css';
import kycApiService from '../../services/kycApiService';

interface KYCFormData {
  mobileNumber: string;
  otp: string;
  sessionId: string;
  userId: string;
  email?: string;
}

interface KYCFormProps {
  onStartKYC: (data: KYCFormData) => void;
  workflowConfigId?: string;
}

const KYCForm: React.FC<KYCFormProps> = ({ onStartKYC, workflowConfigId }) => {
  const [formData, setFormData] = useState({
    mobileNumber: '',
    otp: '',
  });
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate OTP - check if it matches last 4 digits of mobile number
    const last4Digits = formData.mobileNumber.slice(-4);
    if (formData.otp !== last4Digits) {
      setError('Invalid OTP. Please enter the last 4 digits of your mobile number.');
      return;
    }
    
    setError('');
    setIsLoading(true);
    
    try {
      // Create user data
      const userId = `user-${Date.now()}`;
      const email = `${formData.mobileNumber}@example.com`;
      
      // Create session at backend after OTP verification
      const response = await kycApiService.startSession(userId, email, formData.mobileNumber, workflowConfigId);
      
      onStartKYC({
        ...formData,
        sessionId: response.sessionId,
        userId,
        email,
      });
    } catch (err: any) {
      console.error('Failed to create session:', err);
      setError('Failed to start KYC session. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSendOTP = () => {
    if (formData.mobileNumber.length < 10) {
      setError('Please enter a valid mobile number');
      return;
    }
    setOtpSent(true);
    setError('');
    // In a real app, this would send OTP via SMS
    console.log('OTP would be sent to:', formData.mobileNumber);
  };

  return (
    <div className="kyc-form-container">
      <div className="kyc-form-card">
        <div className="kyc-form-header">
          <h1>Video KYC Verification</h1>
          <p>Please fill in your details to start the video verification process</p>
        </div>
        
        <form onSubmit={handleSubmit} className="kyc-form">
          <div className="form-group">
            <label htmlFor="mobileNumber">Mobile Number</label>
            <div className="mobile-input-group">
              <input
                type="tel"
                id="mobileNumber"
                name="mobileNumber"
                value={formData.mobileNumber}
                onChange={handleChange}
                required
                placeholder="Enter your mobile number"
                disabled={otpSent}
                pattern="[0-9]{10,15}"
                maxLength={15}
              />
              {!otpSent && (
                <button
                  type="button"
                  className="send-otp-btn"
                  onClick={handleSendOTP}
                  disabled={formData.mobileNumber.length < 10}
                >
                  Send OTP
                </button>
              )}
            </div>
          </div>

          {otpSent && (
            <div className="form-group">
              <label htmlFor="otp">Enter OTP</label>
              <input
                type="text"
                id="otp"
                name="otp"
                value={formData.otp}
                onChange={handleChange}
                required
                placeholder="Enter 4-digit OTP"
                maxLength={4}
                pattern="[0-9]{4}"
              />
              <p className="otp-hint">
                Hint: Enter the last 4 digits of your mobile number
              </p>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}

          <button 
            type="submit" 
            className="submit-btn"
            disabled={!otpSent || formData.otp.length !== 4 || isLoading}
          >
            {isLoading ? 'Starting...' : 'Start Video Verification'}
          </button>
        </form>

        <div className="kyc-form-footer">
          <p>🔒 Your information is secure and encrypted</p>
        </div>
      </div>
    </div>
  );
};

export default KYCForm;

