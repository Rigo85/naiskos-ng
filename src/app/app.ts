import {
  Component,
  ElementRef,
  OnDestroy,
  QueryList,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';

import { AgentApi, SystemAction } from './core/agent-api';
import { MediaReadiness } from './core/media-readiness';
import {
  DEFAULT_FRAME_SETTINGS,
  EMPTY_WEATHER,
  FitMode,
  FrameNotification,
  FrameManifest,
  FrameSettings,
  MediaFitMode,
  MediaItem,
  MediaRotation,
  ProvisioningStatus,
  WeatherSnapshot,
} from './core/models';
import { classifyGesture, GesturePoint } from './core/pointer-gestures';
import {
  IDENTITY_PHOTO_TRANSFORM,
  PhotoTransform,
  ZoomPoint,
  ZoomSurface,
  panTransform,
  pinchTransform,
  pointDistance,
  pointMidpoint,
} from './core/photo-zoom';
import {
  activatePendingManifest,
  adjacentIndex,
  orderManifestMedia,
} from './core/slideshow-policy';

type SlidePhase = 'stable' | 'outgoing' | 'incoming';
type AppView = 'viewer' | 'menu' | 'gallery' | 'settings' | 'notifications';
type GalleryFilter = 'all' | 'photo' | 'video';
type GalleryOrder = 'newest' | 'oldest';
type SettingsSection =
  'presentation' | 'widgets' | 'playback' | 'storage' | 'notifications' | 'device';

interface RenderedSlide {
  item: MediaItem;
  phase: SlidePhase;
  fitMode: FitMode;
}

interface CrossfadeState {
  outgoing: MediaItem;
  outgoingFitMode: FitMode;
  incoming: MediaItem;
  incomingFitMode: FitMode;
  durationMs: number;
}

interface NavigationTarget {
  manifest: FrameManifest;
  index: number;
  item: MediaItem;
}

interface GalleryDragState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollTop: number;
}

interface GalleryOperation {
  mediaId: string;
  kind: 'rotation' | 'deletion';
  targetRotation?: MediaRotation;
}

interface ActivePhotoTransform extends PhotoTransform {
  mediaId: string | null;
}

interface ActivePointer {
  x: number;
  y: number;
}

interface PinchGestureState {
  kind: 'pinch';
  mediaId: string;
  pointerIds: [number, number];
  startTransform: PhotoTransform;
  startDistance: number;
  startMidpoint: ZoomPoint;
  surface: ZoomSurface;
  surfaceLeft: number;
  surfaceTop: number;
  changed: boolean;
}

interface PanGestureState {
  kind: 'pan';
  mediaId: string;
  pointerId: number;
  startTransform: PhotoTransform;
  startPointer: ZoomPoint;
  surface: ZoomSurface;
  changed: boolean;
}

type PhotoGestureState = PinchGestureState | PanGestureState;

