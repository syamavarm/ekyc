import React, { useState, useEffect, useRef } from 'react';
import kycApiService from '../../services/kycApiService';

interface LocationCaptureProps {
  sessionId: string;
  onLocationCaptured: (location: any) => void;
  loading: boolean;
  documentAddress?: string;
  locationRadiusKm?: number;
  videoStream?: MediaStream | null;
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
  videoStream,
}) => {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'comparing' | 'captured' | 'error'>('idle');
  const [location, setLocation] = useState<any>(null);
  const [addressComparison, setAddressComparison] = useState<AddressComparison | null>(null);
  const [error, setError] = useState<string>('');
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // Assign stream to video element - re-run when status changes to ensure video plays
  useEffect(() => {
    if (localVideoRef.current && videoStream) {
      localVideoRef.current.srcObject = videoStream;
      localVideoRef.current.play().catch(err => {
        console.log('Video autoplay:', err);
      });
    }
  }, [videoStream, status]);

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
      {/* Live video preview */}
      {videoStream && (
        <div className="live-video-preview">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxWidth: '640px',
              borderRadius: '10px',
              transform: 'scaleX(-1)',
              border: '3px solid #667eea'
            }}
          />
          <p className="video-label">Live Camera</p>
        </div>
      )}

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

        {status === 'captured' && location && (
          <div className="status-message success">
            <span className="icon">✅</span>
            <p>Location Captured</p>
            
            {/* GPS Coordinates */}
            <div className="location-details">
              {location.gps ? (
                <>
                  <p><strong>Latitude:</strong> {location.gps.latitude.toFixed(6)}</p>
                  <p><strong>Longitude:</strong> {location.gps.longitude.toFixed(6)}</p>
                </>
              ) : (
                <p>Location detected via IP</p>
              )}
            </div>
            
            <small className="proceeding">Proceeding to next step...</small>
          </div>
        )}

        {status === 'error' && (
          <div className="status-message error">
            <span className="icon">⚠️</span>
            <p>Location Error</p>
            <small>{error || 'Could not capture location'}</small>
            <small className="proceeding">Proceeding anyway...</small>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocationCapture;

