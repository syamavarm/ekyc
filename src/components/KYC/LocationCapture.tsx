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
  locationSource?: 'gps' | 'ip';
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

    let gpsLatitude: number | undefined;
    let gpsLongitude: number | undefined;
    let locationData: any = {};

    // Try to get GPS coordinates
    try {
      const gpsResult = await kycApiService.getUserLocation();
      if (gpsResult.gps) {
        gpsLatitude = gpsResult.gps.latitude;
        gpsLongitude = gpsResult.gps.longitude;
        locationData = gpsResult;
        setLocation(gpsResult);
      }
    } catch (err: any) {
      console.warn('GPS location error:', err.message);
      // GPS failed, will use IP-based location via backend
    }

    // Always perform comparison if document address is available
    // Backend will use GPS coordinates if provided, otherwise use IP-based location
    if (documentAddress) {
      setStatus('comparing');
      try {
        const comparison = await kycApiService.compareLocationWithAddress(
          sessionId,
          gpsLatitude, // Can be undefined - backend will use IP
          gpsLongitude, // Can be undefined - backend will use IP
          documentAddress,
          locationRadiusKm
        );
        setAddressComparison(comparison);
        locationData.addressComparison = comparison;
        locationData.locationSource = comparison.locationSource;
        setLocation(locationData);
        setStatus('captured');
      } catch (comparisonErr: any) {
        console.error('Address comparison failed:', comparisonErr);
        setError(comparisonErr.message || 'Location verification failed');
        setStatus('error');
      }
    } else {
      // No document address to compare, just mark as captured
      setStatus('captured');
    }

    // Auto-advance to next step after showing results (success or error)
    setTimeout(() => {
      onLocationCaptured(locationData);
    }, 2500);
  };

  return (
    <div className="location-capture">
      <div className="location-card">
        <h2>📍 Location Verification</h2>
        <p>We need to verify your location for compliance purposes.</p>

        {(status === 'capturing' || status === 'comparing') && (
          <div className="status-message">
            <div className="spinner"></div>
            <p>{status === 'capturing' ? 'Capturing your location...' : 'Verifying location against document address...'}</p>
            <small>{status === 'capturing' ? 'Please allow location access when prompted' : 'Comparing your location with document address'}</small>
          </div>
        )}

        {status === 'captured' && (
          <div className="status-message success">
            <span className="icon">✓</span>
            <p>Location verification complete!</p>
            <small>Proceeding to next step...</small>
            
            {/* Show location source */}
            {addressComparison?.locationSource && (
              <p className="location-source">
                <strong>Location Source:</strong> {addressComparison.locationSource === 'gps' ? 'GPS' : 'IP Address'}
              </p>
            )}
            
            {location?.gps && (
              <div className="location-details">
                <p>
                  <strong>Coordinates:</strong> {location.gps.latitude.toFixed(6)}, {location.gps.longitude.toFixed(6)}
                </p>
                <p>
                  <strong>Accuracy:</strong> ±{Math.round(location.gps.accuracy)}m
                </p>
              </div>
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
            <p>Location verification failed</p>
            <small>{error}</small>
            <p className="fallback-message">
              Proceeding to next step...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocationCapture;

