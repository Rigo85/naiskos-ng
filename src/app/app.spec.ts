import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { App } from './app';
import { AgentApi } from './core/agent-api';
import { MediaReadiness } from './core/media-readiness';
import {
  DEFAULT_FRAME_SETTINGS,
  FrameManifest,
  FrameNotification,
  MediaItem,
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
const markAllNotificationsReadMock = vi.fn(() => of({ updated: 1 }));
const dismissNotificationMock = vi.fn(() => of(undefined));

const agentApiMock = {
  getManifest: () => of(servedManifest),
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
  updateSettings: () => of(DEFAULT_FRAME_SETTINGS),
  resetSettings: () => of(DEFAULT_FRAME_SETTINGS),
  updateMedia: updateMediaMock,
  rotateMedia: rotateMediaMock,
  deleteMedia: deleteMediaMock,
  requestSystemAction: () => of({ accepted: true }),
};

const mediaReadinessMock = {
  prepare: vi.fn(() => Promise.resolve()),
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

describe('App', () => {
  beforeEach(async () => {
    servedManifest = manifest;
    servedNotifications = [];
    mediaReadinessMock.prepare.mockClear();
    updateMediaMock.mockClear();
    rotateMediaMock.mockClear();
    deleteMediaMock.mockClear();
    markAllNotificationsReadMock.mockClear();
    dismissNotificationMock.mockClear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AgentApi, useValue: agentApiMock },
        { provide: MediaReadiness, useValue: mediaReadinessMock },
      ],
    }).compileComponents();
  });

  it('creates the kiosk viewer', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    fixture.destroy();
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
    ];
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const bell = compiled.querySelector('.notification-bell') as HTMLButtonElement;
    expect(bell.textContent).toContain('1');
    expect(bell.querySelector('svg path')).not.toBeNull();
    bell.click();
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Almacenamiento casi lleno');
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
    expect(compiled.querySelector('.stage--stable video')?.getAttribute('src')).toBe(video.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('desplaza la galería al arrastrar y no abre accidentalmente una tarjeta', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

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

  it('organiza la configuración y muestra el clima entregado por el agente', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    const component = fixture.componentInstance as unknown as { openSettings(): void };
    component.openSettings();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.settings-nav button')).toHaveLength(6);
    expect(compiled.textContent).toContain('Presentación');

    (compiled.querySelectorAll('.settings-nav button')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.textContent).toContain('Hora, fecha y clima');
    expect(compiled.textContent).toContain('Ubicación detectada');
    expect(compiled.textContent).toContain('Trujillo, La Libertad, PE');
    expect(compiled.querySelector('.corner-widgets')?.textContent).toContain('24°');

    (compiled.querySelectorAll('.settings-nav button')[5] as HTMLButtonElement).click();
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
    fixture.detectChanges();

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
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement)
      .querySelector('video')
      ?.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.stage--incoming img')?.getAttribute('src')).toBe(photo.url);

    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();
    expect(compiled.querySelector('.stage--stable img')?.getAttribute('src')).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('avanza si Chromium deja de progresar cerca del final sin emitir ended', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, secondVideo, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    let element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    element.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    const incomingVideo = (fixture.nativeElement as HTMLElement).querySelector(
      '.stage--incoming video',
    ) as HTMLVideoElement;
    vi.spyOn(incomingVideo, 'play').mockResolvedValue();
    await vi.advanceTimersByTimeAsync(450);
    fixture.detectChanges();

    element = (fixture.nativeElement as HTMLElement).querySelector('video')!;
    Object.defineProperty(element, 'duration', { configurable: true, value: 45.311 });
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 44.306 });
    Object.defineProperty(element, 'paused', { configurable: true, value: false });
    element.dispatchEvent(new Event('timeupdate'));
    await vi.advanceTimersByTimeAsync(1_504);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.stage--incoming img')).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--incoming img')
        ?.getAttribute('src'),
    ).toBe(photo.url);
    fixture.destroy();
    vi.useRealTimers();
  });

  it('no confunde una pausa manual cerca del final con un video atascado', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [video, photo] };
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
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

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

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

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    await vi.advanceTimersByTimeAsync(0);
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

  it('ignora un avance manual mientras el cambio anterior se está preparando', async () => {
    vi.useFakeTimers();
    servedManifest = { ...manifest, media: [photo, secondPhoto, thirdPhoto] };
    let finishPreparation: (() => void) | undefined;
    mediaReadinessMock.prepare.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        }),
    );
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);

    const component = fixture.componentInstance as unknown as {
      navigate(direction: -1 | 1): void;
    };
    component.navigate(1);
    component.navigate(1);
    finishPreparation?.();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.stage--incoming img')
        ?.getAttribute('src'),
    ).toBe(secondPhoto.url);

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
});
