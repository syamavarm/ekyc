import React, { useState, useEffect } from 'react';
import kycApiService from '../../services/kycApiService';

interface LocationCaptureProps {
  sessionId: string;
  onLocationCaptured: (location: any) => void;
  loading: boolean;
  documentAddress?: string;
  locationRadiusKm?: number;
}

interface AddressComparison {
  documentAddress?: string;
  // Radius-based comparison
  distanceKm?: number;
  allowedRadiusKm?: number;
  withinRadius?: boolean;
  // Country-based comparison
  userCountry?: string;
  documentCountry?: string;
  sameCountry?: boolean;
  // Verification type and result
  verificationType?: 'radius' | 'country';
  verified?: boolean;
  message?: string;
}

const LocationCapture: React.FC<LocationCaptureProps> = ({
  sessionId,
  onLocationCaptured,
  loading,
  documentAddress,
  locationRadiusKm,
}) => {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'comparing' | 'captured' | 'error'>('idle');
  const [location, setLocation] = useState<any>(null);
  const [addressComparison, setAddressComparison] = useState<AddressComparison | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Auto-capture location on mount
    captureLocation();
  }, []);

  const captureLocation = async () => {
    setStatus('capturing');
    setError('');
    setAddressComparison(null);

    try {
      const locationData = await kycApiService.getUserLocation();
      setLocation(locationData);
      
      // If document address is available and GPS is captured, compare with user's location
      // locationRadiusKm can be undefined (for country-based comparison) or a number (for radius-based)
      if (documentAddress && locationData.gps) {
        setStatus('comparing');
        try {
          const comparison = await kycApiService.compareLocationWithAddress(
            sessionId,
            locationData.gps.latitude,
            locationData.gps.longitude,
            documentAddress,
            locationRadiusKm // Can be undefined for country-based comparison
          );
          setAddressComparison(comparison);
          // Update location data with comparison results
          locationData.addressComparison = comparison;
        } catch (comparisonErr) {
          console.warn('Address comparison failed:', comparisonErr);
          // Continue without comparison - don't fail the whole step
        }
      }
      
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

        {(status === 'capturing' || status === 'comparing') && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>{status === 'capturing' ? 'Capturing your location...' : 'Comparing with document address...'}</p>
            <small>{status === 'capturing' ? 'Please allow location access when prompted' : 'Verifying your proximity to document address'}</small>
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
            
            {/* Address Comparison Results */}
            {addressComparison && (
              <div className={`address-comparison ${addressComparison.verified ? 'within-radius' : 'outside-radius'}`}>
                <h4>📍 Address Verification</h4>
                
                {/* Country-based comparison display */}
                {addressComparison.verificationType === 'country' && (
                  <>
                    {addressComparison.userCountry && (
                      <p className="country-info">
                        <strong>Your Location:</strong> {addressComparison.userCountry}
                      </p>
                    )}
                    {addressComparison.documentCountry && (
                      <p className="country-info">
                        <strong>Document Country:</strong> {addressComparison.documentCountry}
                      </p>
                    )}
                    <p className={`verification-status ${addressComparison.sameCountry ? 'verified' : 'not-verified'}`}>
                      {addressComparison.sameCountry 
                        ? '✓ You are in the same country as your document address' 
                        : '⚠️ You are not in the same country as your document address'}
                    </p>
                  </>
                )}
                
                {/* Radius-based comparison display */}
                {addressComparison.verificationType === 'radius' && (
                  <>
                    {addressComparison.documentAddress && (
                      <p className="document-address">
                        <strong>Document Address:</strong> {addressComparison.documentAddress}
                      </p>
                    )}
                    {addressComparison.distanceKm !== undefined && (
                      <p className="distance">
                        <strong>Distance:</strong> {addressComparison.distanceKm.toFixed(1)} km from document address
                      </p>
                    )}
                    {addressComparison.allowedRadiusKm && (
                      <p className="radius">
                        <strong>Allowed Radius:</strong> {addressComparison.allowedRadiusKm} km
                      </p>
                    )}
                    <p className={`verification-status ${addressComparison.withinRadius ? 'verified' : 'not-verified'}`}>
                      {addressComparison.withinRadius 
                        ? '✓ Location is within acceptable range' 
                        : '⚠️ Location is outside acceptable range'}
                    </p>
                  </>
                )}
              </div>
            )}
            
            {/* Show document address info if available but no comparison was done */}
            {documentAddress && !addressComparison && (
              <div className="address-info">
                <p><strong>Document Address:</strong> {documentAddress}</p>
                <p className="note">Location comparison was configured but could not be completed</p>
              </div>
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

