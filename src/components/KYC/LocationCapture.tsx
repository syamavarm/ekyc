import React, { useState, useEffect, useRef } from 'react';
import kycApiService from '../../services/kycApiService';
import { uiEventLoggerService } from '../../services/uiEventLoggerService';

interface LocationCaptureProps {
  sessionId: string;
  onLocationCaptured: (location: any) => void;
  loading: boolean;
  documentAddress?: string;
  locationRadiusKm?: number;
  videoStream?: MediaStream | null;
  onStepInstruction?: (instruction: string, playAudio?: boolean, waitForAudio?: boolean) => Promise<void>;
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
  onStepInstruction,
}) => {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'comparing' | 'captured' | 'error'>('idle');
  const [location, setLocation] = useState<any>(null);
  const [addressComparison, setAddressComparison] = useState<AddressComparison | null>(null);
  const [error, setError] = useState<string>('');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);
  const hasCompletedRef = useRef(false);

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
    // Auto-capture location on mount (prevent duplicate calls)
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      captureLocation();
    }
  }, []);

  const captureLocation = async () => {
    setStatus('capturing');
    setError('');
    setAddressComparison(null);

    // Log location capture started
    uiEventLoggerService.logEvent('location_capture_started', { sessionId });

    // Set step instruction (displays and plays audio)
    if (onStepInstruction) {
      await onStepInstruction('Capturing your location for compliance purposes.');
    }

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
        
        // Log location check result for timeline replay
        uiEventLoggerService.logLocationCheck(comparison.verified || false, {
          latitude: gpsLatitude,
          longitude: gpsLongitude,
          distanceKm: comparison.distanceKm,
          message: comparison.message,
        });
      } catch (comparisonErr: any) {
        console.error('Address comparison failed:', comparisonErr);
        setError(comparisonErr.message || 'Location verification failed');
        setStatus('error');
        // Log location check failure
        uiEventLoggerService.logError('location_comparison_failed', comparisonErr.message || 'Location verification failed');
      }
    } else {
      // No document address to compare, just mark as captured
      setStatus('captured');
    }

    // Set completion instruction (only once)
    if (!hasCompletedRef.current) {
      hasCompletedRef.current = true;
      
      if (onStepInstruction) {
        await onStepInstruction('Location verification complete. Proceeding to next step.');
      }
      
      // Small pause after audio, then advance
      await new Promise(resolve => setTimeout(resolve, 500));
      onLocationCaptured(locationData);
    }
  };

  return (
    <div className="location-capture">
      {/* Live video preview - hidden, shown in main layout */}
      {videoStream && (
        <div className="live-video-preview" style={{ display: 'none' }}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
          />
        </div>
      )}

      {/* Spinner during capturing/comparing - instruction shown in overlay */}
      {(status === 'capturing' || status === 'comparing') && (
        <div className="location-status-standalone">
          <div className="spinner"></div>
        </div>
      )}

      {/* Captured location as simple status */}
      {status === 'captured' && location && (
        <div className="location-status-standalone success">
          <p className="location-coords">
            {location.gps ? (
              <>
                {location.gps.latitude.toFixed(4)}, {location.gps.longitude.toFixed(4)}
              </>
            ) : (
              'Location verified via IP'
            )}
          </p>
        </div>
      )}

      {/* Error status */}
      {status === 'error' && (
        <div className="location-status-standalone error">
          <p>{error || 'Location error'}</p>
        </div>
      )}
    </div>
  );
};

export default LocationCapture;

