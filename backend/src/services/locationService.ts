/**
 * Location Service
 * Handles GPS and IP-based geolocation capture and validation
 */

import { LocationData } from '../types/kyc.types';
import axios from 'axios';

export class LocationService {
  private ipGeolocationApiKey?: string;

  constructor(apiKey?: string) {
    this.ipGeolocationApiKey = apiKey;
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
}

