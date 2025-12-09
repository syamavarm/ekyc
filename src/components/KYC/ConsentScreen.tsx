import React, { useState } from 'react';

interface ConsentScreenProps {
  onSubmit: (consent: {
    videoRecording: boolean;
    locationTracking: boolean;
    documentUse: boolean;
  }) => void;
  onCancel?: () => void;
  loading: boolean;
}

const ConsentScreen: React.FC<ConsentScreenProps> = ({ onSubmit, onCancel, loading }) => {
  const [consent, setConsent] = useState({
    videoRecording: false,
    locationTracking: false,
    documentUse: false,
  });

  const allConsented = consent.videoRecording && consent.locationTracking && consent.documentUse;

  const handleSubmit = () => {
    if (allConsented) {
      onSubmit(consent);
    }
  };

  return (
    <div className="consent-screen">
      <div className="consent-card">
        <h2>Privacy & Consent</h2>
        <p className="consent-intro">
          Before we begin, please review and accept the following consents for the KYC verification process:
        </p>

        <div className="consent-items">
          <label className="consent-item">
            <input
              type="checkbox"
              checked={consent.videoRecording}
              onChange={(e) => setConsent({ ...consent, videoRecording: e.target.checked })}
            />
            <div className="consent-content">
              <h3>📹 Video Recording</h3>
              <p>I consent to the recording of this video call session for verification and compliance purposes.</p>
            </div>
          </label>

          <label className="consent-item">
            <input
              type="checkbox"
              checked={consent.locationTracking}
              onChange={(e) => setConsent({ ...consent, locationTracking: e.target.checked })}
            />
            <div className="consent-content">
              <h3>📍 Location Tracking</h3>
              <p>I consent to sharing my location data (GPS/IP) for verification purposes.</p>
            </div>
          </label>

          <label className="consent-item">
            <input
              type="checkbox"
              checked={consent.documentUse}
              onChange={(e) => setConsent({ ...consent, documentUse: e.target.checked })}
            />
            <div className="consent-content">
              <h3>📄 Document Use</h3>
              <p>I consent to the collection, processing, and storage of my identity documents for KYC verification.</p>
            </div>
          </label>
        </div>

        <div className="consent-footer">
          <p className="consent-note">
            🔒 Your data is encrypted and stored securely. We comply with all data protection regulations.
          </p>
          <div className="consent-actions">
            {onCancel && (
              <button className="btn-secondary" onClick={onCancel} disabled={loading}>
                Cancel
              </button>
            )}
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!allConsented || loading}
            >
              {loading ? 'Processing...' : 'Accept & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConsentScreen;

