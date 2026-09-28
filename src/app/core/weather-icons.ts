// Local vector geometry, deliberately independent of system/emoji fonts.
const CLOUD = 'M6 16a4 4 0 0 1-.3-8A6 6 0 0 1 17 7a4.5 4.5 0 0 1 .5 9H6Z';
export const WEATHER_ICON_PATHS = {
  sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  moon: ['M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z'],
  'partly-cloudy': ['M5 12a4 4 0 1 1 7-4M7 1v2M1 7h2m.2-3.8 1.4 1.4M12 2l-1 1',
    'M8 21a4 4 0 0 1-.3-8A5 5 0 0 1 17 12a4.5 4.5 0 0 1 .5 9H8Z'],
  cloud: [CLOUD],
  rain: [CLOUD, 'M7 19l-1 3m6-3-1 3m6-3-1 3'],
  snow: ['M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7',
    'M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4M17 19l-1-4 4-1M4 14l4 1-1 4M17 5l-1 4 4 1'],
  storm: [CLOUD, 'M13 13l-4 6h4l-2 4 6-7h-4l2-3'],
  pending: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M7 12h.1m4.9 0h.1m4.9 0h.1'],
} as const;

export type WeatherIconKind = keyof typeof WEATHER_ICON_PATHS;

export function iconForWeatherCode(code: number, isDay: boolean): WeatherIconKind {
  if (!Number.isInteger(code) || code < 0) return 'pending';
  if (code === 0) return isDay ? 'sun' : 'moon';
  if (code <= 2) return isDay ? 'partly-cloudy' : 'cloud';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'pending';
}
