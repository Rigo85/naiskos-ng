import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { App } from './app';
import { AgentApi } from './core/agent-api';
import {
  DEFAULT_FRAME_SETTINGS,
  FrameManifest,
  FrameNotification,
  MediaItem,
  ReposeState,
  WeatherSnapshot,
} from './core/models';

const photo: MediaItem = {
  id: 'photo-1',
  kind: 'photo',
  url: '/media/photo-1',
  posterUrl: null,
  caption: 'Un recuerdo',
  senderName: 'Rigo',
  receivedAt: '2026-08-08T12:00:00.000Z',
  fitMode: 'inherit',
  rotationDegrees: 0,
  durationSeconds: null,
  sha256: 'abc',
  sizeBytes: 123,
  posterSizeBytes: null,
};

const manifest: FrameManifest = {
  schemaVersion: 1,
  frameId: 'frame-1',
  version: 1,
  publishedAt: '2026-08-08T12:00:00.000Z',
  settingsRevision: 0,
  settings: DEFAULT_FRAME_SETTINGS,
  media: [photo],
};

const weather: WeatherSnapshot = {
  status: 'ready',
  location: {
    label: 'Trujillo, La Libertad, PE',
    timezone: 'America/Lima',
    source: 'maxmind',
    accuracyRadiusKm: 20,
  },
  current: {
    temperatureC: 24.1,
    apparentTemperatureC: 24.8,
    weatherCode: 2,
    isDay: true,
    observedAt: '2026-08-30T01:15:00.000Z',
  },
  fetchedAt: '2026-08-30T01:18:00.000Z',
  staleAfter: '2099-08-30T07:18:00.000Z',
  lastError: null,
};

const secondPhoto: MediaItem = {
  ...photo,
  id: 'photo-2',
  url: '/media/photo-2',
  caption: 'Segundo recuerdo',
};

const thirdPhoto: MediaItem = {
  ...photo,
  id: 'photo-3',
  url: '/media/photo-3',
  caption: 'Tercer recuerdo',
};

const video: MediaItem = {
  ...photo,
  id: 'video-1',
  kind: 'video',
  url: '/media/video-1.mp4',
  posterUrl: '/media/video-1.jpg',
  posterSizeBytes: 17,
  caption: 'Video de prueba',
  durationSeconds: 10,
};

const secondVideo: MediaItem = {
  ...video,
  id: 'video-2',
  url: '/media/video-2.mp4',
  posterUrl: '/media/video-2.jpg',
  caption: 'Segundo video de prueba',
  durationSeconds: 45.311,
};

let servedManifest = manifest;
let servedNotifications: FrameNotification[] = [];
const updateMediaMock = vi.fn((id: string, patch: Partial<MediaItem>) => {
  const item = servedManifest.media.find((candidate) => candidate.id === id) ?? photo;
  return of({ ...item, ...patch });
});
const rotateMediaMock = vi.fn((_id: string, rotationDegrees: number) =>
  of({ accepted: true, rotationDegrees }),
);
const deleteMediaMock = vi.fn(() => of({ accepted: true }));
const deleteMediaBatchMock = vi.fn((ids: string[]) => of({ accepted: true, count: ids.length }));
const markAllNotificationsReadMock = vi.fn(() => of({ updated: 1 }));
const dismissNotificationMock = vi.fn(() => of(undefined));
const reportPlaybackEventMock = vi.fn(() => of({ accepted: true }));
const reportMediaPreparationFailureMock = vi.fn(() => of({ accepted: true }));
const awakeRepose: ReposeState = {
  schemaVersion: 1,
  active: false,
  source: null,
  enteredAt: null,
  updatedAt: '2026-09-14T15:00:00.000Z',
  overrideUntil: null,
  schedule: { from: '23:30', until: '07:00' },
};
let servedRepose = awakeRepose;
const setReposeMock = vi.fn((active: boolean) => {
  servedRepose = {
    ...servedRepose,
    active,
    source: 'manual',
    enteredAt: active ? '2026-09-14T15:00:00.000Z' : null,
    updatedAt: new Date().toISOString(),
  };
  return of(servedRepose);
});

const agentApiMock = {
  getManifest: () => of(servedManifest),
  getManifestVersion: () => of({ version: servedManifest.version }),
  getHealth: () =>
    of({
      ok: true,
      diskTotalBytes: 128_000,
      diskUsedBytes: 64_000,
      diskAvailableBytes: 60_000,
      diskReservedBytes: 4_000,
      frameDataBytes: 2_000,
      mediaDataBytes: 1_000,
      diskUsedPercent: 51.6,
    }),
  getWeather: () => of(weather),
  getNotifications: () => of({ notifications: servedNotifications }),
  markAllNotificationsRead: markAllNotificationsReadMock,
  dismissNotification: dismissNotificationMock,
  getProvisioningStatus: () =>
    of({
      state: 'approved',
      requestId: null,
      deepLink: null,
      deviceModel: null,
      suggestedName: null,
      frameId: manifest.frameId,
      expiresAt: null,
      lastError: null,
      pairingCode: 'ABCD-2345-EFGH',
      pairingDeepLink: 'https://t.me/naiskosbot?start=frame_ABCD2345EFGH',
    }),
  resetProvisioning: () =>
    of({
      state: 'pending',
      requestId: 'e410e4df-7e9a-4e18-a088-56a775c1b74e',
      deepLink: 'https://t.me/naiskosbot?start=enroll_test',
      deviceModel: 'Raspberry Pi 4',
      suggestedName: 'Naiskos prueba',
      frameId: null,
      expiresAt: null,
      lastError: null,
      pairingCode: null,
      pairingDeepLink: null,
    }),
  rotatePairingCode: () =>
    of({
      state: 'approved',
      requestId: null,
      deepLink: null,
      deviceModel: 'Raspberry Pi 4',
      suggestedName: 'Naiskos prueba',
      frameId: manifest.frameId,
      expiresAt: null,
      lastError: null,
      pairingCode: 'WXYZ-6789-ABCD',
      pairingDeepLink: 'https://t.me/naiskosbot?start=frame_WXYZ6789ABCD',
    }),
  updateSettings: (patch: Partial<typeof DEFAULT_FRAME_SETTINGS>) => of({ ...servedManifest.settings, ...patch }),
  resetSettings: () => of(DEFAULT_FRAME_SETTINGS),
  updateMedia: updateMediaMock,
  rotateMedia: rotateMediaMock,
  deleteMedia: deleteMediaMock,
  deleteMediaBatch: deleteMediaBatchMock,
  requestSystemAction: () => of({ accepted: true }),
  getRepose: () => of(servedRepose),
  getRuntimeControl: () => of<{ quiesceId: string | null }>({ quiesceId: null }),
  setRepose: setReposeMock,
  reportViewerHeartbeat: () => of(undefined),
  reportPlaybackEvent: reportPlaybackEventMock,
  reportMediaPreparationFailure: reportMediaPreparationFailureMock,
};

function dispatchPointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  clientX: number,
  clientY: number,
  pointerId = 1,
  pointerType = 'mouse',
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  target.dispatchEvent(event);
}

function setViewerBounds(element: HTMLElement): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 1280,
    bottom: 800,
    left: 0,
    width: 1280,
    height: 800,
    toJSON: () => ({}),
  });
}

async function makeStagedMediaReady(
  fixture: ReturnType<typeof TestBed.createComponent<App>>,
): Promise<void> {
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  const image = compiled.querySelector('.stage--staging img') as HTMLImageElement | null;
  if (image) {
    Object.defineProperty(image, 'decode', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    image.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    return;
  }
  const videoElement = compiled.querySelector('.stage--staging video') as HTMLVideoElement | null;
  if (videoElement) {
    Object.defineProperty(videoElement, 'readyState', { configurable: true, value: 2 });
    videoElement.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  }
}

async function makeStagedSceneReady(fixture: ReturnType<typeof TestBed.createComponent<App>>): Promise<void> {
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  for (const image of compiled.querySelectorAll<HTMLImageElement>('.stage--staging img')) {
    Object.defineProperty(image, 'decode', { configurable: true, value: () => Promise.resolve() });
    image.dispatchEvent(new Event('load'));
  }
  for (const video of compiled.querySelectorAll<HTMLVideoElement>('.stage--staging video')) {
    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
    video.dispatchEvent(new Event('loadeddata'));
  }
  await vi.advanceTimersByTimeAsync(0);
  fixture.detectChanges();
}

async function finishStagedTransition(
  fixture: ReturnType<typeof TestBed.createComponent<App>>,
  durationMs = 450,
): Promise<void> {
  await makeStagedMediaReady(fixture);
  await vi.advanceTimersByTimeAsync(durationMs);
  fixture.detectChanges();
}

describe('App', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    servedManifest = manifest;
    servedNotifications = [];
    servedRepose = awakeRepose;
    window.localStorage.clear();
    setReposeMock.mockClear();
    updateMediaMock.mockClear();
    rotateMediaMock.mockClear();
    deleteMediaMock.mockClear();
    deleteMediaBatchMock.mockClear();
    markAllNotificationsReadMock.mockClear();
    dismissNotificationMock.mockClear();
    reportPlaybackEventMock.mockClear();
    reportMediaPreparationFailureMock.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: AgentApi, useValue: agentApiMock }],
    }).compileComponents();
  });

  it('creates the kiosk viewer', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    fixture.destroy();
  });

  it('prepara todas las fotos del collage antes de mostrarlo y cuenta una sola duración', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: [photo, secondPhoto, thirdPhoto, { ...photo, id: 'fourth', url: '/fourth' }]
        .map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.stage--staging img')).toHaveLength(2);
    await makeStagedMediaReady(fixture);
    expect(compiled.querySelector('.stage--stable')).toBeNull();
    await makeStagedSceneReady(fixture);
    expect(compiled.querySelectorAll('.stage--stable img')).toHaveLength(2);
    expect(compiled.querySelector('.metadata')).toBeNull();
    expect(compiled.querySelector('.collage-menu')).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage--staging img')).toHaveLength(2);
    await makeStagedSceneReady(fixture);
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(thirdPhoto.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('identifica y omite sólo el acompañante fallido de un collage', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: [photo, secondPhoto].map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelectorAll('.stage--staging img')[1].dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    expect(reportMediaPreparationFailureMock).toHaveBeenCalledWith(expect.objectContaining({ mediaId: secondPhoto.id }));
    expect(compiled.querySelectorAll('.stage--stable img')).toHaveLength(1);
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(photo.url);
    expect((compiled.querySelector('.scene-cell') as HTMLElement).style.width).toBe('100%');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('reutiliza el video como reloj del collage, respeta pausa y reposo', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns', photoDurationSeconds: 3 },
      media: [photo, video, secondPhoto, thirdPhoto].map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance as any;
    expect(component.currentMedia().id).toBe(video.id);
    const element = compiled.querySelector('video') as HTMLVideoElement;
    Object.defineProperties(element, { paused: { configurable: true, value: false }, duration: { configurable: true, value: 10 } });
    element.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(3100);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--staging')).toBeNull();
    const key = component.currentScene().key;
    component.applyReposeState({ ...awakeRepose, active: true, updatedAt: '2026-09-17T12:00:00Z' });
    element.dispatchEvent(new Event('pause'));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(5000);
    expect(component.currentScene().key).toBe(key);
    component.applyReposeState({ ...awakeRepose, active: false, updatedAt: '2026-09-17T12:01:00Z' });
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(component.currentScene().key).toBe(key);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    Object.defineProperty(element, 'paused', { configurable: true, value: true });
    element.dispatchEvent(new Event('pause'));
    await vi.advanceTimersByTimeAsync(3000);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--staging')).not.toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('avanza la escena completa al finalizar su video, sin tiempo adicional', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: [photo, video, secondPhoto, thirdPhoto].map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector('video')!.dispatchEvent(new Event('ended'));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage--staging img')).toHaveLength(2);
    await makeStagedSceneReady(fixture);
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage--stable img')).toHaveLength(2);
    expect(compiled.querySelector('video')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('prepara el nuevo modo al guardar, conserva preferencias y permite salir desde el menú', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto].map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.openSettings();
    component.settingsDraft = { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' };
    component.saveSettings();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.stage--stable img')).toHaveLength(1);
    expect(compiled.querySelectorAll('.stage--staging img')).toHaveLength(2);
    await makeStagedSceneReady(fixture);
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage--stable img')).toHaveLength(2);
    expect(component.settings().showCaption).toBe(true);
    expect(compiled.querySelector('.metadata')).toBeNull();
    const frame = compiled.querySelector('main') as HTMLElement;
    dispatchPointer(frame, 'pointerdown', 640, 20, 1, 'touch');
    dispatchPointer(frame, 'pointerup', 640, 150, 1, 'touch');
    fixture.detectChanges();
    expect(component.activeView()).toBe('menu');
    fixture.destroy();
    vi.useRealTimers();
  });

  it.each(['off', 'columns', 'adaptive'] as const)(
    'abre el menú con deslizamiento hacia abajo sin cambiar la escena en modo %s',
    async (collageMode) => {
      vi.useFakeTimers();
      servedManifest = {
        ...manifest,
        settings: { ...DEFAULT_FRAME_SETTINGS, collageMode },
        media: [photo, secondPhoto, thirdPhoto, video]
          .map((entry) => ({ ...entry, width: 670, height: 1000 })),
      };
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(0);
      await makeStagedSceneReady(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      const frame = compiled.querySelector('main') as HTMLElement;
      const component = fixture.componentInstance as any;
      const key = component.currentScene().key;
      setViewerBounds(frame);
      expect(compiled.querySelector('.collage-menu')).toBeNull();
      dispatchPointer(frame, 'pointerdown', 640, 20, 1, 'touch');
      dispatchPointer(frame, 'pointermove', 645, 90, 1, 'touch');
      dispatchPointer(frame, 'pointerup', 645, 150, 1, 'touch');
      fixture.detectChanges();
      expect(component.activeView()).toBe('menu');
      expect(compiled.querySelector('[aria-label="Menú de Naiskos"]')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(31_000);
      fixture.detectChanges();
      expect(component.currentScene().key).toBe(key);
      expect(compiled.querySelector('.stage--staging')).toBeNull();
      fixture.destroy();
      vi.useRealTimers();
    },
  );

  it('cancela una escena incompleta al entrar en reposo e ignora las cargas tardías', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: [photo, secondPhoto, thirdPhoto, { ...photo, id: 'fourth', url: '/fourth' }]
        .map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    const component = fixture.componentInstance as any;
    const key = component.currentScene().key;
    component.navigate(1);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const delayed = [...compiled.querySelectorAll<HTMLImageElement>('.stage--staging img')];
    component.applyReposeState({ ...awakeRepose, active: true, updatedAt: '2026-09-17T12:00:00Z' });
    fixture.detectChanges();
    for (const image of delayed) image.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(30_000);
    fixture.detectChanges();
    expect(component.currentScene().key).toBe(key);
    expect(compiled.querySelector('.stage--staging')).toBeNull();
    expect(compiled.querySelector('.stage--incoming')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('en collage ignora arrastre horizontal y pellizco pero mantiene el toque para avanzar', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: [photo, secondPhoto, thirdPhoto, { ...photo, id: 'fourth', url: '/fourth' }]
        .map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    const frame = compiled.querySelector('main') as HTMLElement;
    setViewerBounds(frame);
    const component = fixture.componentInstance as any;
    const key = component.currentScene().key;
    dispatchPointer(frame, 'pointerdown', 1000, 400);
    dispatchPointer(frame, 'pointerup', 500, 400);
    dispatchPointer(frame, 'pointerdown', 500, 400, 1, 'touch');
    dispatchPointer(frame, 'pointerdown', 700, 400, 2, 'touch');
    dispatchPointer(frame, 'pointermove', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 500, 400, 1, 'touch');
    fixture.detectChanges();
    expect(component.currentScene().key).toBe(key);
    expect(component.photoTransform().scale).toBe(1);
    expect(compiled.querySelector('.stage--staging')).toBeNull();
    dispatchPointer(frame, 'pointerdown', 1000, 400);
    dispatchPointer(frame, 'pointerup', 1000, 400);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--staging')).not.toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('actualiza acompañantes del manifiesto aunque conserve el mismo medio principal', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns', showCaption: false },
      media: [photo, secondPhoto].map((entry) => ({ ...entry, width: 670, height: 1000 })) };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedSceneReady(fixture);
    const component = fixture.componentInstance as any;
    component.receiveManifest({ ...servedManifest, version: 2,
      media: [servedManifest.media[0], { ...thirdPhoto, width: 670, height: 1000 }] });
    component.navigate(1);
    await makeStagedSceneReady(fixture);
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(component.currentScene().cells.map((cell: any) => cell.item.id)).toEqual([photo.id, thirdPhoto.id]);
    expect(component.settings().collageMode).toBe('columns');
    expect(component.settings().showCaption).toBe(false);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('capitaliza sólo el inicio de la fecha del reposo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T17:00:00.000Z'));
    servedRepose = { ...awakeRepose, active: true, source: 'schedule' };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).querySelector('.repose-clock__date')?.textContent?.trim();
    expect(text).toMatch(/^Lunes, 14 de (setiembre|septiembre)$/);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('libera el video para actualizar sin alterar el reposo configurado ni volver a avanzar', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const runtime = vi.spyOn(agentApiMock, 'getRuntimeControl').mockReturnValue(of({ quiesceId: null }));
    const released = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as unknown as {
      viewerPlaybackSnapshot(): { quiescedFor: string|null; uiReady: boolean; mediaId: string|null };
    };
    const before = component.viewerPlaybackSnapshot().mediaId;
    const extraVideo = document.createElement('video');
    extraVideo.src = '/media/active.mp4';
    document.body.appendChild(extraVideo);
    runtime.mockReturnValue(of({ quiesceId: 'nonce-test' }));
    await vi.advanceTimersByTimeAsync(1000);
    fixture.detectChanges();
    expect(extraVideo.hasAttribute('src')).toBe(false);
    expect(released).toHaveBeenCalled();
    for (const element of (fixture.nativeElement as HTMLElement).querySelectorAll('video')) {
      expect(element.hasAttribute('src')).toBe(false);
      element.dispatchEvent(new Event('pause'));
      element.dispatchEvent(new Event('ended'));
    }
    expect(component.viewerPlaybackSnapshot()).toMatchObject({ quiescedFor: 'nonce-test', uiReady: false });
    expect(servedRepose.active).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(component.viewerPlaybackSnapshot().mediaId).toBe(before);
    extraVideo.remove();
    fixture.destroy();
    runtime.mockRestore();
    vi.useRealTimers();
  });

  it('muestra el reloj en reposo, oculta su menú a los 15 segundos y reanuda', async () => {
    vi.useFakeTimers();
    servedRepose = {
      ...awakeRepose,
      active: true,
      source: 'schedule',
      enteredAt: '2026-09-14T23:30:00.000Z',
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const screen = compiled.querySelector('.repose-screen') as HTMLElement;
    expect(screen).not.toBeNull();
    expect(compiled.querySelector('.repose-clock')).not.toBeNull();
    expect(compiled.querySelector('.repose-menu')).toBeNull();

    dispatchPointer(screen, 'pointerdown', 640, 400);
    fixture.detectChanges();
    expect(compiled.querySelector('.repose-menu')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    fixture.detectChanges();
    expect(compiled.querySelector('.repose-menu')).toBeNull();

    dispatchPointer(screen, 'pointerdown', 640, 400);
    fixture.detectChanges();
    (compiled.querySelector('.repose-menu__exit') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(setReposeMock).toHaveBeenCalledWith(false);
    expect(compiled.querySelector('.repose-screen')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('reanuda desde la misma posición el video que estaba reproduciéndose al entrar en reposo', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video')!;
    let paused = false;
    Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
    element.currentTime = 4.25;
    const pause = vi.spyOn(element, 'pause').mockImplementation(() => {
      paused = true;
    });
    const play = vi.spyOn(element, 'play').mockImplementation(() => {
      paused = false;
      element.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    });

    const component = fixture.componentInstance as unknown as { openMainMenu(): void };
    component.openMainMenu();
    fixture.detectChanges();
    expect(pause).toHaveBeenCalledOnce();
    expect((fixture.componentInstance as any).videoPaused()).toBe(false);
    expect(element.currentTime).toBe(4.25);

    const reposeButton = [
      ...compiled.querySelectorAll<HTMLButtonElement>('.quick-menu button'),
    ].find((button) => button.textContent?.includes('Poner en reposo'))!;
    reposeButton.click();
    fixture.detectChanges();
    const confirmButton = [
      ...compiled.querySelectorAll<HTMLButtonElement>('.confirmation-dialog button'),
    ].find((button) => button.textContent?.includes('Sí, poner en reposo'))!;
    confirmButton.click();
    fixture.detectChanges();

    const screen = compiled.querySelector('.repose-screen') as HTMLElement;
    expect(screen).not.toBeNull();
    dispatchPointer(screen, 'pointerdown', 640, 400);
    fixture.detectChanges();
    (compiled.querySelector('.repose-menu__exit') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(play).toHaveBeenCalled();
    expect(paused).toBe(false);
    expect(element.currentTime).toBe(4.25);
    // Chromium can deliver the pause event after the repose exit response.
    // It must not turn the technical pause into a user pause.
    element.dispatchEvent(new Event('pause'));
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Pausar');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('muestra la campana con contador y abre notificaciones persistentes', async () => {
    vi.useFakeTimers();
    servedNotifications = [
      {
        id: 'dc3c227d-594e-4a88-ad4c-3ef330394127',
        kind: 'storage.capacity.blocked',
        severity: 'error',
        title: 'Almacenamiento casi lleno',
        message: 'Libera espacio para continuar sincronizando.',
        createdAt: '2026-08-31T14:00:00.000Z',
        updatedAt: '2026-08-31T14:00:00.000Z',
        readAt: null,
        resolvedAt: null,
      },
      {
        id: '620d4409-6fa8-49f8-87cb-86861515e328',
        kind: 'sync.stale',
        severity: 'warning',
        title: 'Sincronización atrasada',
        message: 'El marco volvió a sincronizar correctamente.',
        createdAt: '2026-08-31T14:05:00.000Z',
        updatedAt: '2026-08-31T14:06:00.000Z',
        readAt: '2026-08-31T14:06:00.000Z',
        resolvedAt: '2026-08-31T14:06:00.000Z',
      },
    ];
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const bell = compiled.querySelector('.notification-bell') as HTMLButtonElement;
    expect(bell.textContent).toContain('1');
    expect(bell.querySelector('svg path')).not.toBeNull();
    bell.click();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Almacenamiento casi lleno');
    const resolved = compiled.querySelector('.notification-card--resolved');
    expect(resolved?.textContent).toContain('Detectado:');
    expect(resolved?.textContent).toContain('Resuelto:');
    expect(markAllNotificationsReadMock).toHaveBeenCalledOnce();
    expect(compiled.querySelector('.notification-bell')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('renders media and its metadata from the local manifest', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('img')?.getAttribute('src')).toBe(photo.url);
    expect(compiled.textContent).toContain('Un recuerdo');
    expect(compiled.textContent).toContain('Rigo');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('aplica zoom volátil y reinicia el contador después de cada pellizco', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      settings: { ...DEFAULT_FRAME_SETTINGS, photoDurationSeconds: 3 },
      media: [photo, secondPhoto],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const frame = compiled.querySelector('.frame') as HTMLElement;
    setViewerBounds(frame);

    await vi.advanceTimersByTimeAsync(2_500);
    dispatchPointer(frame, 'pointerdown', 500, 400, 1, 'touch');
    dispatchPointer(frame, 'pointerdown', 700, 400, 2, 'touch');
    dispatchPointer(frame, 'pointermove', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 500, 400, 1, 'touch');
    fixture.detectChanges();

    let image = compiled.querySelector('.stage--stable img') as HTMLImageElement;
    expect(image.style.transform).toContain('scale(2)');
    expect(updateMediaMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_500);
    dispatchPointer(frame, 'pointerdown', 500, 400, 3, 'touch');
    dispatchPointer(frame, 'pointerdown', 700, 400, 4, 'touch');
    dispatchPointer(frame, 'pointermove', 900, 400, 4, 'touch');
    dispatchPointer(frame, 'pointerup', 900, 400, 4, 'touch');
    dispatchPointer(frame, 'pointerup', 500, 400, 3, 'touch');
    fixture.detectChanges();

    image = compiled.querySelector('.stage--stable img') as HTMLImageElement;
    expect(image.style.transform).toContain('scale(4)');

    await vi.advanceTimersByTimeAsync(2_999);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--incoming')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(
      secondPhoto.url,
    );
    expect(
      (compiled.querySelector('.stage--outgoing img') as HTMLImageElement).style.transform,
    ).toContain('scale(4)');

    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    image = compiled.querySelector('.stage--stable img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(secondPhoto.url);
    expect(image.style.transform).toBe('');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('suspende el contador desde que comienza un pellizco real', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      settings: { ...DEFAULT_FRAME_SETTINGS, photoDurationSeconds: 3 },
      media: [photo, secondPhoto],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const frame = compiled.querySelector('.frame') as HTMLElement;
    setViewerBounds(frame);

    await vi.advanceTimersByTimeAsync(2_900);
    dispatchPointer(frame, 'pointerdown', 500, 400, 1, 'touch');
    dispatchPointer(frame, 'pointerdown', 700, 400, 2, 'touch');
    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--incoming')).toBeNull();

    dispatchPointer(frame, 'pointermove', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 500, 400, 1, 'touch');

    await vi.advanceTimersByTimeAsync(2_999);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--incoming')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(
      secondPhoto.url,
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('desplaza una fotografía ampliada sin activar la navegación lateral', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const frame = compiled.querySelector('.frame') as HTMLElement;
    setViewerBounds(frame);
    dispatchPointer(frame, 'pointerdown', 500, 400, 1, 'touch');
    dispatchPointer(frame, 'pointerdown', 700, 400, 2, 'touch');
    dispatchPointer(frame, 'pointermove', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 900, 400, 2, 'touch');
    dispatchPointer(frame, 'pointerup', 500, 400, 1, 'touch');

    dispatchPointer(frame, 'pointerdown', 600, 400, 3, 'touch');
    dispatchPointer(frame, 'pointermove', 720, 460, 3, 'touch');
    dispatchPointer(frame, 'pointerup', 720, 460, 3, 'touch');
    fixture.detectChanges();

    const image = compiled.querySelector('.stage--stable img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(photo.url);
    expect(image.style.transform).toContain('translate3d(260px, 60px, 0)');
    expect(compiled.querySelector('.stage--incoming')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('abre el menú principal y navega a la galería mixta', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      openMainMenu(): void;
      openGallery(): void;
    };
    component.openMainMenu();
    fixture.detectChanges();
    const menu = fixture.nativeElement as HTMLElement;
    expect(menu.textContent).toContain('Menú principal');
    expect(menu.textContent).toContain('Todas las fotos y videos');
    expect(menu.querySelector('.menu-card__icon svg path')).not.toBeNull();

    component.openGallery();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.gallery-card')).toHaveLength(2);
    expect(compiled.textContent).toContain('▶ 0:10');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('virtualiza una galería grande y conserva estable un manifiesto sin cambios', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      version: 2,
      media: Array.from({ length: 1_200 }, (_, index) => ({
        ...photo,
        id: `photo-${index}`,
        url: `/media/photo-${index}`,
        receivedAt: new Date(Date.UTC(2026, 7, 8, 12, 0, index)).toISOString(),
      })),
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      openGallery(): void;
      manifest(): FrameManifest | null;
    };
    component.openGallery();
    fixture.detectChanges();
    const firstManifest = component.manifest();
    const compiled = fixture.nativeElement as HTMLElement;
    const renderedCards = compiled.querySelectorAll('.gallery-card').length;

    expect(compiled.textContent).toContain('1200 resultados');
    expect(renderedCards).toBeGreaterThan(0);
    expect(renderedCards).toBeLessThanOrEqual(54);

    const firstRenderedId = compiled.querySelector('.gallery-card__open img')?.getAttribute('src');
    const grid = compiled.querySelector('.gallery-grid') as HTMLElement;
    grid.scrollTop = 1_308;
    grid.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.gallery-card')).toHaveLength(54);
    expect(compiled.querySelector('.gallery-card__open img')?.getAttribute('src')).not.toBe(
      firstRenderedId,
    );

    await vi.advanceTimersByTimeAsync(2_000);
    fixture.detectChanges();
    expect(component.manifest()).toBe(firstManifest);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('muestra metadatos numéricos legados y suma los pósteres en almacenamiento', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      media: [
        { ...photo, sizeBytes: '1048576' as unknown as number },
        {
          ...video,
          durationSeconds: '66.026' as unknown as number,
          sizeBytes: '2097152' as unknown as number,
          posterSizeBytes: '1048576' as unknown as number,
        },
      ],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      openGallery(): void;
      storageSummary(): {
        photoBytes: number;
        videoBytes: number;
        totalBytes: number;
      };
    };
    component.openGallery();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('▶ 1:06');
    expect(component.storageSummary()).toMatchObject({
      photoBytes: 1_048_576,
      videoBytes: 3_145_728,
      totalBytes: 4_194_304,
    });
    fixture.destroy();
    vi.useRealTimers();
  });

  it('filtra videos y abre el medio elegido desde la galería', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const filterButtons = compiled.querySelectorAll('.gallery-toolbar .segmented-control button');
    (filterButtons[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.gallery-card')).toHaveLength(1);

    (compiled.querySelector('.gallery-card__open') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace-overlay')).toBeNull();
    await finishStagedTransition(fixture);
    expect(compiled.querySelector('.stage--stable video')?.getAttribute('src')).toBe(video.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('usa la miniatura en la galería sin alterar el medio del visor', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      media: [
        {
          ...photo,
          thumbnailUrl: '/media/photo-1-thumb.webp',
          thumbnailSizeBytes: 23,
        },
        {
          ...video,
          thumbnailUrl: '/media/video-1-thumb.webp',
          thumbnailSizeBytes: 29,
        },
      ],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();
    const previews = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.gallery-card__preview img',
    );
    expect(previews[0]?.getAttribute('src')).toBe('/media/photo-1-thumb.webp');
    expect(previews[1]?.getAttribute('src')).toBe('/media/video-1-thumb.webp');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.gallery-card__open')
      ?.click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('desplaza la galería al arrastrar y no abre accidentalmente una tarjeta', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const grid = compiled.querySelector('.gallery-grid') as HTMLElement;
    const secondCard = compiled.querySelectorAll('.gallery-card__open')[1] as HTMLButtonElement;
    grid.scrollTop = 120;

    dispatchPointer(secondCard, 'pointerdown', 500, 600);
    dispatchPointer(secondCard, 'pointermove', 500, 350);
    fixture.detectChanges();
    expect(grid.scrollTop).toBe(370);
    expect(grid.classList.contains('gallery-grid--dragging')).toBe(true);

    dispatchPointer(secondCard, 'pointerup', 500, 350);
    secondCard.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace-overlay')).not.toBeNull();

    secondCard.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace-overlay')).toBeNull();
    await finishStagedTransition(fixture);
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(secondPhoto.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('permite abrir una tarjeta después de que termina la ventana del arrastre', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const secondCard = compiled.querySelectorAll('.gallery-card__open')[1] as HTMLButtonElement;
    dispatchPointer(secondCard, 'pointerdown', 500, 600);
    dispatchPointer(secondCard, 'pointermove', 500, 350);
    await vi.advanceTimersByTimeAsync(251);

    dispatchPointer(secondCard, 'pointerdown', 500, 350);
    dispatchPointer(secondCard, 'pointerup', 500, 350);
    secondCard.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.workspace-overlay')).toBeNull();
    await finishStagedTransition(fixture);
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(secondPhoto.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('permite heredar o fijar el encuadre desde las opciones de cada medio', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [{ ...photo, fitMode: 'cover' }] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.gallery-card__options') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('.gallery-options-dialog')).not.toBeNull();
    expect(compiled.textContent).toContain('Heredar del marco');
    expect(compiled.querySelector('[aria-pressed="true"]')?.textContent).toContain(
      'Rellenar pantalla',
    );

    const inheritButton = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.gallery-fit-options button'),
    ).find((button) => button.textContent?.includes('Heredar del marco'))!;
    inheritButton.click();
    fixture.detectChanges();

    expect(updateMediaMock).toHaveBeenCalledWith(photo.id, { fitMode: 'inherit' });
    expect(compiled.querySelector('.gallery-options-dialog')).toBeNull();

    (compiled.querySelector('.gallery-card__options') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[aria-pressed="true"]')?.textContent).toContain(
      'Heredar del marco',
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('solicita rotación central y confirma antes de eliminar del marco', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('.gallery-card__options') as HTMLButtonElement).click();
    fixture.detectChanges();

    const rotateRight = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.gallery-operation-grid button'),
    ).find((button) => button.textContent?.includes('Derecha'))!;
    rotateRight.click();
    fixture.detectChanges();
    expect(rotateMediaMock).toHaveBeenCalledWith(photo.id, 90);
    expect(compiled.textContent).toContain('Rotación solicitada');

    fixture.destroy();

    const deleteFixture = TestBed.createComponent(App);
    deleteFixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(deleteFixture);
    const deleteComponent = deleteFixture.componentInstance as unknown as { openGallery(): void };
    deleteComponent.openGallery();
    deleteFixture.detectChanges();
    const deleteCompiled = deleteFixture.nativeElement as HTMLElement;
    (deleteCompiled.querySelector('.gallery-card__options') as HTMLButtonElement).click();
    deleteFixture.detectChanges();
    (deleteCompiled.querySelector('.gallery-delete-button') as HTMLButtonElement).click();
    deleteFixture.detectChanges();
    expect(deleteMediaMock).not.toHaveBeenCalled();
    const confirm = Array.from(
      deleteCompiled.querySelectorAll<HTMLButtonElement>('.gallery-danger-confirmation button'),
    ).find((button) => button.textContent?.includes('Sí, eliminar'))!;
    confirm.click();
    expect(deleteMediaMock).toHaveBeenCalledWith(photo.id);
    deleteFixture.destroy();
    vi.useRealTimers();
  });

  it('selecciona varios medios y confirma una sola eliminación por lote', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as unknown as { openGallery(): void };
    component.openGallery();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const select = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.gallery-toolbar > button'),
    ).find((button) => button.textContent?.includes('Seleccionar'))!;
    select.click();
    fixture.detectChanges();
    const cards = compiled.querySelectorAll<HTMLButtonElement>('.gallery-card__open');
    cards[0]!.click();
    cards[1]!.click();
    fixture.detectChanges();
    const remove = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.gallery-toolbar > button'),
    ).find((button) => button.textContent?.trim() === 'Eliminar')!;
    remove.click();
    fixture.detectChanges();
    expect(deleteMediaBatchMock).not.toHaveBeenCalled();
    const confirm = Array.from(
      compiled.querySelectorAll<HTMLButtonElement>('.gallery-danger-confirmation button'),
    ).find((button) => button.textContent?.includes('Sí, eliminar selección'))!;
    confirm.click();
    expect(deleteMediaBatchMock).toHaveBeenCalledTimes(1);
    expect(deleteMediaBatchMock.mock.calls[0]![0]).toHaveLength(2);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('organiza la configuración y muestra el clima entregado por el agente', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as { openSettings(): void };
    component.openSettings();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.settings-nav button')).toHaveLength(5);
    expect(compiled.textContent).toContain('Presentación');

    (compiled.querySelectorAll('.settings-nav button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Hora, fecha y clima');
    expect(compiled.textContent).toContain('Ubicación detectada');
    expect(compiled.textContent).toContain('Trujillo, La Libertad, PE');
    expect(compiled.querySelector('.corner-widgets')?.textContent).toContain('24°');

    (compiled.querySelectorAll('.settings-nav button')[4] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Vincular con este marco');
    expect(compiled.textContent).toContain('ABCD-2345-EFGH');
    expect(compiled.querySelector('.pairing-card__qr img')?.getAttribute('src')).toBe(
      '/api/v1/pairing/qr.png',
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('adopts the first populated manifest while the frame is empty', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, version: 0, media: [] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    servedManifest = manifest;
    await vi.advanceTimersByTimeAsync(2_000);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe(
      photo.url,
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('inicia el video automáticamente y mantiene sus controles visibles', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video');
    expect(element?.hasAttribute('autoplay')).toBe(true);
    expect(compiled.querySelector('.video-controls')).not.toBeNull();
    expect(compiled.textContent).toContain('Pausar');

    await vi.advanceTimersByTimeAsync(10_000);
    fixture.detectChanges();
    expect(compiled.querySelector('.video-controls')).not.toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('muestra el progreso del video y permite desplazarse a otra posición', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video')!;
    Object.defineProperty(element, 'duration', { configurable: true, value: 45.311 });
    element.currentTime = 12.5;
    element.dispatchEvent(new Event('timeupdate'));
    fixture.detectChanges();

    const progress = compiled.querySelector(
      'input[aria-label="Posición del video"]',
    ) as HTMLInputElement;
    expect(progress.value).toBe('12.5');
    expect(progress.max).toBe('45.311');
    expect(compiled.querySelector('.video-seek')?.textContent).toContain('0:12');
    expect(compiled.querySelector('.video-seek')?.textContent).toContain('0:45');

    progress.value = '20';
    progress.dispatchEvent(new Event('input'));
    expect(element.currentTime).toBe(20);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('avanza después del intervalo configurado si el video permanece pausado', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      settings: { ...DEFAULT_FRAME_SETTINGS, photoDurationSeconds: 3 },
      media: [video, photo],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video')!;
    Object.defineProperty(element, 'paused', { configurable: true, value: true });
    element.dispatchEvent(new Event('pause'));

    await vi.advanceTimersByTimeAsync(2_999);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--incoming')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('cancela el avance pendiente si el video se reanuda a tiempo', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      settings: { ...DEFAULT_FRAME_SETTINGS, photoDurationSeconds: 3 },
      media: [video, photo],
    };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video')!;
    let paused = true;
    Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
    vi.spyOn(element, 'play').mockResolvedValue();
    element.dispatchEvent(new Event('pause'));
    await vi.advanceTimersByTimeAsync(1_000);

    (compiled.querySelector('.video-actions button') as HTMLButtonElement).click();
    paused = false;
    element.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(3_000);
    fixture.detectChanges();

    expect(compiled.querySelector('.stage--stable video')).toBe(element);
    expect(compiled.querySelector('.stage--incoming')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('avanza inmediatamente al terminar un video sin esperar el intervalo fotográfico', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('video')
      ?.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(photo.url);

    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('reconoce el final efectivo aunque Chromium no emita ended', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    Object.defineProperty(element, 'duration', { configurable: true, value: 13.941667 });
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 13.941667 });
    Object.defineProperty(element, 'ended', { configurable: true, value: false });
    element.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--incoming img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    expect(reportPlaybackEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'viewer.playback.recovery' }),
    );
    expect(reportPlaybackEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'viewer.playback.skipped' }),
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('recupera una vez y avanza si Chromium deja de progresar a mitad del video', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, secondVideo, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    let element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    element.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);
    const incomingVideo = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--incoming video',
    ) as HTMLVideoElement;
    vi.spyOn(incomingVideo, 'play').mockResolvedValue();
    await vi.advanceTimersByTimeAsync(450);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    Object.defineProperty(element, 'duration', { configurable: true, value: 45.311 });
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 9 });
    Object.defineProperty(element, 'paused', { configurable: true, value: false });
    vi.spyOn(element, 'load').mockImplementation(() => undefined);
    element.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(5_999);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming img')).toBeNull();

    await vi.advanceTimersByTimeAsync(10);
    fixture.detectChanges();
    expect(element.src).toContain('naiskosRetry=');
    expect(reportPlaybackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewer.playback.recovery',
        mediaId: secondVideo.id,
      }),
    );

    await vi.advanceTimersByTimeAsync(9_999);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming img')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--incoming img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    expect(reportPlaybackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewer.playback.skipped',
        mediaId: secondVideo.id,
      }),
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('cierra la incidencia cuando el video vuelve a progresar después de recargarlo', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    let currentTime = 5;
    Object.defineProperty(element, 'duration', { configurable: true, value: 20 });
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(element, 'paused', { configurable: true, value: false });
    vi.spyOn(element, 'load').mockImplementation(() => undefined);
    element.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(6_000);

    currentTime = 5.6;
    element.dispatchEvent(new Event('timeupdate'));

    expect(reportPlaybackEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewer.playback.recovered',
        mediaId: video.id,
      }),
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('reinicia desde cero un video único cuando termina', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    const play = vi.spyOn(element, 'play').mockResolvedValue();
    element.currentTime = 10;
    element.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);

    expect(element.currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('no confunde una pausa manual cerca del final con un video atascado', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const element = compiled.querySelector('video')!;
    Object.defineProperty(element, 'duration', { configurable: true, value: 10 });
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 9 });
    Object.defineProperty(element, 'paused', { configurable: true, value: false });
    vi.spyOn(element, 'pause').mockImplementation(() => undefined);
    element.dispatchEvent(new Event('timeupdate'));

    (compiled.querySelector('.video-controls button') as HTMLButtonElement).click();
    element.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(2_000);
    fixture.detectChanges();

    expect(compiled.querySelector('.stage--stable video')).toBe(element);
    expect(compiled.querySelector('.stage--incoming')).toBeNull();
    expect(compiled.textContent).toContain('Reproducir');
    fixture.destroy();
    vi.useRealTimers();
  });

  it('requiere confirmación antes de solicitar una acción del sistema', async () => {
    const requestSystemAction = vi.fn(() => of({ accepted: true }));
    agentApiMock.requestSystemAction = requestSystemAction;
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      openSystemAction(action: 'exit' | 'poweroff'): void;
      confirmSystemAction(): void;
    };
    component.openSystemAction('poweroff');
    expect(requestSystemAction).not.toHaveBeenCalled();
    component.confirmSystemAction();
    expect(requestSystemAction).toHaveBeenCalledOnce();
    expect(requestSystemAction).toHaveBeenCalledWith('poweroff');
    fixture.destroy();
  });

  it('mantiene ambos medios durante el crossfade y conserva el entrante al terminar', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.stage')).toHaveLength(2);
    expect(compiled.querySelector('.stage--outgoing img')?.getAttribute('src')).toBe(photo.url);
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(
      secondPhoto.url,
    );

    await vi.advanceTimersByTimeAsync(449);
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    fixture.detectChanges();
    expect(compiled.querySelectorAll('.stage')).toHaveLength(1);
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(secondPhoto.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('ignora navegaciones adicionales durante el crossfade', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    component.navigate(1);
    component.navigate(-1);

    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(secondPhoto.url);
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('sustituye una preparación manual e ignora el evento tardío de la anterior', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1, preferredMediaId?: string, replaceActive?: boolean): void;
    };
    component.navigate(1);
    fixture.detectChanges();
    const staleImage = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging img',
    ) as HTMLImageElement;
    component.navigate(-1, undefined, true);
    fixture.detectChanges();
    Object.defineProperty(staleImage, 'decode', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    staleImage.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--incoming img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);

    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming')).toBeNull();
    fixture.destroy();
    vi.useRealTimers();
  });

  it('descarta un medio que falla y muestra el siguiente que sí queda listo', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    fixture.detectChanges();
    const failed = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging img',
    ) as HTMLImageElement;
    expect(failed.getAttribute('src')).toBe(secondPhoto.url);
    failed.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);
    await finishStagedTransition(fixture);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);
    expect(reportMediaPreparationFailureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'viewer.media.preparation-failed',
        mediaId: secondPhoto.id,
      }),
    );
    fixture.destroy();
    vi.useRealTimers();
  });

  it('conserva el último medio confirmado si todos los candidatos fallan', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    for (const expected of [secondPhoto, thirdPhoto]) {
      fixture.detectChanges();
      const staged = (fixture.nativeElement as HTMLElement).querySelector(
        '.stage--staging img',
      ) as HTMLImageElement;
      expect(staged.getAttribute('src')).toBe(expected.url);
      staged.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(0);
    }
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--staging')).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    expect(reportMediaPreparationFailureMock).toHaveBeenCalledTimes(2);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('cancela la preparación al entrar en reposo e ignora su carga tardía', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
      applyReposeState(state: ReposeState): void;
    };
    component.navigate(1);
    fixture.detectChanges();
    const staleImage = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging img',
    ) as HTMLImageElement;
    component.applyReposeState({
      ...awakeRepose,
      active: true,
      source: 'schedule',
      enteredAt: '2026-09-15T23:30:00.000Z',
      updatedAt: '2026-09-15T23:30:00.000Z',
    });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.repose-screen')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--staging')).toBeNull();

    Object.defineProperty(staleImage, 'decode', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    staleImage.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming')).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('valida el primer manifiesto y omite un primer medio que no puede prepararse', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const failed = compiled.querySelector('.stage--staging img') as HTMLImageElement;
    expect(compiled.querySelector('.stage--stable')).toBeNull();
    expect(failed.getAttribute('src')).toBe(photo.url);
    failed.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(compiled.querySelector('.stage--staging img')?.getAttribute('src')).toBe(
      secondPhoto.url,
    );
    await makeStagedMediaReady(fixture);
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(secondPhoto.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('mantiene pendiente un manifiesto recibido con un panel abierto y lo valida al cerrar', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.openMainMenu();
    component.receiveManifest({
      ...manifest,
      version: 2,
      media: [secondPhoto, photo],
    });
    fixture.detectChanges();

    expect(component.manifest().version).toBe(1);
    component.closeOverlay();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(secondPhoto.url);
    await finishStagedTransition(fixture);
    expect(component.manifest().version).toBe(2);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('aplica una variante con el mismo id y un hash nuevo incluso si es el único medio', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    const rotated = { ...photo, url: '/media/photo-1-rotated', sha256: 'def', rotationDegrees: 90 };
    component.receiveManifest({ ...manifest, version: 2, media: [rotated] });
    component.navigate(1);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(rotated.url);
    await finishStagedTransition(fixture);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(rotated.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('omite un video que falla durante la preparación y continúa con la fotografía siguiente', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, video, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.navigate(1);
    fixture.detectChanges();
    const failed = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging video',
    ) as HTMLVideoElement;
    Object.defineProperty(failed, 'error', { configurable: true, value: { code: 4 } });
    failed.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(secondPhoto.url);
    await finishStagedTransition(fixture);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('agota el timeout de un candidato y continúa sin bloquear la presentación', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.navigate(1);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(secondPhoto.url);

    await vi.advanceTimersByTimeAsync(5_000);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);
    await finishStagedTransition(fixture);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('sustituye de forma segura el manifiesto mientras otro candidato está preparándose', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.navigate(1);
    fixture.detectChanges();
    const stale = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging img',
    ) as HTMLImageElement;
    component.receiveManifest({ ...manifest, version: 2, media: [thirdPhoto, photo] });
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--staging img')
        ?.getAttribute('src'),
    ).toBe(thirdPhoto.url);

    Object.defineProperty(stale, 'decode', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    stale.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    await finishStagedTransition(fixture);
    expect(component.manifest().version).toBe(2);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('cancela una preparación de video y un crossfade al entrar en reposo', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, video] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const component = fixture.componentInstance as any;
    component.navigate(1);
    fixture.detectChanges();
    const staleVideo = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--staging video',
    ) as HTMLVideoElement;
    component.applyReposeState({
      ...awakeRepose,
      active: true,
      source: 'schedule',
      enteredAt: '2026-09-15T23:30:00.000Z',
      updatedAt: '2026-09-15T23:30:00.000Z',
    });
    Object.defineProperty(staleVideo, 'readyState', { configurable: true, value: 2 });
    staleVideo.dispatchEvent(new Event('loadeddata'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--staging')).toBeNull();

    component.applyReposeState({ ...awakeRepose, updatedAt: '2026-09-15T23:31:00.000Z' });
    component.navigate(1);
    fixture.detectChanges();
    await makeStagedMediaReady(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.stage--incoming video'),
    ).not.toBeNull();
    component.applyReposeState({
      ...awakeRepose,
      active: true,
      source: 'schedule',
      enteredAt: '2026-09-15T23:32:00.000Z',
      updatedAt: '2026-09-15T23:32:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--stable img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('no reescribe un checkpoint fotográfico idéntico en cada heartbeat', async () => {
    vi.useFakeTimers();
    servedManifest = {
      ...manifest,
      settings: { ...DEFAULT_FRAME_SETTINGS, photoDurationSeconds: 86_400 },
    };
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await makeStagedMediaReady(fixture);
    const initialWrites = writes.mock.calls.filter(
      ([key]) => key === 'naiskos.playback-checkpoint.v1',
    ).length;

    await vi.advanceTimersByTimeAsync(60_000);
    const finalWrites = writes.mock.calls.filter(
      ([key]) => key === 'naiskos.playback-checkpoint.v1',
    ).length;
    expect(finalWrites).toBe(initialWrites);
    fixture.destroy();
    vi.useRealTimers();
  });
});
