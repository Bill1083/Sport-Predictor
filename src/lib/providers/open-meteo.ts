/**
 * Open-Meteo: free weather forecasts with no key. One call per venue and
 * day, cached six hours; the hour nearest kickoff is kept on the event.
 */

import { providerJson } from '@/lib/providers/http';
import type { Weather } from '@/lib/types';

const BASE = 'https://api.open-meteo.com/v1/forecast';

interface Forecast {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation_probability?: (number | null)[];
    precipitation?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

/** WMO weather code -> short text. */
export function describeCode(code: number | null | undefined): string | undefined {
  if (code === null || code === undefined) return undefined;
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code <= 49) return 'fog';
  if (code <= 59) return 'drizzle';
  if (code <= 69) return 'rain';
  if (code <= 79) return 'snow';
  if (code <= 84) return 'showers';
  if (code <= 94) return 'snow showers';
  return 'thunderstorm';
}

export function pickHour(forecast: Forecast, at: Date): Weather | null {
  const times = forecast.hourly?.time ?? [];
  if (times.length === 0) return null;
  let best = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const t = Date.parse(`${times[i]}Z`);
    const diff = Math.abs(t - at.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  if (best < 0 || bestDiff > 3 * 3_600_000) return null;
  const h = forecast.hourly!;
  const val = (arr: (number | null)[] | undefined) => {
    const v = arr?.[best];
    return typeof v === 'number' ? v : undefined;
  };
  return {
    tempC: val(h.temperature_2m),
    windKph: val(h.wind_speed_10m),
    rainProb: val(h.precipitation_probability),
    precipMm: val(h.precipitation),
    conditions: describeCode(h.weather_code?.[best]),
    fetchedAt: new Date().toISOString(),
  };
}

/** Forecast for the hour of `at` at a venue; null beyond the 16-day horizon or on failure. */
export async function forecastAt(lat: number, lon: number, at: Date): Promise<Weather | null> {
  const day = at.toISOString().slice(0, 10);
  const horizon = (at.getTime() - Date.now()) / 86_400_000;
  if (horizon > 15 || horizon < -1) return null;
  const url = `${BASE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code&timezone=UTC&start_date=${day}&end_date=${day}`;
  try {
    const data = await providerJson<Forecast>('open-meteo', url, { ttlMs: 6 * 3_600_000, timeoutMs: 15_000, maxAttempts: 2 });
    return pickHour(data, at);
  } catch (error) {
    console.warn('[scoresage] weather fetch failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
