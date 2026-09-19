export type FitMode = 'contain' | 'cover';
export type MediaFitMode = FitMode | 'inherit';
export type DisplayOrder = 'newest' | 'oldest' | 'shuffle';
export type CollageMode = 'off' | 'columns' | 'adaptive';

export interface FrameSettings {
  collageMode: CollageMode;
  collageBackground: 'black' | 'material';
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
  collageMode: 'off',
  collageBackground: 'material',
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
  bandColors?: [string, string] | null;
  width?: number | null;
  height?: number | null;
  id: string;
  kind: 'photo' | 'video';
  url: string;
  posterUrl: string | null;
  thumbnailUrl?: string | null;
  caption: string | null;
  senderName: string | null;
  receivedAt: string;
  fitMode: MediaFitMode;
  rotationDegrees: 0 | 90 | 180 | 270;
  durationSeconds: number | null;
  sha256: string;
  sizeBytes: number;
  posterSizeBytes: number | null;
  thumbnailSizeBytes?: number | null;
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

export interface FrameNotification {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  resolvedAt: string | null;
}

export interface AgentHealth {
  ok: boolean;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskAvailableBytes: number;
  diskReservedBytes: number;
  frameDataBytes: number;
  mediaDataBytes: number;
  diskUsedPercent: number;
}

export interface ReposeState {
  schemaVersion: 1;
  active: boolean;
  source: 'manual' | 'schedule' | null;
  enteredAt: string | null;
  updatedAt: string;
  overrideUntil: string | null;
  schedule: { from: string; until: string };
}

export type ViewerPlaybackState =
  | 'empty'
  | 'photo'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'waiting'
  | 'recovering'
  | 'repose'
  | 'error';

export interface ViewerPlaybackSnapshot {
  buildId?: string;
  sessionId?: string;
  uiReady?: boolean;
  quiescedFor?: string | null;
  mediaId: string | null;
  mediaKind: 'photo' | 'video' | null;
  state: ViewerPlaybackState;
  currentTime: number;
  duration: number;
  readyState: number;
  networkState: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  view: 'viewer' | 'overlay' | 'repose';
  navigation: ViewerNavigationSnapshot;
}

export interface ViewerNavigationSnapshot {
  phase: 'stable' | 'staging' | 'transitioning' | 'degraded';
  operationId: number | null;
  candidateMediaId: string | null;
  candidateMediaSha256: string | null;
  phaseElapsedMs: number;
  deadlineMs: number | null;
  failuresInOperation: number;
}

export interface ViewerPlaybackEvent extends ViewerPlaybackSnapshot {
  type: 'viewer.playback.recovery' | 'viewer.playback.recovered' | 'viewer.playback.skipped';
  reason: string;
  attempt: number;
  mediaSha256: string | null;
  mediaErrorCode: number | null;
}

export interface ViewerMediaPreparationFailure {
  type: 'viewer.media.preparation-failed';
  mediaId: string;
  mediaKind: 'photo' | 'video';
  mediaSha256: string;
  reason: string;
  manifestVersion: number | null;
  operationId: number;
  elapsedMs: number;
}