const VIDEO_END_WATCHDOG_GRACE_MS = 500;
const VIDEO_END_STALL_WINDOW_SECONDS = 2;
const GALLERY_DRAG_THRESHOLD_PX = 8;
const GALLERY_SYNTHETIC_CLICK_WINDOW_MS = 250;
const PHOTO_GESTURE_THRESHOLD_PX = 8;
const PHOTO_PINCH_SCALE_THRESHOLD = 0.02;
const PHOTO_ZOOM_ACTIVE_THRESHOLD = 1.001;

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private readonly agent = inject(AgentApi);
  private readonly mediaReadiness = inject(MediaReadiness);
  private readonly subscriptions = new Subscription();

  @ViewChildren('videoElement')
  private videoElements?: QueryList<ElementRef<HTMLVideoElement>>;

  protected readonly manifest = signal<FrameManifest | null>(null);
  protected readonly provisioning = signal<ProvisioningStatus | null>(null);
  protected readonly weather = signal<WeatherSnapshot>({ ...EMPTY_WEATHER });
  protected readonly notifications = signal<FrameNotification[]>([]);
  protected readonly pendingManifest = signal<FrameManifest | null>(null);
  protected readonly currentIndex = signal(0);
  protected readonly loading = signal(true);
  protected readonly connectionWarning = signal<string | null>(null);
  protected readonly activeView = signal<AppView>('viewer');
  protected readonly settingsOpen = computed(() => this.activeView() === 'settings');
  protected readonly overlayOpen = computed(() => this.activeView() !== 'viewer');
  protected readonly settingsSection = signal<SettingsSection>('presentation');
  protected readonly galleryFilter = signal<GalleryFilter>('all');
  protected readonly galleryOrder = signal<GalleryOrder>('newest');
  protected readonly galleryDragging = signal(false);
  protected readonly galleryOptionsItem = signal<MediaItem | null>(null);
  protected readonly galleryOptionsSaving = signal(false);
  protected readonly galleryOptionsError = signal<string | null>(null);
  protected readonly galleryOptionsMessage = signal<string | null>(null);
  protected readonly galleryDeleteConfirming = signal(false);
  protected readonly galleryOperation = signal<GalleryOperation | null>(null);
  protected readonly now = signal(new Date());
  protected readonly videoPaused = signal(false);
  protected readonly videoCurrentTime = signal(0);
  protected readonly videoDuration = signal(0);
  protected readonly systemActionPending = signal<SystemAction | null>(null);
  protected readonly systemActionInProgress = signal(false);
  protected readonly systemActionError = signal<string | null>(null);
  protected readonly provisioningResetPending = signal(false);
  protected readonly pairingRotationPending = signal(false);
  protected readonly pairingRotationError = signal<string | null>(null);
  protected readonly notificationsError = signal<string | null>(null);
  protected readonly preparingTransition = signal(false);
  protected readonly crossfade = signal<CrossfadeState | null>(null);
  protected readonly photoTransform = signal<ActivePhotoTransform>({
    mediaId: null,
    ...IDENTITY_PHOTO_TRANSFORM,
  });

  protected settingsDraft: FrameSettings = { ...DEFAULT_FRAME_SETTINGS };
  protected readonly settings = computed(() => this.manifest()?.settings ?? DEFAULT_FRAME_SETTINGS);
  protected readonly unreadNotifications = computed(
    () => this.notifications().filter((item) => !item.readAt).length,
  );
  protected readonly media = computed(() => this.manifest()?.media ?? []);
  protected readonly currentMedia = computed(() => this.media()[this.currentIndex()] ?? null);
  protected readonly galleryItems = computed(() => {
    const filter = this.galleryFilter();
    const direction = this.galleryOrder() === 'newest' ? -1 : 1;
    return this.media()
      .filter((item) => filter === 'all' || item.kind === filter)
      .sort(
        (left, right) =>
          direction * (new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime()),
      );
  });
  protected readonly storageSummary = computed(() => {
    const photoItems = this.media().filter((item) => item.kind === 'photo');
    const videoItems = this.media().filter((item) => item.kind === 'video');
    const total = (items: MediaItem[]) =>
      items.reduce(
        (sum, item) =>
          sum +
          this.numericBytes(item.sizeBytes) +
          this.numericBytes(item.posterSizeBytes) +
          this.numericBytes(item.thumbnailSizeBytes),
        0,
      );
    const photoBytes = total(photoItems);
    const videoBytes = total(videoItems);
    return {
      photoCount: photoItems.length,
      videoCount: videoItems.length,
      photoBytes,
      videoBytes,
      totalBytes: photoBytes + videoBytes,
    };
  });
  protected readonly displayTime = computed(() =>
    new Intl.DateTimeFormat('es-PE', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !this.settings().use24Hour,
      ...(this.weather().location?.timezone ? { timeZone: this.weather().location!.timezone } : {}),
    }).format(this.now()),
  );
  protected readonly displayDate = computed(() =>
    new Intl.DateTimeFormat('es-PE', {
      day: 'numeric',
      month: 'short',
      ...(this.weather().location?.timezone ? { timeZone: this.weather().location!.timezone } : {}),
    }).format(this.now()),
  );
  protected readonly weatherIcon = computed(() => {
    const current = this.weather().current;
    if (!current || this.weather().status !== 'ready') return '◌';
    return iconForWeatherCode(current.weatherCode, current.isDay);
  });
  protected readonly weatherDescription = computed(() => {
    const current = this.weather().current;
    return current ? descriptionForWeatherCode(current.weatherCode) : 'Clima pendiente';
  });
  protected readonly renderedSlides = computed<RenderedSlide[]>(() => {
    const crossfade = this.crossfade();
    if (crossfade) {
      return [
        {
          item: crossfade.outgoing,
          phase: 'outgoing',
          fitMode: crossfade.outgoingFitMode,
        },
        {
          item: crossfade.incoming,
          phase: 'incoming',
          fitMode: crossfade.incomingFitMode,
        },
      ];
    }
    const current = this.currentMedia();
    return current
      ? [{ item: current, phase: 'stable', fitMode: this.fitModeFor(current, this.settings()) }]
      : [];
  });
  protected readonly preloadUrls = computed(() => {
    const media = this.media();
    if (media.length < 2) return [];
    const index = this.currentIndex();
    const neighbors = [
      media[adjacentIndex(media.length, index, -1)],
      media[adjacentIndex(media.length, index, 1)],
    ];
    return [
      ...new Set(
        neighbors.flatMap((item) => {
          if (!item) return [];
          if (item.kind === 'photo') return [item.url];
          return item.posterUrl ? [item.posterUrl] : [];
        }),
      ),
    ];
  });
  protected readonly effectiveFitMode = computed<FitMode>(() => {
    const media = this.currentMedia();
    if (!media || media.fitMode === 'inherit') {
      return this.settings().defaultFitMode;
    }
    return media.fitMode;
  });

  private pointerStart: (GesturePoint & { pointerId: number }) | null = null;
  private readonly activePointers = new Map<number, ActivePointer>();
  private photoGesture: PhotoGestureState | null = null;
  private suppressNavigationUntilPointersClear = false;
  private photoTimerInteractionMediaId: string | null = null;
  private photoTimer: number | undefined;
  private photoTimerGeneration = 0;
  private crossfadeTimer: number | undefined;
  private videoEndWatchdogTimer: number | undefined;
  private pausedVideoAdvanceTimer: number | undefined;
  private navigationGeneration = 0;
  private lastTapAt = 0;
  private lastTapSide: 'left' | 'right' | null = null;
  private galleryDrag: GalleryDragState | null = null;
  private suppressGalleryClick = false;
  private galleryLastDragAt = 0;
  private galleryClickResetTimer: number | undefined;

  constructor() {
    this.subscriptions.add(
      timer(0, 2_000)
        .pipe(
          switchMap(() =>
            this.agent.getManifest().pipe(
              catchError((error: HttpErrorResponse) => {
                this.loading.set(false);
                this.connectionWarning.set(
                  error.status === 0
                    ? 'Esperando al agente local…'
                    : 'No se pudo leer el manifiesto local.',
                );
                return of(null);
              }),
            ),
          ),
        )
        .subscribe((manifest) => {
          if (manifest) {
            this.receiveManifest(manifest);
          }
        }),
    );
    this.subscriptions.add(timer(0, 1_000).subscribe(() => this.now.set(new Date())));
    this.subscriptions.add(
      timer(0, 60_000)
        .pipe(switchMap(() => this.agent.getWeather().pipe(catchError(() => of(null)))))
        .subscribe((weather) => {
          if (weather) this.weather.set(weather);
        }),
    );
    this.subscriptions.add(
      timer(0, 3_000)
        .pipe(switchMap(() => this.agent.getProvisioningStatus().pipe(catchError(() => of(null)))))
        .subscribe((status) => {
          if (status) this.provisioning.set(status);
        }),
    );
    this.subscriptions.add(
      timer(0, 3_000)
        .pipe(switchMap(() => this.agent.getNotifications().pipe(catchError(() => of(null)))))
        .subscribe((result) => {
          if (result) this.notifications.set(result.notifications);
        }),
    );

    effect(() => {
      const current = this.currentMedia();
      const duration = this.settings().photoDurationSeconds;
      const transitionActive = this.preparingTransition() || this.crossfade() !== null;
      if (transitionActive) {
        this.clearPhotoTimer();
      } else {
        this.schedulePhotoAdvance(current, duration);
      }
    });
  }

  ngOnDestroy(): void {
    this.navigationGeneration += 1;
    this.subscriptions.unsubscribe();
    this.clearPhotoTimer();
    this.clearCrossfadeTimer();
    this.clearVideoEndWatchdog();
    this.clearPausedVideoAdvance();
    this.clearGalleryClickReset();
    this.clearViewerPointers();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.overlayOpen()) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    if (this.activePointers.size === 0) {
      this.beginPhotoTimerInteraction();
    }
    if (typeof target.setPointerCapture === 'function') {
      target.setPointerCapture(event.pointerId);
    }
    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (this.activePointers.size > 1) {
      this.pointerStart = null;
      this.suppressNavigationUntilPointersClear = true;
      if (this.activePointers.size === 2 && this.canManipulateCurrentPhoto()) {
        this.startPinchGesture(target);
      }
      return;
    }

    this.pointerStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    };

    const current = this.currentMedia();
    const transform = this.photoTransform();
    if (
      current?.kind === 'photo' &&
      transform.mediaId === current.id &&
      transform.scale > PHOTO_ZOOM_ACTIVE_THRESHOLD
    ) {
      const bounds = target.getBoundingClientRect();
      this.photoGesture = {
        kind: 'pan',
        mediaId: current.id,
        pointerId: event.pointerId,
        startTransform: this.photoTransformValue(transform),
        startPointer: { x: event.clientX, y: event.clientY },
        surface: { width: bounds.width, height: bounds.height },
        changed: false,
      };
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId) || this.overlayOpen()) {
      return;
    }

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const gesture = this.photoGesture;
    if (!gesture || this.currentMedia()?.id !== gesture.mediaId) {
      return;
    }

    if (gesture.kind === 'pinch') {
      const left = this.activePointers.get(gesture.pointerIds[0]);
      const right = this.activePointers.get(gesture.pointerIds[1]);
      if (!left || !right) {
        return;
      }
      const leftPoint = this.relativePointer(left, gesture.surfaceLeft, gesture.surfaceTop);
      const rightPoint = this.relativePointer(right, gesture.surfaceLeft, gesture.surfaceTop);
      const currentMidpoint = pointMidpoint(leftPoint, rightPoint);
      const next = pinchTransform(
        gesture.startTransform,
        gesture.startDistance,
        gesture.startMidpoint,
        pointDistance(leftPoint, rightPoint),
        currentMidpoint,
        gesture.surface,
      );
      this.photoTransform.set({ mediaId: gesture.mediaId, ...next });
      const scaleChanged =
        Math.abs(next.scale / gesture.startTransform.scale - 1) >= PHOTO_PINCH_SCALE_THRESHOLD;
      const midpointMoved =
        pointDistance(gesture.startMidpoint, currentMidpoint) >= PHOTO_GESTURE_THRESHOLD_PX;
      if (scaleChanged || midpointMoved) {
        this.markPhotoGestureChanged(gesture);
      }
      event.preventDefault();
      return;
    }

    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - gesture.startPointer.x;
    const deltaY = event.clientY - gesture.startPointer.y;
    const next = panTransform(gesture.startTransform, deltaX, deltaY, gesture.surface);
    this.photoTransform.set({ mediaId: gesture.mediaId, ...next });
    if (Math.hypot(deltaX, deltaY) >= PHOTO_GESTURE_THRESHOLD_PX) {
      this.markPhotoGestureChanged(gesture);
    }
    event.preventDefault();
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId)) {
      return;
    }

    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const gesture = this.photoGesture;
    let consumed = false;
    if (gesture && this.photoGestureIncludesPointer(gesture, event.pointerId)) {
      if (gesture.changed) {
        consumed = true;
      } else {
        this.photoTransform.set({ mediaId: gesture.mediaId, ...gesture.startTransform });
      }
      if (gesture.kind === 'pinch') {
        this.suppressNavigationUntilPointersClear = true;
        consumed = true;
      }
      this.photoGesture = null;
    }

    this.activePointers.delete(event.pointerId);
    if (this.suppressNavigationUntilPointersClear) {
      this.pointerStart = null;
      if (this.activePointers.size === 0) {
        this.suppressNavigationUntilPointersClear = false;
        this.finishPhotoTimerInteraction();
      }
      return;
    }
    if (consumed || this.overlayOpen()) {
      this.pointerStart = null;
      this.finishPhotoTimerInteraction();
      return;
    }
    if (!this.pointerStart || this.pointerStart.pointerId !== event.pointerId) {
      this.finishPhotoTimerInteraction();
      return;
    }

    const start = this.pointerStart;
    this.pointerStart = null;
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    const end: GesturePoint = {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    };
    const action = classifyGesture(start, end, bounds.width);

    if (action === 'open-settings') {
      this.abandonPhotoTimerInteraction();
      this.openMainMenu();
      return;
    }
    if (action === 'next') {
      this.abandonPhotoTimerInteraction();
      this.navigate(1);
      return;
    }
    if (action === 'previous') {
      this.abandonPhotoTimerInteraction();
      this.navigate(-1);
      return;
    }
    if (action === 'tap-left' || action === 'tap-right') {
      const side = action === 'tap-left' ? 'left' : 'right';
      const isSecondTap = this.lastTapSide === side && event.timeStamp - this.lastTapAt <= 350;
      this.lastTapAt = event.timeStamp;
      this.lastTapSide = side;
      if (!isSecondTap) {
        this.abandonPhotoTimerInteraction();
        this.navigate(side === 'left' ? -1 : 1);
        return;
      }
    }
    this.finishPhotoTimerInteraction();
  }

  protected cancelPointer(event: PointerEvent): void {
    const gesture = this.photoGesture;
    if (gesture && this.photoGestureIncludesPointer(gesture, event.pointerId)) {
      if (!gesture.changed) {
        this.photoTransform.set({ mediaId: gesture.mediaId, ...gesture.startTransform });
      }
      this.photoGesture = null;
    }
    this.activePointers.delete(event.pointerId);
    this.pointerStart = null;
    this.suppressNavigationUntilPointersClear = this.activePointers.size > 0;
    if (this.activePointers.size === 0) {
      this.finishPhotoTimerInteraction();
    }
  }

  protected preventContextMenu(event: Event): void {
    event.preventDefault();
  }

  protected openMainMenu(): void {
    this.openOverlay('menu');
  }

  protected openGallery(): void {
    this.closeGalleryOptions();
    this.openOverlay('gallery');
  }

  protected openGalleryOptions(item: MediaItem, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.galleryOptionsError.set(null);
    this.galleryOptionsMessage.set(null);
    this.galleryDeleteConfirming.set(false);
    this.galleryOperation.set(null);
    this.galleryOptionsItem.set(item);
  }

  protected closeGalleryOptions(): void {
    if (this.galleryOptionsSaving()) {
      return;
    }
    this.galleryOptionsItem.set(null);
    this.galleryOptionsError.set(null);
    this.galleryOptionsMessage.set(null);
    this.galleryDeleteConfirming.set(false);
  }

  protected setGalleryFitMode(fitMode: MediaFitMode): void {
    const item = this.galleryOptionsItem();
    if (!item || this.galleryOptionsSaving()) {
      return;
    }
    if (item.fitMode === fitMode) {
      this.closeGalleryOptions();
      return;
    }

    this.galleryOptionsSaving.set(true);
    this.galleryOptionsError.set(null);
    this.agent.updateMedia(item.id, { fitMode }).subscribe({
      next: (updated) => {
        this.replaceMedia(updated);
        this.galleryOptionsSaving.set(false);
        this.closeGalleryOptions();
      },
      error: () => {
        this.galleryOptionsSaving.set(false);
        this.galleryOptionsError.set('No se pudo guardar el encuadre.');
      },
    });
  }

  protected rotateGalleryItem(direction: 'left' | 'right' | 'reset'): void {
    const item = this.galleryOptionsItem();
    if (!item || this.galleryOptionsSaving() || this.galleryOperation()?.mediaId === item.id) {
      return;
    }
    const rotationDegrees = (
      direction === 'reset'
        ? 0
        : direction === 'right'
          ? (item.rotationDegrees + 90) % 360
          : (item.rotationDegrees + 270) % 360
    ) as MediaRotation;
    if (rotationDegrees === item.rotationDegrees) {
      this.galleryOptionsMessage.set('El medio ya tiene su orientación original.');
      return;
    }
    this.galleryOptionsSaving.set(true);
    this.galleryOptionsError.set(null);
    this.galleryOptionsMessage.set(null);
    this.agent.rotateMedia(item.id, rotationDegrees).subscribe({
      next: () => {
        this.galleryOptionsSaving.set(false);
        this.galleryOperation.set({
          mediaId: item.id,
          kind: 'rotation',
          targetRotation: rotationDegrees,
        });
        this.galleryOptionsMessage.set(
          item.kind === 'video'
            ? 'Rotación solicitada. El video y su póster se están procesando.'
            : 'Rotación solicitada. La fotografía actual seguirá visible hasta terminar.',
        );
      },
      error: () => {
        this.galleryOptionsSaving.set(false);
        this.galleryOptionsError.set('No se pudo solicitar la rotación.');
      },
    });
  }

  protected requestGalleryDelete(): void {
    if (!this.galleryOptionsSaving()) {
      this.galleryOptionsError.set(null);
      this.galleryOptionsMessage.set(null);
      this.galleryDeleteConfirming.set(true);
    }
  }

  protected cancelGalleryDelete(): void {
    if (!this.galleryOptionsSaving()) this.galleryDeleteConfirming.set(false);
  }

  protected confirmGalleryDelete(): void {
    const item = this.galleryOptionsItem();
    if (!item || this.galleryOptionsSaving()) return;
    this.galleryOptionsSaving.set(true);
    this.galleryOptionsError.set(null);
    this.agent.deleteMedia(item.id).subscribe({
      next: () => {
        this.galleryOptionsSaving.set(false);
        this.galleryDeleteConfirming.set(false);
        this.galleryOperation.set({ mediaId: item.id, kind: 'deletion' });
        this.galleryOptionsMessage.set(
          'Eliminación solicitada. Desaparecerá cuando llegue el manifiesto confirmado.',
        );
      },
      error: () => {
        this.galleryOptionsSaving.set(false);
        this.galleryOptionsError.set('No se pudo solicitar la eliminación.');
      },
    });
  }

  protected onGalleryPointerDown(event: PointerEvent): void {
    event.stopPropagation();
    if (event.pointerType === 'touch' || event.button !== 0) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    this.clearGalleryClickReset();
    this.suppressGalleryClick = false;
    this.galleryLastDragAt = 0;
    this.galleryDragging.set(false);
    this.galleryDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollTop: target.scrollTop,
    };
  }

  protected onGalleryPointerMove(event: PointerEvent): void {
    const drag = this.galleryDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!this.galleryDragging()) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < GALLERY_DRAG_THRESHOLD_PX) {
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.finishGalleryDrag(event, false);
        return;
      }
      this.galleryDragging.set(true);
    }

    event.preventDefault();
    this.suppressGalleryClick = true;
    this.galleryLastDragAt = Date.now();
    (event.currentTarget as HTMLElement).scrollTop = drag.scrollTop - deltaY;
  }

  protected onGalleryPointerUp(event: PointerEvent): void {
    event.stopPropagation();
    this.finishGalleryDrag(event, this.galleryDragging());
  }

  protected onGalleryPointerCancel(event: PointerEvent): void {
    event.stopPropagation();
    this.finishGalleryDrag(event, false);
  }

  protected openNotifications(): void {
    this.openOverlay('notifications');
    this.notificationsError.set(null);
    if (this.unreadNotifications() === 0) return;
    const readAt = new Date().toISOString();
    const previous = this.notifications();
    this.notifications.set(
      previous.map((item) => (item.readAt ? item : { ...item, readAt, updatedAt: readAt })),
    );
    this.agent.markAllNotificationsRead().subscribe({
      error: () => {
        this.notifications.set(previous);
        this.notificationsError.set('No se pudieron marcar los avisos como leídos.');
      },
    });
  }

  protected dismissNotification(notificationId: string): void {
    const previous = this.notifications();
    this.notifications.set(previous.filter((item) => item.id !== notificationId));
    this.notificationsError.set(null);
    this.agent.dismissNotification(notificationId).subscribe({
      error: () => {
        this.notifications.set(previous);
        this.notificationsError.set('No se pudo ocultar la notificación.');
      },
    });
  }

  protected formatNotificationTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: !this.settings().use24Hour,
    }).format(date);
  }

  protected openSettings(): void {
    this.settingsDraft = { ...this.settings() };
    this.settingsSection.set('presentation');
    this.openOverlay('settings');
  }

  protected closeSettings(): void {
    this.closeOverlay();
  }

  protected closeOverlay(): void {
    this.closeGalleryOptions();
    this.activeView.set('viewer');
    this.resumeCurrentCycle();
  }

  protected showGalleryItem(mediaId: string, event?: MouseEvent): void {
    const isSyntheticDragClick =
      this.suppressGalleryClick &&
      Date.now() - this.galleryLastDragAt <= GALLERY_SYNTHETIC_CLICK_WINDOW_MS;
    if (isSyntheticDragClick) {
      event?.preventDefault();
      event?.stopPropagation();
      this.suppressGalleryClick = false;
      this.clearGalleryClickReset();
      return;
    }
    this.suppressGalleryClick = false;
    this.galleryDrag = null;
    this.galleryDragging.set(false);
    this.clearGalleryClickReset();
    const index = this.media().findIndex((item) => item.id === mediaId);
    if (index < 0) {
      return;
    }
    this.clearViewerPointers();
    this.resetPhotoTransform();
    this.currentIndex.set(index);
    this.videoPaused.set(false);
    this.videoCurrentTime.set(0);
    this.videoDuration.set(0);
    this.closeOverlay();
  }

  protected saveSettings(): void {
    const normalized: FrameSettings = {
      ...this.settingsDraft,
      photoDurationSeconds: Math.min(
        86_400,
        Math.max(1, Math.round(this.settingsDraft.photoDurationSeconds)),
      ),
      volume: Math.min(1, Math.max(0, this.settingsDraft.volume)),
    };

    this.agent.updateSettings(normalized).subscribe({
      next: (settings) => {
        this.replaceSettings(settings);
        this.settingsDraft = { ...settings };
        this.applyVolumeToVideo();
        this.closeSettings();
      },
      error: () => this.connectionWarning.set('No se pudieron guardar los ajustes.'),
    });
  }

  protected resetSettings(): void {
    this.agent.resetSettings().subscribe({
      next: (settings) => {
        this.replaceSettings(settings);
        this.settingsDraft = { ...settings };
        this.applyVolumeToVideo();
      },
      error: () => this.connectionWarning.set('No se pudieron restaurar los ajustes.'),
    });
  }

  protected openSystemAction(action: SystemAction): void {
    this.systemActionError.set(null);
    this.systemActionPending.set(action);
  }

  protected cancelSystemAction(): void {
    if (!this.systemActionInProgress()) {
      this.systemActionPending.set(null);
      this.systemActionError.set(null);
    }
  }

  protected confirmSystemAction(): void {
    const action = this.systemActionPending();
    if (!action || this.systemActionInProgress()) {
      return;
    }
    this.systemActionInProgress.set(true);
    this.systemActionError.set(null);
    this.agent.requestSystemAction(action).subscribe({
      next: () => {
        // El lanzador recibe la acción y cierra Chromium o apaga el equipo.
      },
      error: () => {
        this.systemActionInProgress.set(false);
        this.systemActionError.set(
          action === 'exit' ? 'No se pudo cerrar Naiskos.' : 'No se pudo solicitar el apagado.',
        );
      },
    });
  }

  protected updateCurrentFitMode(fitMode: MediaFitMode): void {
    const media = this.currentMedia();
    if (!media) {
      return;
    }
    this.agent.updateMedia(media.id, { fitMode }).subscribe({
      next: (updated) => this.replaceMedia(updated),
      error: () => this.connectionWarning.set('No se pudo cambiar el encuadre.'),
    });
  }

  protected onVideoLoaded(video: HTMLVideoElement, mediaId: string): void {
    video.volume = this.settings().volume;
    video.muted = this.settings().muted;
    if (this.currentMedia()?.id === mediaId) {
      this.updateVideoProgress(video);
    }
    if (
      this.currentMedia()?.id !== mediaId ||
      this.preparingTransition() ||
      this.crossfade() ||
      this.overlayOpen()
    ) {
      video.pause();
      return;
    }
    this.videoPaused.set(false);
    this.clearPausedVideoAdvance();
    void video.play().catch(() => {
      this.videoPaused.set(true);
      this.schedulePausedVideoAdvance(mediaId);
    });
  }

  protected onVideoEnded(mediaId: string): void {
    this.completeVideo(mediaId);
  }

  protected onVideoPlaying(video: HTMLVideoElement, mediaId: string): void {
    if (this.currentMedia()?.id === mediaId && !this.crossfade() && !this.overlayOpen()) {
      this.clearPausedVideoAdvance();
      this.videoPaused.set(false);
      this.updateVideoProgress(video);
      this.armVideoEndWatchdog(video, mediaId);
    }
  }

  protected onVideoPause(video: HTMLVideoElement, mediaId: string): void {
    if (this.currentMedia()?.id !== mediaId || this.preparingTransition() || this.crossfade()) {
      return;
    }
    this.clearVideoEndWatchdog();
    this.updateVideoProgress(video);
    if (this.videoReachedEnd(video)) {
      this.completeVideo(mediaId);
    } else {
      this.videoPaused.set(true);
      if (!this.overlayOpen()) {
        this.schedulePausedVideoAdvance(mediaId);
      }
    }
  }

  protected onVideoProgress(video: HTMLVideoElement, mediaId: string): void {
    if (this.currentMedia()?.id === mediaId && !this.crossfade()) {
      this.updateVideoProgress(video);
    }
    if (this.videoReachedEnd(video)) {
      this.completeVideo(mediaId);
    } else if (
      this.currentMedia()?.id === mediaId &&
      !this.crossfade() &&
      !this.overlayOpen() &&
      !video.paused &&
      !this.videoPaused()
    ) {
      this.armVideoEndWatchdog(video, mediaId);
    }
  }

  protected toggleVideoPlayback(event: Event): void {
    event.stopPropagation();
    const video = this.currentVideoElement();
    if (!video) {
      return;
    }
    if (video.paused) {
      this.clearPausedVideoAdvance();
      void video.play().then(
        () => this.videoPaused.set(false),
        () => {
          this.videoPaused.set(true);
          const mediaId = this.currentMedia()?.id;
          if (mediaId) this.schedulePausedVideoAdvance(mediaId);
        },
      );
    } else {
      this.clearVideoEndWatchdog();
      video.pause();
      this.videoPaused.set(true);
      const mediaId = this.currentMedia()?.id;
      if (mediaId) this.schedulePausedVideoAdvance(mediaId);
    }
  }

  protected seekVideo(event: Event): void {
    event.stopPropagation();
    const video = this.currentVideoElement();
    const requestedTime = Number((event.target as HTMLInputElement).value);
    if (!video || !Number.isFinite(requestedTime)) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : requestedTime;
    video.currentTime = Math.min(Math.max(0, requestedTime), duration);
    this.updateVideoProgress(video);
  }

  protected formatVideoTime(seconds: number): string {
    const numericSeconds = Number(seconds);
    const safeSeconds = Number.isFinite(numericSeconds)
      ? Math.max(0, Math.floor(numericSeconds))
      : 0;
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = String(safeSeconds % 60).padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  protected galleryPreviewUrl(item: MediaItem): string {
    return item.thumbnailUrl || (item.kind === 'video' ? item.posterUrl || '' : item.url);
  }

  protected galleryPreviewFallback(item: MediaItem): string {
    return item.kind === 'video' ? item.posterUrl || '' : item.url;
  }

  protected onGalleryPreviewError(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    const fallback = image.dataset['fallbackSrc'];
    if (fallback && image.dataset['fallbackApplied'] !== 'true') {
      image.dataset['fallbackApplied'] = 'true';
      image.src = fallback;
      return;
    }
    image.hidden = true;
  }

  protected resetProvisioning(): void {
    if (this.provisioningResetPending()) return;
    this.provisioningResetPending.set(true);
    this.agent.resetProvisioning().subscribe({
      next: (status) => {
        this.provisioning.set(status);
        this.provisioningResetPending.set(false);
      },
      error: () => this.provisioningResetPending.set(false),
    });
  }

  protected rotatePairingCode(): void {
    if (this.pairingRotationPending()) return;
    this.pairingRotationPending.set(true);
    this.pairingRotationError.set(null);
    this.agent.rotatePairingCode().subscribe({
      next: (status) => {
        this.provisioning.set(status);
        this.pairingRotationPending.set(false);
      },
      error: () => {
        this.pairingRotationError.set('No se pudo cambiar el código. Comprueba la conexión.');
        this.pairingRotationPending.set(false);
      },
    });
  }

  protected formatBytes(bytes: number): string {
    const numericBytes = this.numericBytes(bytes);
    if (numericBytes <= 0) {
      return '0 MB';
    }
    const megabytes = numericBytes / (1024 * 1024);
    if (megabytes < 1024) {
      return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
    }
    return `${(megabytes / 1024).toFixed(2)} GB`;
  }

  private numericBytes(bytes: number | null | undefined): number {
    const value = Number(bytes ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  protected displayTemperature(): string {
    const current = this.weather().current;
    if (!current || this.weather().status !== 'ready') return '--°';
    if (this.settings().temperatureUnit === 'f') {
      return `${Math.round((current.temperatureC * 9) / 5 + 32)}°`;
    }
    return `${Math.round(current.temperatureC)}°`;
  }

  protected setVolume(event: Event): void {
    event.stopPropagation();
    const value = Number((event.target as HTMLInputElement).value);
    this.patchPlaybackSettings({ volume: value, muted: false });
  }

  protected toggleMute(event: Event): void {
    event.stopPropagation();
    this.patchPlaybackSettings({ muted: !this.settings().muted });
  }

  protected fitLabel(mode: FitMode): string {
    return mode === 'contain' ? 'Imagen completa' : 'Rellenar pantalla';
  }

  protected mediaFitLabel(mode: MediaFitMode): string {
    return mode === 'inherit'
      ? `Heredar (${this.fitLabel(this.settings().defaultFitMode)})`
      : this.fitLabel(mode);
  }

  protected photoTransformStyle(mediaId: string): string | null {
    const transform = this.photoTransform();
    if (transform.mediaId !== mediaId || transform.scale <= PHOTO_ZOOM_ACTIVE_THRESHOLD) {
      return null;
    }
    return `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
  }

  protected photoIsZoomed(mediaId: string): boolean {
    const transform = this.photoTransform();
    return transform.mediaId === mediaId && transform.scale > PHOTO_ZOOM_ACTIVE_THRESHOLD;
  }

  private canManipulateCurrentPhoto(): boolean {
    return (
      this.currentMedia()?.kind === 'photo' &&
      !this.preparingTransition() &&
      this.crossfade() === null
    );
  }

  private startPinchGesture(target: HTMLElement): void {
    const current = this.currentMedia();
    if (!current || current.kind !== 'photo') {
      return;
    }
    const pointers = [...this.activePointers.entries()].slice(0, 2);
    if (pointers.length !== 2) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }
    const left = this.relativePointer(pointers[0][1], bounds.left, bounds.top);
    const right = this.relativePointer(pointers[1][1], bounds.left, bounds.top);
    const startDistance = pointDistance(left, right);
    if (startDistance <= 0) {
      return;
    }
    const active = this.photoTransform();
    const startTransform =
      active.mediaId === current.id
        ? this.photoTransformValue(active)
        : { ...IDENTITY_PHOTO_TRANSFORM };
    this.photoTransform.set({ mediaId: current.id, ...startTransform });
    this.photoGesture = {
      kind: 'pinch',
      mediaId: current.id,
      pointerIds: [pointers[0][0], pointers[1][0]],
      startTransform,
      startDistance,
      startMidpoint: pointMidpoint(left, right),
      surface: { width: bounds.width, height: bounds.height },
      surfaceLeft: bounds.left,
      surfaceTop: bounds.top,
      changed: false,
    };
  }

  private markPhotoGestureChanged(gesture: PhotoGestureState): void {
    if (gesture.changed) {
      return;
    }
    gesture.changed = true;
  }

  private beginPhotoTimerInteraction(): void {
    const current = this.currentMedia();
    if (
      current?.kind !== 'photo' ||
      this.overlayOpen() ||
      this.preparingTransition() ||
      this.crossfade()
    ) {
      return;
    }
    this.photoTimerInteractionMediaId = current.id;
    this.clearPhotoTimer();
  }

  private finishPhotoTimerInteraction(): void {
    if (this.activePointers.size > 0) {
      return;
    }
    const mediaId = this.photoTimerInteractionMediaId;
    this.photoTimerInteractionMediaId = null;
    if (mediaId) {
      this.restartPhotoTimerForInteraction(mediaId);
    }
  }

  private abandonPhotoTimerInteraction(): void {
    this.photoTimerInteractionMediaId = null;
  }

  private restartPhotoTimerForInteraction(mediaId: string): void {
    const current = this.currentMedia();
    if (
      current?.kind !== 'photo' ||
      current.id !== mediaId ||
      this.overlayOpen() ||
      this.preparingTransition() ||
      this.crossfade()
    ) {
      return;
    }
    this.schedulePhotoAdvance(current, this.settings().photoDurationSeconds);
  }

  private photoGestureIncludesPointer(gesture: PhotoGestureState, pointerId: number): boolean {
    return gesture.kind === 'pinch'
      ? gesture.pointerIds.includes(pointerId)
      : gesture.pointerId === pointerId;
  }

  private relativePointer(
    pointer: ActivePointer,
    surfaceLeft: number,
    surfaceTop: number,
  ): ZoomPoint {
    return {
      x: pointer.x - surfaceLeft,
      y: pointer.y - surfaceTop,
    };
  }

  private photoTransformValue(transform: ActivePhotoTransform): PhotoTransform {
    return {
      scale: transform.scale,
      x: transform.x,
      y: transform.y,
    };
  }

  private clearViewerPointers(): void {
    this.pointerStart = null;
    this.activePointers.clear();
    this.photoGesture = null;
    this.suppressNavigationUntilPointersClear = false;
    this.photoTimerInteractionMediaId = null;
  }

  private resetPhotoTransform(): void {
    this.photoTransform.set({ mediaId: null, ...IDENTITY_PHOTO_TRANSFORM });
  }

  private openOverlay(view: Exclude<AppView, 'viewer'>): void {
    if (this.activeView() === 'viewer' && (this.preparingTransition() || this.crossfade())) {
      return;
    }
    const wasViewer = this.activeView() === 'viewer';
    this.activeView.set(view);
    if (wasViewer) {
      this.clearPhotoTimer();
      this.clearVideoEndWatchdog();
      this.clearPausedVideoAdvance();
      this.pauseVideoForSettings();
    }
  }

  private finishGalleryDrag(event: PointerEvent, suppressClick: boolean): void {
    const drag = this.galleryDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    this.galleryDrag = null;
    this.galleryDragging.set(false);
    this.suppressGalleryClick = suppressClick;
    this.clearGalleryClickReset();
    if (suppressClick) {
      this.galleryClickResetTimer = window.setTimeout(() => {
        this.suppressGalleryClick = false;
        this.galleryClickResetTimer = undefined;
      });
    }
  }

  private clearGalleryClickReset(): void {
    if (this.galleryClickResetTimer !== undefined) {
      window.clearTimeout(this.galleryClickResetTimer);
      this.galleryClickResetTimer = undefined;
    }
  }

  private receiveManifest(next: FrameManifest): void {
    const orderedNext = this.orderManifest(next);
    this.loading.set(false);
    this.connectionWarning.set(null);
    const pendingOperation = this.galleryOperation();
    if (pendingOperation) {
      const operatedItem = orderedNext.media.find((item) => item.id === pendingOperation.mediaId);
      if (
        (pendingOperation.kind === 'deletion' && !operatedItem) ||
        (pendingOperation.kind === 'rotation' &&
          operatedItem?.rotationDegrees === pendingOperation.targetRotation)
      ) {
        this.galleryOperation.set(null);
      }
    }
    const current = this.manifest();
    if (!current || current.media.length === 0) {
      this.resetPhotoTransform();
      this.manifest.set(orderedNext);
      this.pendingManifest.set(null);
      this.currentIndex.set(0);
      return;
    }
    if (this.overlayOpen()) {
      const currentMediaId = this.currentMedia()?.id;
      this.manifest.set(orderedNext);
      this.pendingManifest.set(null);
      const preservedIndex = currentMediaId
        ? orderedNext.media.findIndex((item) => item.id === currentMediaId)
        : -1;
      if (preservedIndex < 0) {
        this.resetPhotoTransform();
      }
      this.currentIndex.set(preservedIndex >= 0 ? preservedIndex : 0);
      const optionItem = this.galleryOptionsItem();
      if (optionItem) {
        const updatedItem = orderedNext.media.find((item) => item.id === optionItem.id);
        if (updatedItem) {
          this.galleryOptionsItem.set(updatedItem);
          const operation = this.galleryOperation();
          if (
            operation?.kind === 'rotation' &&
            operation.mediaId === updatedItem.id &&
            operation.targetRotation === updatedItem.rotationDegrees
          ) {
            this.galleryOperation.set(null);
            this.galleryOptionsMessage.set('Rotación terminada y sincronizada.');
          }
        } else {
          if (this.galleryOperation()?.mediaId === optionItem.id) {
            this.galleryOperation.set(null);
          }
          this.closeGalleryOptions();
        }
      }
      return;
    }
    if (
      current.version === orderedNext.version ||
      this.pendingManifest()?.version === orderedNext.version
    ) {
      return;
    }
    this.pendingManifest.set(orderedNext);
  }

  private navigate(direction: -1 | 1): void {
    this.clearPhotoTimer();
    this.clearVideoEndWatchdog();
    this.clearPausedVideoAdvance();
    this.clearViewerPointers();
    if (this.overlayOpen()) {
      return;
    }
    if (this.preparingTransition() || this.crossfade()) {
      return;
    }
    const active = this.manifest();
    if (!active || active.media.length === 0) {
      return;
    }

    void this.prepareAndStartCrossfade(direction);
  }

  private async prepareAndStartCrossfade(direction: -1 | 1): Promise<void> {
    const active = this.manifest();
    const outgoing = this.currentMedia();
    if (!active || !outgoing) {
      return;
    }

    const generation = ++this.navigationGeneration;
    const outgoingFitMode = this.fitModeFor(outgoing, active.settings);
    const outgoingVideo = this.currentVideoElement();
    const outgoingVideoWasPlaying = Boolean(outgoingVideo && !outgoingVideo.paused);
    if (outgoingVideoWasPlaying) {
      outgoingVideo?.pause();
    }
    this.preparingTransition.set(true);

    const targetManifest = this.pendingManifest() ?? active;
    let target: NavigationTarget | null = null;
    let lastError: unknown;

    for (let offset = 0; offset < targetManifest.media.length; offset += 1) {
      const candidate = this.resolveNavigationTarget(direction, offset);
      if (!candidate) {
        break;
      }
      if (candidate.item.id === outgoing.id) {
        if (targetManifest.media.length === 1) {
          target = candidate;
          break;
        }
        continue;
      }
      try {
        await this.mediaReadiness.prepare(candidate.item);
        target = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (generation !== this.navigationGeneration) {
      return;
    }

    if (!target) {
      this.preparingTransition.set(false);
      this.connectionWarning.set(
        lastError instanceof Error
          ? 'No se pudo preparar el siguiente medio.'
          : 'No hay otro medio disponible.',
      );
      this.resumeAfterAbortedNavigation(outgoingVideoWasPlaying);
      return;
    }

    if (target.item.id === outgoing.id) {
      this.resetPhotoTransform();
      this.manifest.set(target.manifest);
      if (this.pendingManifest()?.version === target.manifest.version) {
        this.pendingManifest.set(null);
      }
      this.currentIndex.set(target.index);
      this.preparingTransition.set(false);
      this.resumeAfterAbortedNavigation(outgoingVideoWasPlaying);
      return;
    }

    const durationMs = target.manifest.settings.fadeDurationMs;
    this.crossfade.set({
      outgoing,
      outgoingFitMode,
      incoming: target.item,
      incomingFitMode: this.fitModeFor(target.item, target.manifest.settings),
      durationMs,
    });
    this.manifest.set(target.manifest);
    if (this.pendingManifest()?.version === target.manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(target.index);
    this.preparingTransition.set(false);
    this.videoPaused.set(false);
    this.clearCrossfadeTimer();
    this.crossfadeTimer = window.setTimeout(() => this.finishCrossfade(), durationMs);
  }

  private resolveNavigationTarget(direction: -1 | 1, offset: number): NavigationTarget | null {
    const active = this.manifest();
    if (!active || active.media.length === 0) {
      return null;
    }

    const pending = this.pendingManifest();
    if (pending) {
      const result = activatePendingManifest(
        active,
        pending,
        this.currentMedia()?.id ?? null,
        direction,
      );
      if (pending.media.length === 0) {
        return null;
      }
      let index = result.index;
      for (let step = 0; step < offset; step += 1) {
        index = adjacentIndex(pending.media.length, index, direction);
      }
      return { manifest: pending, index, item: pending.media[index] };
    }

    let index = this.currentIndex();
    for (let step = 0; step <= offset; step += 1) {
      index = adjacentIndex(active.media.length, index, direction);
    }
    return { manifest: active, index, item: active.media[index] };
  }

  private finishCrossfade(): void {
    this.crossfadeTimer = undefined;
    this.crossfade.set(null);
    this.resetPhotoTransform();
    if (this.currentMedia()?.kind === 'video') {
      this.playCurrentVideo();
    }
  }

  private completeVideo(mediaId: string): void {
    if (
      this.currentMedia()?.id !== mediaId ||
      this.preparingTransition() ||
      this.crossfade() ||
      this.overlayOpen()
    ) {
      return;
    }
    this.clearVideoEndWatchdog();
    this.clearPausedVideoAdvance();
    this.videoPaused.set(false);
    this.navigate(1);
  }

  private videoReachedEnd(video: HTMLVideoElement): boolean {
    return video.ended;
  }

  private armVideoEndWatchdog(video: HTMLVideoElement, mediaId: string): void {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    this.clearVideoEndWatchdog();
    const remainingMs = Math.max(0, video.duration - video.currentTime) * 1_000;
    this.videoEndWatchdogTimer = window.setTimeout(() => {
      this.videoEndWatchdogTimer = undefined;
      if (
        this.currentMedia()?.id !== mediaId ||
        this.preparingTransition() ||
        this.crossfade() ||
        this.overlayOpen()
      ) {
        return;
      }
      const remainingSeconds = video.duration - video.currentTime;
      if (
        video.ended ||
        (Number.isFinite(remainingSeconds) && remainingSeconds <= VIDEO_END_STALL_WINDOW_SECONDS)
      ) {
        this.completeVideo(mediaId);
        return;
      }
      this.armVideoEndWatchdog(video, mediaId);
    }, remainingMs + VIDEO_END_WATCHDOG_GRACE_MS);
  }

  private clearVideoEndWatchdog(): void {
    if (this.videoEndWatchdogTimer !== undefined) {
      window.clearTimeout(this.videoEndWatchdogTimer);
      this.videoEndWatchdogTimer = undefined;
    }
  }

  private schedulePausedVideoAdvance(mediaId: string): void {
    this.clearPausedVideoAdvance();
    const durationMs = this.settings().photoDurationSeconds * 1_000;
    this.pausedVideoAdvanceTimer = window.setTimeout(() => {
      this.pausedVideoAdvanceTimer = undefined;
      if (
        this.currentMedia()?.id === mediaId &&
        this.videoPaused() &&
        !this.overlayOpen() &&
        !this.preparingTransition() &&
        !this.crossfade()
      ) {
        this.navigate(1);
      }
    }, durationMs);
  }

  private clearPausedVideoAdvance(): void {
    if (this.pausedVideoAdvanceTimer !== undefined) {
      window.clearTimeout(this.pausedVideoAdvanceTimer);
      this.pausedVideoAdvanceTimer = undefined;
    }
  }

  private updateVideoProgress(video: HTMLVideoElement): void {
    this.videoCurrentTime.set(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    this.videoDuration.set(Number.isFinite(video.duration) ? video.duration : 0);
  }

  private schedulePhotoAdvance(media: MediaItem | null, duration: number): void {
    this.clearPhotoTimer();
    if (
      !media ||
      media.kind !== 'photo' ||
      this.overlayOpen() ||
      this.videoPaused() ||
      this.activePointers.size > 0 ||
      this.photoTimerInteractionMediaId !== null
    ) {
      return;
    }
    const generation = this.photoTimerGeneration;
    const mediaId = media.id;
    this.photoTimer = window.setTimeout(() => {
      this.photoTimer = undefined;
      if (
        generation !== this.photoTimerGeneration ||
        this.currentMedia()?.id !== mediaId ||
        this.activePointers.size > 0 ||
        this.photoTimerInteractionMediaId !== null ||
        this.overlayOpen() ||
        this.preparingTransition() ||
        this.crossfade()
      ) {
        return;
      }
      this.navigate(1);
    }, duration * 1_000);
  }

  private clearPhotoTimer(): void {
    this.photoTimerGeneration += 1;
    if (this.photoTimer !== undefined) {
      window.clearTimeout(this.photoTimer);
      this.photoTimer = undefined;
    }
  }

  private pauseVideoForSettings(): void {
    this.clearPausedVideoAdvance();
    const video = this.currentVideoElement();
    if (video && !video.paused) {
      this.clearVideoEndWatchdog();
      video.pause();
      this.videoPaused.set(true);
    }
  }

  private resumeCurrentCycle(): void {
    const video = this.currentVideoElement();
    if (video && this.currentMedia()?.kind === 'video') {
      this.playCurrentVideo();
    } else {
      this.schedulePhotoAdvance(this.currentMedia(), this.settings().photoDurationSeconds);
    }
  }

  private resumeAfterAbortedNavigation(videoWasPlaying: boolean): void {
    if (videoWasPlaying && this.currentMedia()?.kind === 'video') {
      this.playCurrentVideo();
      return;
    }
    this.schedulePhotoAdvance(this.currentMedia(), this.settings().photoDurationSeconds);
  }

  private clearCrossfadeTimer(): void {
    if (this.crossfadeTimer !== undefined) {
      window.clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = undefined;
    }
  }

  private patchPlaybackSettings(patch: Partial<FrameSettings>): void {
    const next = { ...this.settings(), ...patch };
    this.replaceSettings(next);
    this.applyVolumeToVideo();
    this.agent.updateSettings(patch).subscribe({
      error: () => this.connectionWarning.set('No se pudo guardar el volumen.'),
    });
  }

  private replaceSettings(settings: FrameSettings): void {
    const manifest = this.manifest();
    if (manifest) {
      const currentId = this.currentMedia()?.id;
      const next = this.orderManifest({ ...manifest, settings });
      this.manifest.set(next);
      if (currentId) {
        const index = next.media.findIndex((item) => item.id === currentId);
        if (index >= 0) this.currentIndex.set(index);
      }
    }
  }

  private orderManifest(manifest: FrameManifest): FrameManifest {
    return {
      ...manifest,
      media: orderManifestMedia(manifest.media, manifest.settings.order, manifest.version),
    };
  }

  private replaceMedia(updated: MediaItem): void {
    const manifest = this.manifest();
    if (!manifest) {
      return;
    }
    this.manifest.set({
      ...manifest,
      media: manifest.media.map((item) => (item.id === updated.id ? updated : item)),
    });
  }

  private applyVolumeToVideo(): void {
    const video = this.currentVideoElement();
    if (video) {
      video.volume = this.settings().volume;
      video.muted = this.settings().muted;
    }
  }

  private playCurrentVideo(): void {
    const video = this.currentVideoElement();
    if (!video || this.currentMedia()?.kind !== 'video' || this.overlayOpen()) {
      return;
    }
    video.volume = this.settings().volume;
    video.muted = this.settings().muted;
    this.clearPausedVideoAdvance();
    void video.play().then(
      () => {
        this.videoPaused.set(false);
      },
      () => {
        this.videoPaused.set(true);
        const mediaId = this.currentMedia()?.id;
        if (mediaId) this.schedulePausedVideoAdvance(mediaId);
      },
    );
  }

  private currentVideoElement(): HTMLVideoElement | null {
    const mediaId = this.currentMedia()?.id;
    if (!mediaId) {
      return null;
    }
    return (
      this.videoElements
        ?.toArray()
        .map((element) => element.nativeElement)
        .find((video) => video.dataset['mediaId'] === mediaId) ?? null
    );
  }

  private fitModeFor(item: MediaItem, settings: FrameSettings): FitMode {
    return item.fitMode === 'inherit' ? settings.defaultFitMode : item.fitMode;
  }
}

function iconForWeatherCode(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀' : '☾';
  if (code <= 2) return isDay ? '⛅' : '☁';
  if (code === 3 || code === 45 || code === 48) return '☁';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄';
  if (code >= 95) return '⛈';
  return '◌';
}

function descriptionForWeatherCode(code: number): string {
  if (code === 0) return 'Despejado';
  if (code <= 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code === 45 || code === 48) return 'Niebla';
  if (code >= 51 && code <= 67) return 'Lluvia';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Nieve';
  if (code >= 80 && code <= 82) return 'Chubascos';
  if (code >= 95) return 'Tormenta';
  return 'Condición meteorológica';
}
