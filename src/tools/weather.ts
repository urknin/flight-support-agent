import { WeatherCondition } from "../types";

// Airport coordinates reference for weather queries
const AIRPORT_COORDINATES: Record<string, { lat: number; lon: number; city: string }> = {
  DFW: { lat: 32.8998, lon: -97.0403, city: "Dallas" },
  ORD: { lat: 41.9742, lon: -87.9073, city: "Chicago" },
  MDW: { lat: 41.7868, lon: -87.7522, city: "Chicago" },
  AUS: { lat: 30.1975, lon: -97.6664, city: "Austin" },
  JFK: { lat: 40.6413, lon: -73.7781, city: "New York" },
  SFO: { lat: 37.6213, lon: -122.3790, city: "San Francisco" },
  LAX: { lat: 33.9416, lon: -118.4085, city: "Los Angeles" },
};

// In-memory fallback cache to ensure zero demo downtime during external outages
const WEATHER_CACHE: Record<string, WeatherCondition> = {
  DFW: {
    airportCode: "DFW",
    cityName: "Dallas",
    temperatureC: 22.4,
    relativeHumidity: 88,
    windSpeedKmh: 48,
    windGustsKmh: 68,
    weatherCode: 95,
    weatherDescription: "Severe Convective Thunderstorms with Heavy Rain & Gusting Winds",
    visibilityMeters: 2400,
    severity: "SEVERE",
    isAviationHazard: true,
  },
  ORD: {
    airportCode: "ORD",
    cityName: "Chicago",
    temperatureC: 14.1,
    relativeHumidity: 74,
    windSpeedKmh: 32,
    windGustsKmh: 45,
    weatherCode: 63,
    weatherDescription: "Moderate Continuous Rain & Low Cloud Base",
    visibilityMeters: 4800,
    severity: "CAUTION",
    isAviationHazard: true,
  },
};

/**
 * Maps WMO standard weather codes to human and aviation descriptions
 */
export function translateWmoCode(code: number): { description: string; severity: "NORMAL" | "CAUTION" | "SEVERE"; isHazard: boolean } {
  if (code >= 95) {
    return {
      description: "Severe Thunderstorm with possible hail & strong convective turbulence",
      severity: "SEVERE",
      isHazard: true,
    };
  }
  if (code >= 71 && code <= 77) {
    return {
      description: "Moderate to Heavy Snowfall with Runway De-icing in effect",
      severity: "SEVERE",
      isHazard: true,
    };
  }
  if (code >= 61 && code <= 67) {
    return {
      description: "Rain showers with reduced runway braking action",
      severity: "CAUTION",
      isHazard: true,
    };
  }
  if (code === 45 || code === 48) {
    return {
      description: "Dense Fog with Category III low-visibility ILS approach required",
      severity: "SEVERE",
      isHazard: true,
    };
  }
  if (code >= 51 && code <= 57) {
    return {
      description: "Light Drizzle and overcast ceilings",
      severity: "NORMAL",
      isHazard: false,
    };
  }
  if (code <= 3) {
    return {
      description: "VFR Clear to Partly Cloudy skies, optimal flying conditions",
      severity: "NORMAL",
      isHazard: false,
    };
  }
  return {
    description: "Scattered cloud cover with normal flight operations",
    severity: "NORMAL",
    isHazard: false,
  };
}

/**
 * Fetch real-time airport weather using the free Open-Meteo API.
 * Includes a 4-second timeout AbortController and graceful fallback cache.
 */
export async function getAirportWeather(airportCode: string): Promise<WeatherCondition> {
  const code = airportCode.trim().toUpperCase();
  const coords = AIRPORT_COORDINATES[code];

  if (!coords) {
    return {
      airportCode: code,
      cityName: code,
      temperatureC: 20,
      relativeHumidity: 50,
      windSpeedKmh: 15,
      windGustsKmh: 20,
      weatherCode: 1,
      weatherDescription: "Conditions normal for non-hub airport",
      severity: "NORMAL",
      isAviationHazard: false,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m&hourly=visibility&forecast_days=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CloudflareFlightSupportAgent/1.0",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Open-Meteo returned HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const current = data.current;
    const wmo = translateWmoCode(current.weather_code ?? 0);
    const visibility = data.hourly?.visibility?.[0] ?? 10000;

    const condition: WeatherCondition = {
      airportCode: code,
      cityName: coords.city,
      temperatureC: Math.round(current.temperature_2m * 10) / 10,
      relativeHumidity: current.relative_humidity_2m,
      windSpeedKmh: Math.round(current.wind_speed_10m),
      windGustsKmh: Math.round(current.wind_gusts_10m ?? current.wind_speed_10m * 1.3),
      weatherCode: current.weather_code,
      weatherDescription: wmo.description,
      visibilityMeters: visibility,
      severity: wmo.severity,
      isAviationHazard: wmo.isHazard || current.wind_gusts_10m > 55,
    };

    // Update in-memory fallback cache
    WEATHER_CACHE[code] = condition;
    return condition;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Weather] Open-Meteo query failed for ${code} (${err?.message}), using cached fallback.`);
    
    if (WEATHER_CACHE[code]) {
      return WEATHER_CACHE[code];
    }

    return {
      airportCode: code,
      cityName: coords.city,
      temperatureC: 21,
      relativeHumidity: 60,
      windSpeedKmh: 18,
      windGustsKmh: 24,
      weatherCode: 0,
      weatherDescription: "Clear skies (Cached default)",
      severity: "NORMAL",
      isAviationHazard: false,
    };
  }
}
