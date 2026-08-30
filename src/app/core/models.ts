export type FitMode = 'contain' | 'cover';
export type MediaFitMode = FitMode | 'inherit';
export type DisplayOrder = 'newest' | 'oldest' | 'shuffle';

export interface FrameSettings {
  photoDurationSeconds: number;
  order: DisplayOrder;
  defaultFitMode: FitMode;
  showCaption: boolean;
  showSender: boolean;
  volume: number;
  muted: boolean;
  fadeDurationMs: number;
  showClock: boolean;
  showDate: boolean;
  showWeather: boolean;
  use24Hour: boolean;
  temperatureUnit: 'c' | 'f';
}

export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
  photoDurationSeconds: 30,
  order: 'newest',
  defaultFitMode: 'contain',
  showCaption: true,
  showSender: true,
  volume: 0.5,
  muted: false,
  fadeDurationMs: 450,
  showClock: true,
  showDate: true,
  showWeather: true,
  use24Hour: true,
  temperatureUnit: 'c',
};

export interface WeatherSnapshot {
  status: 'pending' | 'ready' | 'stale' | 'unavailable';
  location: {
    label: string;
    timezone: string;
    source: 'google_wifi' | 'maxmind' | 'manual' | 'telegram';
    accuracyRadiusKm: number | null;
  } | null;
  current: {
    temperatureC: number;
    apparentTemperatureC: number;
    weatherCode: number;
    isDay: boolean;
    observedAt: string;
  } | null;
  fetchedAt: string | null;
  staleAfter: string | null;
  lastError: string | null;
}

export const EMPTY_WEATHER: WeatherSnapshot = {
  status: 'pending',
  location: null,
  current: null,
  fetchedAt: null,
  staleAfter: null,
  lastError: null,
};

export interface MediaItem {
  id: string;
  kind: 'photo' | 'video';
  url: string;
  posterUrl: string | null;
  caption: string | null;
  senderName: string | null;
  receivedAt: string;
  fitMode: MediaFitMode;
  rotationDegrees: 0 | 90 | 180 | 270;
  durationSeconds: number | null;
  sha256: string;
  sizeBytes: number;
  posterSizeBytes: number | null;
}

export interface FrameManifest {
  schemaVersion: 1;
  frameId: string;
  version: number;
  publishedAt: string;
  settingsRevision: number;
  settings: FrameSettings;
  media: MediaItem[];
}

export interface MediaPatch {
  fitMode?: MediaFitMode;
}

export type MediaRotation = 0 | 90 | 180 | 270;

export interface ProvisioningStatus {
  state: 'disabled' | 'pending' | 'approved' | 'rejected' | 'expired' | 'error';
  requestId: string | null;
  deepLink: string | null;
  deviceModel: string | null;
  suggestedName: string | null;
  frameId: string | null;
  expiresAt: string | null;
  lastError: string | null;
  pairingCode: string | null;
  pairingDeepLink: string | null;
}
