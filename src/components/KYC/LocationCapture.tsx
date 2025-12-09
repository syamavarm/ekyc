import React, { useState, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';

interface LocationCaptureProps {
  sessionId: string;
  onLocationCaptured: (location: any) => void;
  loading: boolean;
}

const LocationCapture: React.FC<LocationCaptureProps> = ({
  sessionId,
  onLocationCaptured,
  loading,
}) => {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'captured' | 'error'>('idle');
  const [location, setLocation] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Auto-capture location on mount
    captureLocation();
  }, []);

  const captureLocation = async () => {
    setStatus('capturing');
    setError('');

    try {
      const locationData = await kycApiService.getUserLocation();
      setLocation(locationData);
      setStatus('captured');
    } catch (err: any) {
      console.error('Location capture error:', err);
      setError(err.message || 'Failed to capture location');
      setStatus('error');
    }
  };

  const handleContinue = () => {
    if (location) {
      onLocationCaptured(location);
    }
  };

  const handleRetry = () => {
    captureLocation();
  };

  return (
    <div className="location-capture">
      <div className="location-card">
        <h2>📍 Location Verification</h2>
        <p>We need to verify your location for compliance purposes.</p>

        {status === 'capturing' && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>Capturing your location...</p>
            <small>Please allow location access when prompted</small>
          </div>
        )}

        {status === 'captured' && location && (
          <div className="status-message success">
            <span className="icon">✓</span>
            <p>Location captured successfully!</p>
            {location.gps && (
              <div className="location-details">
                <p>
                  <strong>Coordinates:</strong> {location.gps.latitude.toFixed(6)}, {location.gps.longitude.toFixed(6)}
                </p>
                <p>
                  <strong>Accuracy:</strong> ±{Math.round(location.gps.accuracy)}m
                </p>
              </div>
            )}
            {!location.gps && (
              <p className="fallback-message">
                Using IP-based location (GPS not available)
              </p>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="status-message error">
            <span className="icon">⚠️</span>
            <p>Failed to capture location</p>
            <small>{error}</small>
            <p className="fallback-message">
              Don't worry, we'll use IP-based location instead.
            </p>
          </div>
        )}

        <div className="location-actions">
          {status === 'error' && (
            <button className="btn-secondary" onClick={handleRetry}>
              Retry
            </button>
          )}
          {(status === 'captured' || status === 'error') && (
            <button
              className="btn-primary"
              onClick={handleContinue}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocationCapture;

