/**
 * Location Service
 * Handles GPS and IP-based geolocation capture and validation
 * Includes geocoding and distance comparison with document addresses
 */

import { LocationData, LocationVerificationResult } from '../types/kyc.types';
import axios from 'axios';

interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress?: string;
  country?: string;
  countryCode?: string;
}

interface ReverseGeocodingResult {
  formattedAddress?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  state?: string;
}

export class LocationService {
  private ipGeolocationApiKey?: string;
  private geocodingApiKey?: string;

  constructor(config?: { ipApiKey?: string; geocodingApiKey?: string }) {
    this.ipGeolocationApiKey = config?.ipApiKey;
    this.geocodingApiKey = config?.geocodingApiKey || process.env.GEOCODING_API_KEY;
  }

  /**
   * Validate and store GPS coordinates
   */
  async captureGPSLocation(
    latitude: number,
    longitude: number,
    accuracy: number
  ): Promise<LocationData['gps']> {
    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error('Invalid latitude. Must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Invalid longitude. Must be between -180 and 180');
    }
    if (accuracy < 0) {
      throw new Error('Invalid accuracy. Must be positive');
    }

    return {
      latitude,
      longitude,
      accuracy,
      timestamp: new Date(),
    };
  }

  /**
   * Capture IP-based geolocation
   * TODO: Integrate with actual IP geolocation service (e.g., MaxMind, IPStack, ipapi.co)
   */
  async captureIPLocation(ipAddress: string): Promise<LocationData['ip']> {
    try {
      // Stub implementation - In production, integrate with actual service
      // Example: const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`);
      
      console.log(`[LocationService] Capturing IP location for: ${ipAddress}`);
      
      // For now, return mock data
      // TODO: Replace with actual API call
      const locationData: LocationData['ip'] = {
        address: ipAddress,
        country: 'United States',
        region: 'California',
        city: 'San Francisco',
        timestamp: new Date(),
      };

      return locationData;
    } catch (error) {
      console.error('[LocationService] Error capturing IP location:', error);
      
      // Return basic data on error
      return {
        address: ipAddress,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get IP geolocation using external service (stub)
   * TODO: Implement actual API integration
   */
  private async getIPGeolocation(ipAddress: string): Promise<any> {
    // Example integration with ipapi.co (free tier)
    // const response = await axios.get(`https://ipapi.co/${ipAddress}/json/`);
    // return response.data;
    
    // For paid services like MaxMind or IPStack:
    // const response = await axios.get(
    //   `https://api.ipstack.com/${ipAddress}?access_key=${this.ipGeolocationApiKey}`
    // );
    // return response.data;
    
    return null;
  }

  /**
   * Validate location data completeness
   */
  validateLocationData(locationData: LocationData): boolean {
    if (!locationData.gps && !locationData.ip) {
      return false;
    }

    if (locationData.gps) {
      const { latitude, longitude, accuracy } = locationData.gps;
      if (
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180 ||
        accuracy < 0
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate distance between two GPS coordinates (in kilometers)
   * Useful for fraud detection / location consistency checks
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
      Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Geocode an address to coordinates using Nominatim (OpenStreetMap) - free, no API key required
   * Rate limited to 1 request per second
   * Also extracts country information from the address
   */
  async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    try {
      console.log(`[LocationService] Geocoding address: ${address}`);
      
      // Use Nominatim (OpenStreetMap) - free geocoding service
      // Important: Must include User-Agent header per their usage policy
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: address,
          format: 'json',
          limit: 1,
          addressdetails: 1, // Include address details for country extraction
        },
        headers: {
          'User-Agent': 'eKYC-Verification-System/1.0',
        },
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        const geocoded: GeocodingResult = {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          formattedAddress: result.display_name,
          country: result.address?.country,
          countryCode: result.address?.country_code?.toUpperCase(),
        };
        
        console.log(`[LocationService] Geocoded to: ${geocoded.latitude}, ${geocoded.longitude}, Country: ${geocoded.country} (${geocoded.countryCode})`);
        return geocoded;
      }

      console.log(`[LocationService] No geocoding results found for: ${address}`);
      return null;
    } catch (error) {
      console.error('[LocationService] Geocoding error:', error);
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to get location details including country
   * Uses Nominatim (OpenStreetMap) - free, no API key required
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<ReverseGeocodingResult | null> {
    try {
      console.log(`[LocationService] Reverse geocoding: ${latitude}, ${longitude}`);
      
      const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: {
          lat: latitude,
          lon: longitude,
          format: 'json',
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'eKYC-Verification-System/1.0',
        },
      });

      if (response.data && response.data.address) {
        const result: ReverseGeocodingResult = {
          formattedAddress: response.data.display_name,
          country: response.data.address.country,
          countryCode: response.data.address.country_code?.toUpperCase(),
          city: response.data.address.city || response.data.address.town || response.data.address.village,
          state: response.data.address.state || response.data.address.region,
        };
        
        console.log(`[LocationService] Reverse geocoded to: ${result.country} (${result.countryCode})`);
        return result;
      }

      console.log(`[LocationService] No reverse geocoding results found`);
      return null;
    } catch (error) {
      console.error('[LocationService] Reverse geocoding error:', error);
      return null;
    }
  }

  /**
   * Compare user's country with document address country
   * Used when no specific radius is defined by admin
   */
  async compareCountries(
    userLatitude: number,
    userLongitude: number,
    documentAddress: string
  ): Promise<LocationVerificationResult> {
    try {
      console.log(`[LocationService] Comparing countries - User location: (${userLatitude}, ${userLongitude}), Document address: ${documentAddress}`);

      // Get user's country from their GPS coordinates
      const userLocation = await this.reverseGeocode(userLatitude, userLongitude);
      
      // Get document address country
      const documentLocation = await this.geocodeAddress(documentAddress);

      if (!userLocation || !userLocation.country) {
        return {
          verified: false,
          userCoordinates: { latitude: userLatitude, longitude: userLongitude },
          message: 'Could not determine user\'s country from GPS coordinates',
          verificationType: 'country',
        };
      }

      if (!documentLocation || !documentLocation.country) {
        return {
          verified: false,
          userCoordinates: { latitude: userLatitude, longitude: userLongitude },
          userCountry: userLocation.country,
          userCountryCode: userLocation.countryCode,
          message: 'Could not determine country from document address',
          verificationType: 'country',
        };
      }

      // Compare countries (case-insensitive)
      const userCountryNormalized = userLocation.country.toLowerCase();
      const documentCountryNormalized = documentLocation.country.toLowerCase();
      const countryNamesMatch = userCountryNormalized === documentCountryNormalized;
      const countryCodesMatch = !!(userLocation.countryCode && documentLocation.countryCode && 
         userLocation.countryCode === documentLocation.countryCode);
      const countriesMatch = countryNamesMatch || countryCodesMatch;

      console.log(`[LocationService] Country comparison - User: ${userLocation.country} (${userLocation.countryCode}), Document: ${documentLocation.country} (${documentLocation.countryCode}), Match: ${countriesMatch}`);

      return {
        verified: countriesMatch,
        userCoordinates: { latitude: userLatitude, longitude: userLongitude },
        documentCoordinates: {
          latitude: documentLocation.latitude,
          longitude: documentLocation.longitude,
          geocodedAddress: documentLocation.formattedAddress,
        },
        userCountry: userLocation.country,
        userCountryCode: userLocation.countryCode,
        documentCountry: documentLocation.country,
        documentCountryCode: documentLocation.countryCode,
        verificationType: 'country',
        message: countriesMatch
          ? `Location verified: You are in ${userLocation.country}, same as your document address`
          : `Location mismatch: You are in ${userLocation.country}, but your document address is in ${documentLocation.country}`,
      };
    } catch (error) {
      console.error('[LocationService] Country comparison error:', error);
      return {
        verified: false,
        userCoordinates: { latitude: userLatitude, longitude: userLongitude },
        verificationType: 'country',
        message: 'Error comparing countries',
      };
    }
  }

  /**
   * Compare user's GPS location with document address
   * If allowedRadiusKm is provided, uses radius-based comparison
   * If not provided, falls back to country-based comparison
   */
  async compareLocationWithAddress(
    userLatitude: number,
    userLongitude: number,
    documentAddress: string,
    allowedRadiusKm?: number
  ): Promise<LocationVerificationResult> {
    // If no radius defined, use country-based comparison
    if (!allowedRadiusKm || allowedRadiusKm <= 0) {
      console.log(`[LocationService] No radius defined, using country-based comparison`);
      return this.compareCountries(userLatitude, userLongitude, documentAddress);
    }

    // Radius-based comparison
    try {
      console.log(`[LocationService] Comparing user location (${userLatitude}, ${userLongitude}) with document address: ${documentAddress}`);
      console.log(`[LocationService] Allowed radius: ${allowedRadiusKm} km`);

      // Geocode the document address
      const geocodedAddress = await this.geocodeAddress(documentAddress);

      if (!geocodedAddress) {
        return {
          verified: false,
          userCoordinates: {
            latitude: userLatitude,
            longitude: userLongitude,
          },
          allowedRadiusKm,
          verificationType: 'radius',
          message: 'Could not geocode document address for comparison',
        };
      }

      // Calculate distance between user location and document address
      const distanceKm = this.calculateDistance(
        userLatitude,
        userLongitude,
        geocodedAddress.latitude,
        geocodedAddress.longitude
      );

      const withinRadius = distanceKm <= allowedRadiusKm;

      console.log(`[LocationService] Distance: ${distanceKm.toFixed(2)} km, Within radius: ${withinRadius}`);

      return {
        verified: withinRadius,
        userCoordinates: {
          latitude: userLatitude,
          longitude: userLongitude,
        },
        documentCoordinates: {
          latitude: geocodedAddress.latitude,
          longitude: geocodedAddress.longitude,
          geocodedAddress: geocodedAddress.formattedAddress,
        },
        distanceKm: Math.round(distanceKm * 100) / 100, // Round to 2 decimal places
        allowedRadiusKm,
        verificationType: 'radius',
        message: withinRadius
          ? `Location verified: You are ${distanceKm.toFixed(1)} km from your document address (within ${allowedRadiusKm} km radius)`
          : `Location mismatch: You are ${distanceKm.toFixed(1)} km from your document address (exceeds ${allowedRadiusKm} km radius)`,
      };
    } catch (error) {
      console.error('[LocationService] Location comparison error:', error);
      return {
        verified: false,
        userCoordinates: {
          latitude: userLatitude,
          longitude: userLongitude,
        },
        allowedRadiusKm,
        verificationType: 'radius',
        message: 'Error comparing location with document address',
      };
    }
  }

  /**
   * Full location verification with optional address comparison
   */
  async verifyLocation(
    gpsData: { latitude: number; longitude: number; accuracy: number },
    documentAddress?: string,
    allowedRadiusKm?: number
  ): Promise<{
    locationData: LocationData;
    addressComparison?: LocationVerificationResult;
  }> {
    // Capture GPS location
    const gps = await this.captureGPSLocation(
      gpsData.latitude,
      gpsData.longitude,
      gpsData.accuracy
    );

    const locationData: LocationData = {
      gps,
      capturedAt: new Date(),
    };

    // If document address and radius are provided, perform comparison
    if (documentAddress && allowedRadiusKm && allowedRadiusKm > 0) {
      const comparison = await this.compareLocationWithAddress(
        gpsData.latitude,
        gpsData.longitude,
        documentAddress,
        allowedRadiusKm
      );

      // Add comparison results to location data
      locationData.addressComparison = {
        documentAddress,
        documentCoordinates: comparison.documentCoordinates,
        distanceKm: comparison.distanceKm,
        allowedRadiusKm: comparison.allowedRadiusKm,
        withinRadius: comparison.verified,
      };

      return {
        locationData,
        addressComparison: comparison,
      };
    }

    return { locationData };
  }
}

