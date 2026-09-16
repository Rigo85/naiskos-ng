import {
  Component,
  afterNextRender,
  ElementRef,
  OnDestroy,
  QueryList,
  ViewChild,
  ViewChildren,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';

import { AgentApi, SystemAction } from './core/agent-api';
import { VIEWER_BUILD_ID } from './core/build-info';
import {
  DEFAULT_FRAME_SETTINGS,
  EMPTY_WEATHER,
  AgentHealth,
  FitMode,
  FrameNotification,
  FrameManifest,
  FrameSettings,
  MediaFitMode,
  MediaItem,
  MediaRotation,
  ProvisioningStatus,
  ReposeState,
  ViewerPlaybackEvent,
  ViewerPlaybackSnapshot,
  ViewerMediaPreparationFailure,
  ViewerPlaybackState,
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
import { adjacentIndex, orderManifestMedia } from './core/slideshow-policy';
import {
  MediaFailureRegistry,
  NavigationCandidate,
  navigationPlan,
} from './core/navigation-policy';

type SlidePhase = 'stable' | 'staging' | 'outgoing' | 'incoming';
type AppView = 'viewer' | 'menu' | 'gallery' | 'settings' | 'notifications';
type GalleryFilter = 'all' | 'photo' | 'video';
type GalleryOrder = 'newest' | 'oldest';
type SettingsSection = 'presentation' | 'widgets' | 'playback' | 'storage' | 'device';

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
  target: NavigationCandidate;
  startedAt: number;
}

interface StagingState {
  operationId: number;
  outgoing: MediaItem | null;
  outgoingFitMode: FitMode | null;
  target: NavigationCandidate;
  incomingFitMode: FitMode;
  startedAt: number;
}

interface StagingAttempt {
  mediaKey: string;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

interface PlaybackCheckpoint {
  frameId: string;
  mediaId: string;
  mediaSha256: string;
  mediaKind: 'photo' | 'video';
  currentTime: number;
  userPaused: boolean;
  updatedAt: string;
}

class NavigationCancelledError extends Error {}

interface GalleryDragState {
  pointerId: number;
  startX: number;
  startY: number;
  scrollTop: number;
}

interface GalleryGeometry {
  columns: number;
  rowStep: number;
  viewportHeight: number;
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

const VIDEO_START_TIMEOUT_MS = 10_000;
const VIDEO_STALL_TIMEOUT_MS = 6_000;
const VIDEO_PROGRESS_EPSILON_SECONDS = 0.05;
const VIDEO_END_EPSILON_SECONDS = 0.1;
const VIDEO_MAX_RECOVERY_ATTEMPTS = 1;
const VIDEO_QUARANTINE_FAILURES = 2;
const VIDEO_QUARANTINE_MS = 30 * 60_000;
const VIEWER_HEARTBEAT_INTERVAL_MS = 15_000;
const MEDIA_PREPARATION_TIMEOUT_MS = 5_000;
const PLAYBACK_CHECKPOINT_INTERVAL_MS = 30_000;
const NAVIGATION_SEARCH_SLICE_MS = 10_000;
const NAVIGATION_CONTINUATION_DELAY_MS = 250;
const NAVIGATION_RETRY_DELAY_MS = 30_000;
const MEDIA_QUARANTINE_MS = 30 * 60_000;
const PLAYBACK_CHECKPOINT_KEY = 'naiskos.playback-checkpoint.v1';
const GALLERY_DRAG_THRESHOLD_PX = 8;
const GALLERY_SYNTHETIC_CLICK_WINDOW_MS = 250;
const GALLERY_MIN_CARD_WIDTH_PX = 178;
const GALLERY_GAP_PX = 14;
const GALLERY_HORIZONTAL_PADDING_PX = 48;
const GALLERY_CARD_CAPTION_HEIGHT_PX = 58;
const PHOTO_GESTURE_THRESHOLD_PX = 8;
const PHOTO_PINCH_SCALE_THRESHOLD = 0.02;
const PHOTO_ZOOM_ACTIVE_THRESHOLD = 1.001;
const REPOSE_MENU_TIMEOUT_MS = 15_000;

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private readonly agent = inject(AgentApi);
  private readonly subscriptions = new Subscription();

  @ViewChildren('videoElement')
  private videoElements?: QueryList<ElementRef<HTMLVideoElement>>;

  @ViewChild('galleryViewport')
  private galleryViewport?: ElementRef<HTMLElement>;

  protected readonly manifest = signal<FrameManifest | null>(null);
  protected readonly provisioning = signal<ProvisioningStatus | null>(null);
  protected readonly weather = signal<WeatherSnapshot>({ ...EMPTY_WEATHER });
  protected readonly notifications = signal<FrameNotification[]>([]);
  protected readonly health = signal<AgentHealth | null>(null);
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
  protected readonly gallerySelectionMode = signal(false);
  protected readonly gallerySelectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly galleryGeometry = signal<GalleryGeometry>({
    columns: 6,
    rowStep: 218,
    viewportHeight: 540,
  });
  protected readonly galleryCurrentPage = signal(0);
  protected readonly galleryBatchConfirming = signal(false);
  protected readonly galleryBatchSaving = signal(false);
  protected readonly galleryBatchError = signal<string | null>(null);
  protected readonly now = signal(new Date());
  protected readonly videoPaused = signal(false);
  protected readonly videoPlaybackState = signal<ViewerPlaybackState>('empty');
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
  protected readonly staging = signal<StagingState | null>(null);
  protected readonly crossfade = signal<CrossfadeState | null>(null);
  protected readonly photoTransform = signal<ActivePhotoTransform>({
    mediaId: null,
    ...IDENTITY_PHOTO_TRANSFORM,
  });
  protected readonly repose = signal<ReposeState | null>(null);
  private readonly runtimeQuiesced = signal(false);
  private readonly runtimeRendered = signal(false);
  private readonly runtimeSessionId = crypto.randomUUID();
  private quiescedFor: string | null = null;
  protected readonly reposeActive = computed(() => this.runtimeQuiesced() || (this.repose()?.active ?? true));
  protected readonly reposeMenuVisible = signal(false);
  protected readonly reposeRequestPending = signal(false);
  protected readonly reposeRequestError = signal<string | null>(null);
  protected readonly reposeConfirming = signal(false);

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
  protected readonly gallerySelectedCount = computed(() => this.gallerySelectedIds().size);
  protected readonly galleryAllVisibleSelected = computed(() => {
    const items = this.galleryItems();
    const selected = this.gallerySelectedIds();
    return items.length > 0 && items.every((item) => selected.has(item.id));
  });
  protected readonly galleryVirtualView = computed(() => {
    const items = this.galleryItems();
    const geometry = this.galleryGeometry();
    const totalRows = Math.ceil(items.length / geometry.columns);
    const pageRows = Math.max(1, Math.ceil(geometry.viewportHeight / geometry.rowStep));
    const totalPages = Math.ceil(totalRows / pageRows);
    const currentPage = Math.min(this.galleryCurrentPage(), Math.max(0, totalPages - 1));
    const startPage = Math.max(0, currentPage - 1);
    const endPage = Math.min(totalPages, currentPage + 2);
    const startRow = startPage * pageRows;
    const endRow = Math.min(totalRows, endPage * pageRows);
    return {
      items: items.slice(startRow * geometry.columns, endRow * geometry.columns),
      columns: geometry.columns,
      offset: startRow * geometry.rowStep,
      height: Math.max(0, totalRows * geometry.rowStep - GALLERY_GAP_PX),
      cardHeight: geometry.rowStep - GALLERY_GAP_PX,
    };
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
  protected readonly storageCapacity = computed(() => {
    const health = this.health();
    const summary = this.storageSummary();
    const total = health?.diskTotalBytes ?? 0;
    const photos = Math.min(summary.photoBytes, total);
    const videos = Math.min(summary.videoBytes, Math.max(0, total - photos));
    const used = Math.min(health?.diskUsedBytes ?? 0, total);
    const other = Math.max(0, used - photos - videos);
    const available = Math.min(health?.diskAvailableBytes ?? 0, Math.max(0, total - used));
    const reserved = Math.max(0, total - used - available);
    const percent = (value: number) => (total > 0 ? (value / total) * 100 : 0);
    const usedPercent = (value: number) => (used > 0 ? (value / used) * 100 : 0);
    return {
      total,
      used,
      available,
      reserved,
      frameData: health?.frameDataBytes ?? 0,
      photos,
      videos,
      other,
      usedPercent: percent(used),
      photoPercent: percent(photos),
      videoPercent: percent(videos),
      otherPercent: percent(other),
      availablePercent: percent(available),
      reservedPercent: percent(reserved),
      photoUsedPercent: usedPercent(photos),
      videoUsedPercent: usedPercent(videos),
      otherUsedPercent: usedPercent(other),
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
  protected readonly reposeDate = computed(() => {
    const date = new Intl.DateTimeFormat('es-PE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(this.weather().location?.timezone ? { timeZone: this.weather().location!.timezone } : {}),
    }).format(this.now());
    return date.charAt(0).toLocaleUpperCase('es-PE') + date.slice(1);
  });
  protected readonly reposeTemperature = computed(() => {
    const current = this.weather().current;
    if (!current) return '--°';
    return this.settings().temperatureUnit === 'f'
      ? `${Math.round((current.temperatureC * 9) / 5 + 32)}°`
      : `${Math.round(current.temperatureC)}°`;
  });
  protected readonly reposeWeatherIcon = computed(() => {
    const current = this.weather().current;
    return current ? iconForWeatherCode(current.weatherCode, current.isDay) : '◌';
  });
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
    const staging = this.staging();
    if (staging) {
      return [
        ...(staging.outgoing && staging.outgoingFitMode
          ? [
              {
                item: staging.outgoing,
                phase: 'stable' as const,
                fitMode: staging.outgoingFitMode,
              },
            ]
          : []),
        {
          item: staging.target.item,
          phase: 'staging',
          fitMode: staging.incomingFitMode,
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
  private navigationRetryTimer: number | undefined;
  private videoWatchdogTimer: number | undefined;
  private pausedVideoAdvanceTimer: number | undefined;
  private videoSessionGeneration = 0;
  private videoSessionMediaId: string | null = null;
  private videoSessionElement: HTMLVideoElement | null = null;
  private videoLastProgressAt = 0;
  private videoLastObservedTime = 0;
  private videoRecoveryAttempts = 0;
  private videoRecoveryResumeAt: number | null = null;
  private readonly videoFailureCounts = new Map<string, number>();
  private readonly quarantinedVideos = new Map<string, number>();
  private readonly unavailableMedia = new MediaFailureRegistry(MEDIA_QUARANTINE_MS);
  private navigationGeneration = 0;
  private stagingAttempt: StagingAttempt | null = null;
  private navigationFailures = 0;
  private readonly playbackCheckpoint = this.readPlaybackCheckpoint();
  private lastPlaybackCheckpointSignature: string | null = null;
  private lastPlaybackCheckpointWriteAt = 0;
  private restoredVideoCheckpointKey: string | null = null;
  private lastTapAt = 0;
  private lastTapSide: 'left' | 'right' | null = null;
  private galleryDrag: GalleryDragState | null = null;
  private suppressGalleryClick = false;
  private galleryLastDragAt = 0;
  private galleryClickResetTimer: number | undefined;
  private reposeMenuTimer: number | undefined;
  private reposeVideoResumeTimer: number | undefined;
  private reposeVideoIntent: { mediaId: string; resume: boolean } | null = null;
  private readonly videosPausedInternally = new WeakSet<HTMLVideoElement>();

  constructor() {
    afterNextRender(() => this.runtimeRendered.set(true));
    this.subscriptions.add(timer(0, 1_000).pipe(
      switchMap(() => this.agent.getRuntimeControl().pipe(catchError(() => of(null)))),
    ).subscribe((control) => {
      if (!control?.quiesceId || this.quiescedFor === control.quiesceId) return;
      this.runtimeQuiesced.set(true);
      this.enterRepose();
      for (const video of document.querySelectorAll('video')) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      this.quiescedFor = control.quiesceId;
      this.agent.reportViewerHeartbeat(this.viewerPlaybackSnapshot()).pipe(catchError(() => of(null))).subscribe();
    }));
    this.subscriptions.add(
      timer(0, 2_000)
        .pipe(
          switchMap(() => {
            const installed = this.manifest();
            const knownVersion = Math.max(
              installed?.version ?? -1,
              this.pendingManifest()?.version ?? -1,
            );
            const request = installed
              ? this.agent
                  .getManifestVersion()
                  .pipe(
                    switchMap(({ version }) =>
                      version === knownVersion ? of(null) : this.agent.getManifest(),
                    ),
                  )
              : this.agent.getManifest();
            return request.pipe(
              catchError((error: HttpErrorResponse) => {
                this.loading.set(false);
                this.connectionWarning.set(
                  error.status === 0
                    ? 'Esperando al agente local…'
                    : 'No se pudo leer el manifiesto local.',
                );
                return of(null);
              }),
            );
          }),
        )
        .subscribe((manifest) => {
          if (manifest) {
            this.receiveManifest(manifest);
          }
        }),
    );
    this.subscriptions.add(timer(0, 1_000).subscribe(() => this.now.set(new Date())));
    this.subscriptions.add(
      timer(0, 1_000)
        .pipe(switchMap(() => this.agent.getRepose().pipe(catchError(() => of(null)))))
        .subscribe((state) => {
          if (state) this.applyReposeState(state);
        }),
    );
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
      timer(0, VIEWER_HEARTBEAT_INTERVAL_MS)
        .pipe(
          switchMap(() => {
            this.persistPlaybackCheckpoint();
            return this.agent
              .reportViewerHeartbeat(this.viewerPlaybackSnapshot())
              .pipe(catchError(() => of(null)));
          }),
        )
        .subscribe(),
    );
    this.subscriptions.add(
      timer(0, 30_000)
        .pipe(switchMap(() => this.agent.getHealth().pipe(catchError(() => of(null)))))
        .subscribe((health) => {
          if (health) this.health.set(health);
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
      if (transitionActive || this.reposeActive()) {
        this.clearPhotoTimer();
      } else {
        this.schedulePhotoAdvance(current, duration);
      }
    });
  }

  ngOnDestroy(): void {
    this.cancelNavigation();
    this.subscriptions.unsubscribe();
    this.clearPhotoTimer();
    this.clearCrossfadeTimer();
    this.clearNavigationRetry();
    this.clearVideoMonitoring();
    this.clearPausedVideoAdvance();
    this.clearGalleryClickReset();
    this.clearViewerPointers();
    this.clearReposeMenuTimer();
    this.clearReposeVideoResumeTimer();
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.overlayOpen() || this.reposeActive()) {
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
      this.navigate(1, undefined, true);
      return;
    }
    if (action === 'previous') {
      this.abandonPhotoTimerInteraction();
      this.navigate(-1, undefined, true);
      return;
    }
    if (action === 'tap-left' || action === 'tap-right') {
      const side = action === 'tap-left' ? 'left' : 'right';
      const isSecondTap = this.lastTapSide === side && event.timeStamp - this.lastTapAt <= 350;
      this.lastTapAt = event.timeStamp;
      this.lastTapSide = side;
      if (!isSecondTap) {
        this.abandonPhotoTimerInteraction();
        this.navigate(side === 'left' ? -1 : 1, undefined, true);
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

  protected openReposeConfirmation(): void {
    this.reposeRequestError.set(null);
    this.reposeConfirming.set(true);
  }

  protected cancelReposeConfirmation(): void {
    if (!this.reposeRequestPending()) this.reposeConfirming.set(false);
  }

  protected confirmRepose(): void {
    if (this.reposeRequestPending()) return;
    this.reposeRequestPending.set(true);
    this.reposeRequestError.set(null);
    this.agent.setRepose(true).subscribe({
      next: (state) => {
        this.reposeRequestPending.set(false);
        this.reposeConfirming.set(false);
        this.applyReposeState(state);
      },
      error: () => {
        this.reposeRequestPending.set(false);
        this.reposeRequestError.set('No se pudo activar el reposo.');
      },
    });
  }

  protected revealReposeMenu(): void {
    if (!this.reposeActive()) return;
    this.reposeMenuVisible.set(true);
    this.clearReposeMenuTimer();
    this.reposeMenuTimer = window.setTimeout(() => {
      this.reposeMenuVisible.set(false);
      this.reposeMenuTimer = undefined;
    }, REPOSE_MENU_TIMEOUT_MS);
  }

  protected hideReposeMenu(event?: Event): void {
    event?.stopPropagation();
    this.reposeMenuVisible.set(false);
    this.clearReposeMenuTimer();
  }

  protected exitRepose(event: Event): void {
    event.stopPropagation();
    if (this.reposeRequestPending()) return;
    this.reposeRequestPending.set(true);
    this.reposeRequestError.set(null);
    this.agent.setRepose(false).subscribe({
      next: (state) => {
        this.reposeRequestPending.set(false);
        this.applyReposeState(state);
      },
      error: () => {
        this.reposeRequestPending.set(false);
        this.reposeRequestError.set('No se pudo salir del reposo.');
        this.revealReposeMenu();
      },
    });
  }

  protected openGallery(): void {
    this.closeGalleryOptions();
    this.cancelGallerySelection();
    this.openOverlay('gallery');
    this.resetGalleryViewport();
  }

  protected setGalleryFilter(filter: GalleryFilter): void {
    if (this.galleryFilter() === filter) return;
    this.galleryFilter.set(filter);
    this.resetGalleryViewport();
  }

  protected setGalleryOrder(order: GalleryOrder): void {
    if (this.galleryOrder() === order) return;
    this.galleryOrder.set(order);
    this.resetGalleryViewport();
  }

  protected beginGallerySelection(): void {
    this.gallerySelectionMode.set(true);
    this.gallerySelectedIds.set(new Set());
    this.galleryBatchError.set(null);
  }

  protected cancelGallerySelection(): void {
    if (this.galleryBatchSaving()) return;
    this.gallerySelectionMode.set(false);
    this.gallerySelectedIds.set(new Set());
    this.galleryBatchConfirming.set(false);
    this.galleryBatchError.set(null);
  }

  protected toggleGallerySelection(mediaId: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.gallerySelectionMode() || this.galleryBatchSaving()) return;
    const selected = new Set(this.gallerySelectedIds());
    if (selected.has(mediaId)) selected.delete(mediaId);
    else selected.add(mediaId);
    this.gallerySelectedIds.set(selected);
  }

  protected toggleAllVisibleGalleryItems(): void {
    const selected = new Set(this.gallerySelectedIds());
    if (this.galleryAllVisibleSelected()) {
      for (const item of this.galleryItems()) selected.delete(item.id);
    } else {
      for (const item of this.galleryItems()) selected.add(item.id);
    }
    this.gallerySelectedIds.set(selected);
  }

  protected requestGalleryBatchDelete(): void {
    if (this.gallerySelectedCount() > 0) this.galleryBatchConfirming.set(true);
  }

  protected confirmGalleryBatchDelete(): void {
    const ids = [...this.gallerySelectedIds()];
    if (ids.length === 0 || this.galleryBatchSaving()) return;
    this.galleryBatchSaving.set(true);
    this.galleryBatchError.set(null);
    this.agent.deleteMediaBatch(ids).subscribe({
      next: () => {
        this.galleryBatchSaving.set(false);
        this.galleryBatchConfirming.set(false);
        this.gallerySelectionMode.set(false);
        this.gallerySelectedIds.set(new Set());
        this.connectionWarning.set(
          `Eliminación de ${ids.length} elemento${ids.length === 1 ? '' : 's'} solicitada.`,
        );
      },
      error: () => {
        this.galleryBatchSaving.set(false);
        this.galleryBatchError.set('No se pudo solicitar la eliminación múltiple.');
      },
    });
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
    this.updateGalleryGeometry(target);
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

  protected onGalleryScroll(event: Event): void {
    const viewport = event.currentTarget as HTMLElement;
    this.updateGalleryGeometry(viewport);
    const geometry = this.galleryGeometry();
    const pageRows = Math.max(1, Math.ceil(geometry.viewportHeight / geometry.rowStep));
    const pageHeight = pageRows * geometry.rowStep;
    const currentPage = Math.max(0, Math.floor(viewport.scrollTop / pageHeight));
    if (currentPage !== this.galleryCurrentPage()) {
      this.galleryCurrentPage.set(currentPage);
    }
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
    this.applyPendingManifestOrResume();
  }

  protected showGalleryItem(mediaId: string, event?: MouseEvent): void {
    if (this.gallerySelectionMode()) {
      this.toggleGallerySelection(mediaId, event);
      return;
    }
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
    if (!this.media().some((item) => item.id === mediaId)) {
      return;
    }
    this.clearViewerPointers();
    this.resetPhotoTransform();
    this.videoPaused.set(false);
    this.videoCurrentTime.set(0);
    this.videoDuration.set(0);
    this.closeGalleryOptions();
    this.activeView.set('viewer');
    this.navigate(1, mediaId, true);
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

  protected onVideoLoadStart(video: HTMLVideoElement, mediaId: string): void {
    if (!this.isCurrentStableVideo(video, mediaId)) {
      return;
    }
    this.beginVideoSession(video, mediaId);
    this.videoPlaybackState.set(this.videoRecoveryAttempts > 0 ? 'recovering' : 'loading');
    this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'startup-timeout');
  }

  protected onVideoLoaded(video: HTMLVideoElement, mediaId: string): void {
    video.volume = this.settings().volume;
    video.muted = this.settings().muted;
    const checkpoint = this.playbackCheckpoint;
    const checkpointKey = checkpoint ? `${checkpoint.mediaId}:${checkpoint.mediaSha256}` : null;
    const restoresUserPause = Boolean(
      checkpoint &&
      checkpointKey !== this.restoredVideoCheckpointKey &&
      checkpoint.mediaId === mediaId &&
      this.currentMedia()?.sha256 === checkpoint.mediaSha256 &&
      Number.isFinite(video.duration),
    );
    if (restoresUserPause && checkpoint) {
      if (checkpoint.currentTime > 0) {
        video.currentTime = Math.min(checkpoint.currentTime, Math.max(0, video.duration - 0.1));
      }
      this.restoredVideoCheckpointKey = checkpointKey;
      this.videoPaused.set(checkpoint.userPaused);
    }
    if (this.currentMedia()?.id === mediaId) {
      this.updateVideoProgress(video);
    }
    if (
      this.currentMedia()?.id !== mediaId ||
      this.preparingTransition() ||
      this.crossfade() ||
      this.overlayOpen() ||
      this.reposeActive()
    ) {
      video.pause();
      return;
    }
    if (restoresUserPause && checkpoint?.userPaused) {
      video.pause();
      this.videoPlaybackState.set('paused');
      this.videoPaused.set(true);
      this.schedulePausedVideoAdvance(mediaId);
      return;
    }
    this.beginVideoSession(video, mediaId);
    this.noteVideoProgress(video, true);
    this.videoPlaybackState.set(this.videoRecoveryAttempts > 0 ? 'recovering' : 'loading');
    this.videoPaused.set(false);
    this.clearPausedVideoAdvance();
    this.attemptVideoPlay(video, mediaId);
  }

  protected onVideoEnded(mediaId: string): void {
    const video = this.currentVideoElement();
    if (video && this.videoRecoveryAttempts > 0) {
      this.markVideoRecoverySucceeded(video, mediaId);
    } else {
      this.markVideoHealthy(mediaId);
    }
    this.completeVideo(mediaId);
  }

  protected onVideoPlaying(video: HTMLVideoElement, mediaId: string): void {
    if (this.reposeActive()) {
      video.pause();
      return;
    }
    if (this.currentMedia()?.id === mediaId && !this.crossfade() && !this.overlayOpen()) {
      this.clearPausedVideoAdvance();
      this.videoPaused.set(false);
      this.videoPlaybackState.set('playing');
      this.updateVideoProgress(video);
      this.beginVideoSession(video, mediaId);
      this.noteVideoProgress(video);
      this.armVideoWatchdog(video, mediaId);
    }
  }

  protected onVideoPause(video: HTMLVideoElement, mediaId: string): void {
    if (this.currentMedia()?.id !== mediaId || this.preparingTransition() || this.crossfade()) {
      return;
    }
    const pausedInternally = this.videosPausedInternally.delete(video);
    if (this.reposeActive() || pausedInternally) {
      this.clearVideoWatchdog();
      this.updateVideoProgress(video);
      return;
    }
    this.clearVideoWatchdog();
    this.updateVideoProgress(video);
    if (this.videoReachedEnd(video)) {
      this.completeVideo(mediaId);
    } else if (
      this.videoPlaybackState() === 'recovering' ||
      this.videoPlaybackState() === 'loading'
    ) {
      return;
    } else {
      this.videoPaused.set(true);
      this.videoPlaybackState.set('paused');
      if (!this.overlayOpen()) {
        this.schedulePausedVideoAdvance(mediaId);
      }
    }
  }

  protected onVideoProgress(video: HTMLVideoElement, mediaId: string): void {
    if (this.currentMedia()?.id === mediaId && !this.crossfade()) {
      this.updateVideoProgress(video);
      this.noteVideoProgress(video);
      if (
        this.videoRecoveryAttempts > 0 &&
        this.videoRecoveryResumeAt !== null &&
        video.currentTime >= this.videoRecoveryResumeAt + 0.5
      ) {
        this.markVideoRecoverySucceeded(video, mediaId);
      }
    }
    if (this.reposeActive()) return;
    if (this.videoReachedEnd(video)) {
      this.completeVideo(mediaId);
    } else if (
      this.currentMedia()?.id === mediaId &&
      !this.crossfade() &&
      !this.overlayOpen() &&
      !video.paused &&
      !this.videoPaused()
    ) {
      this.videoPlaybackState.set('playing');
      this.armVideoWatchdog(video, mediaId);
    }
  }

  protected onVideoWaiting(
    video: HTMLVideoElement,
    mediaId: string,
    reason: 'waiting' | 'stalled',
  ): void {
    if (!this.isCurrentStableVideo(video, mediaId) || video.paused || this.videoPaused()) {
      return;
    }
    this.videoPlaybackState.set('waiting');
    this.armVideoWatchdog(video, mediaId, VIDEO_STALL_TIMEOUT_MS, reason);
  }

  protected onVideoSeeking(video: HTMLVideoElement, mediaId: string): void {
    if (!this.isCurrentStableVideo(video, mediaId)) return;
    this.clearVideoWatchdog();
    this.videoPlaybackState.set('loading');
  }

  protected onVideoSeeked(video: HTMLVideoElement, mediaId: string): void {
    if (!this.isCurrentStableVideo(video, mediaId)) return;
    this.updateVideoProgress(video);
    this.noteVideoProgress(video, true);
    if (!video.paused && !this.videoPaused()) {
      this.videoPlaybackState.set('playing');
      this.armVideoWatchdog(video, mediaId);
    }
  }

  protected onVideoError(video: HTMLVideoElement, mediaId: string, mediaSha256: string): void {
    if (this.stagingAttempt?.mediaKey === `${mediaId}:${mediaSha256}`) {
      this.settleStagingAttempt(
        new Error(`El video no se pudo preparar (código ${video.error?.code ?? 0}).`),
      );
      return;
    }
    const failedKey = `${mediaId}:${mediaSha256}`;
    const transition = this.crossfade();
    if (transition && this.mediaIdentity(transition.incoming) === failedKey) {
      this.cancelCrossfade();
      this.unavailableMedia.quarantine(transition.incoming);
      this.reportPreparationFailure(transition.incoming, new Error('Falló el video entrante.'));
      this.navigate(1, undefined, true);
      return;
    }
    if (!this.isCurrentStableVideo(video, mediaId)) return;
    this.videoPlaybackState.set('error');
    this.recoverOrSkipVideo(video, mediaId, `media-error-${video.error?.code ?? 0}`);
  }

  protected toggleVideoPlayback(event: Event): void {
    event.stopPropagation();
    const video = this.currentVideoElement();
    if (!video) {
      return;
    }
    if (video.paused) {
      this.clearPausedVideoAdvance();
      const mediaId = this.currentMedia()?.id;
      if (mediaId) this.attemptVideoPlay(video, mediaId);
    } else {
      this.clearVideoWatchdog();
      video.pause();
      this.videoPaused.set(true);
      this.videoPlaybackState.set('paused');
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
    this.noteVideoProgress(video, true);
    if (!video.paused && !this.videoPaused()) {
      const mediaId = this.currentMedia()?.id;
      if (mediaId) this.armVideoWatchdog(video, mediaId);
    }
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

  protected formatStoragePercent(percent: number): string {
    if (!Number.isFinite(percent) || percent <= 0) return '0 %';
    return `${percent < 1 ? percent.toFixed(1) : Math.round(percent)} %`;
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
    if (this.activeView() === 'viewer') {
      this.cancelNavigation();
      this.cancelCrossfade();
    }
    const wasViewer = this.activeView() === 'viewer';
    this.activeView.set(view);
    if (wasViewer) {
      this.clearPhotoTimer();
      this.clearVideoMonitoring();
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
    this.loading.set(false);
    this.connectionWarning.set(null);
    const current = this.manifest();
    if (current?.version === next.version || this.pendingManifest()?.version === next.version) {
      return;
    }
    const orderedNext = this.orderManifest(next);
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
    if (this.overlayOpen()) {
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
      this.pendingManifest.set(orderedNext);
      return;
    }
    if (!current || current.media.length === 0) {
      this.resetPhotoTransform();
      if (!current) {
        this.manifest.set({ ...orderedNext, media: [] });
      }
      this.pendingManifest.set(orderedNext);
      if (orderedNext.media.length === 0) {
        this.commitEmptyManifest(orderedNext);
        return;
      }
      if (!this.reposeActive()) {
        const checkpoint = this.playbackCheckpoint;
        const preferredMediaId =
          checkpoint && checkpoint.frameId === orderedNext.frameId
            ? orderedNext.media.find(
                (item) => item.id === checkpoint.mediaId && item.sha256 === checkpoint.mediaSha256,
              )?.id
            : undefined;
        this.navigate(1, preferredMediaId);
      }
      return;
    }
    this.pendingManifest.set(orderedNext);
    if (orderedNext.media.length === 0) {
      if (!this.reposeActive()) this.commitEmptyManifest(orderedNext);
      return;
    }
    if (this.preparingTransition()) {
      this.cancelNavigation();
      if (!this.reposeActive()) window.setTimeout(() => this.navigate(1), 0);
    }
  }

  private resetGalleryViewport(): void {
    this.galleryCurrentPage.set(0);
    window.requestAnimationFrame(() => {
      const viewport = this.galleryViewport?.nativeElement;
      if (!viewport) return;
      viewport.scrollTop = 0;
      this.updateGalleryGeometry(viewport);
    });
  }

  private updateGalleryGeometry(viewport: HTMLElement): void {
    if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
    const availableWidth = Math.max(
      GALLERY_MIN_CARD_WIDTH_PX,
      viewport.clientWidth - GALLERY_HORIZONTAL_PADDING_PX,
    );
    const columns = Math.max(
      1,
      Math.floor((availableWidth + GALLERY_GAP_PX) / (GALLERY_MIN_CARD_WIDTH_PX + GALLERY_GAP_PX)),
    );
    const cardWidth = (availableWidth - Math.max(0, columns - 1) * GALLERY_GAP_PX) / columns;
    const cardHeight = cardWidth * 0.75 + GALLERY_CARD_CAPTION_HEIGHT_PX;
    const next: GalleryGeometry = {
      columns,
      rowStep: cardHeight + GALLERY_GAP_PX,
      viewportHeight: viewport.clientHeight,
    };
    const current = this.galleryGeometry();
    if (
      current.columns !== next.columns ||
      Math.abs(current.rowStep - next.rowStep) > 0.5 ||
      Math.abs(current.viewportHeight - next.viewportHeight) > 0.5
    ) {
      this.galleryGeometry.set(next);
    }
  }

  private navigate(direction: -1 | 1, preferredMediaId?: string, replaceActive = false): void {
    if (this.overlayOpen() || this.reposeActive()) return;
    this.clearNavigationRetry();
    if (this.crossfade()) {
      return;
    }
    if (this.preparingTransition()) {
      if (!replaceActive) return;
      this.cancelNavigation();
    }
    const active = this.manifest();
    if (!active || !(this.pendingManifest()?.media.length || active.media.length)) return;

    this.clearPhotoTimer();
    this.clearVideoMonitoring();
    this.clearPausedVideoAdvance();
    this.clearViewerPointers();
    void this.prepareAndStartCrossfade(direction, preferredMediaId);
  }

  private async prepareAndStartCrossfade(
    direction: -1 | 1,
    preferredMediaId?: string,
  ): Promise<void> {
    const active = this.manifest();
    const outgoing = this.currentMedia();
    if (!active) return;

    const generation = ++this.navigationGeneration;
    const outgoingFitMode = outgoing ? this.fitModeFor(outgoing, active.settings) : null;
    this.preparingTransition.set(true);
    const candidates = navigationPlan({
      active,
      pending: this.pendingManifest(),
      currentIndex: this.currentIndex(),
      currentMediaId: outgoing?.id ?? null,
      direction,
      ...(preferredMediaId ? { preferredMediaId } : {}),
    });
    const searchStartedAt = performance.now();
    this.navigationFailures = 0;
    let attempted = 0;
    let exhausted = true;

    for (const candidate of candidates) {
      if (outgoing && this.mediaIdentity(candidate.item) === this.mediaIdentity(outgoing)) {
        if (candidates.length === 1) {
          if (candidate.manifest.version !== active.version) {
            this.commitPreparedCandidate(generation, candidate, false);
            return;
          }
          const onlyVideo = outgoing.kind === 'video' ? this.currentVideoElement() : null;
          if (onlyVideo && (onlyVideo.ended || onlyVideo.currentTime > 0)) {
            onlyVideo.currentTime = 0;
          }
          this.finishNavigationPreparation(generation);
          this.unavailableMedia.clear(candidate.item);
          this.resumeCurrentCycle();
          return;
        }
        continue;
      }
      if (
        this.unavailableMedia.contains(candidate.item) ||
        (candidate.item.kind === 'video' && this.isVideoQuarantined(candidate.item))
      ) {
        continue;
      }
      if (attempted > 0 && performance.now() - searchStartedAt >= NAVIGATION_SEARCH_SLICE_MS) {
        exhausted = false;
        break;
      }
      attempted += 1;
      try {
        await this.stageCandidate(generation, outgoing, outgoingFitMode, candidate);
      } catch (error) {
        if (error instanceof NavigationCancelledError || generation !== this.navigationGeneration) {
          return;
        }
        this.unavailableMedia.quarantine(candidate.item);
        this.navigationFailures += 1;
        this.reportPreparationFailure(candidate.item, error);
        continue;
      }
      if (generation !== this.navigationGeneration) return;
      this.unavailableMedia.clear(candidate.item);
      if (outgoing && outgoingFitMode) {
        this.beginCrossfade(generation, outgoing, outgoingFitMode, candidate);
      } else {
        this.commitPreparedCandidate(generation, candidate);
      }
      return;
    }

    if (generation !== this.navigationGeneration) return;
    this.finishNavigationPreparation(generation);
    this.resumeCurrentCycle();
    this.scheduleNavigationRetry(
      direction,
      exhausted ? NAVIGATION_RETRY_DELAY_MS : NAVIGATION_CONTINUATION_DELAY_MS,
    );
  }

  private stageCandidate(
    operationId: number,
    outgoing: MediaItem | null,
    outgoingFitMode: FitMode | null,
    target: NavigationCandidate,
  ): Promise<void> {
    this.discardStagingAttempt(new NavigationCancelledError('Preparación sustituida.'));
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => this.settleStagingAttempt(new Error('Tiempo de preparación agotado.')),
        MEDIA_PREPARATION_TIMEOUT_MS,
      );
      const cleanup = () => {
        window.clearTimeout(timeout);
      };
      this.stagingAttempt = {
        mediaKey: this.mediaIdentity(target.item),
        resolve,
        reject,
        cleanup,
      };
      this.staging.set({
        operationId,
        outgoing,
        outgoingFitMode,
        target,
        incomingFitMode: this.fitModeFor(target.item, target.manifest.settings),
        startedAt: performance.now(),
      });
    });
  }

  private commitPreparedCandidate(
    generation: number,
    target: NavigationCandidate,
    resetTransform = true,
  ): void {
    if (generation !== this.navigationGeneration) return;
    if (resetTransform) this.resetPhotoTransform();
    this.manifest.set(target.manifest);
    if (this.pendingManifest()?.version === target.manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(target.index);
    this.staging.set(null);
    this.preparingTransition.set(false);
    this.connectionWarning.set(null);
    this.videoPaused.set(false);
    this.persistPlaybackCheckpoint(true);
    if (target.item.kind === 'video') {
      window.setTimeout(() => this.playCurrentVideo(), 0);
    }
  }

  private commitEmptyManifest(manifest: FrameManifest): void {
    this.cancelNavigation();
    this.cancelCrossfade();
    this.resetPhotoTransform();
    this.manifest.set(manifest);
    if (this.pendingManifest()?.version === manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(0);
    this.videoPaused.set(false);
    this.videoPlaybackState.set('empty');
  }

  private applyPendingManifestOrResume(): void {
    const pending = this.pendingManifest();
    if (!pending) {
      this.resumeCurrentCycle();
      return;
    }
    if (pending.media.length === 0) {
      this.commitEmptyManifest(pending);
      return;
    }
    this.navigate(1, undefined, true);
  }

  private settleStagingAttempt(error?: Error): void {
    const attempt = this.stagingAttempt;
    if (!attempt) return;
    this.stagingAttempt = null;
    attempt.cleanup();
    if (error) attempt.reject(error);
    else attempt.resolve();
  }

  private discardStagingAttempt(error: Error): void {
    this.settleStagingAttempt(error);
    this.staging.set(null);
  }

  private beginCrossfade(
    generation: number,
    outgoing: MediaItem,
    outgoingFitMode: FitMode,
    target: NavigationCandidate,
  ): void {
    if (generation !== this.navigationGeneration) return;
    const outgoingVideo = this.currentVideoElement();
    if (outgoingVideo && !outgoingVideo.paused) outgoingVideo.pause();
    const durationMs = target.manifest.settings.fadeDurationMs;
    this.crossfade.set({
      outgoing,
      outgoingFitMode,
      incoming: target.item,
      incomingFitMode: this.fitModeFor(target.item, target.manifest.settings),
      durationMs,
      target,
      startedAt: performance.now(),
    });
    this.staging.set(null);
    this.preparingTransition.set(false);
    this.connectionWarning.set(null);
    this.clearCrossfadeTimer();
    this.crossfadeTimer = window.setTimeout(() => this.finishCrossfade(), durationMs);
  }

  private finishNavigationPreparation(generation: number): void {
    if (generation !== this.navigationGeneration) return;
    this.discardStagingAttempt(new NavigationCancelledError('Preparación finalizada.'));
    this.preparingTransition.set(false);
  }

  private cancelNavigation(): void {
    this.navigationGeneration += 1;
    this.discardStagingAttempt(new NavigationCancelledError('Preparación cancelada.'));
    this.preparingTransition.set(false);
    this.clearNavigationRetry();
  }

  private scheduleNavigationRetry(direction: -1 | 1, delayMs: number): void {
    this.clearNavigationRetry();
    this.navigationRetryTimer = window.setTimeout(() => {
      this.navigationRetryTimer = undefined;
      this.navigate(direction);
    }, delayMs);
  }

  private clearNavigationRetry(): void {
    if (this.navigationRetryTimer !== undefined) {
      window.clearTimeout(this.navigationRetryTimer);
      this.navigationRetryTimer = undefined;
    }
  }

  private reportPreparationFailure(item: MediaItem, error: unknown): void {
    const staging = this.staging();
    const event: ViewerMediaPreparationFailure = {
      type: 'viewer.media.preparation-failed',
      mediaId: item.id,
      mediaKind: item.kind,
      mediaSha256: item.sha256,
      manifestVersion: staging?.target.manifest.version ?? this.manifest()?.version ?? null,
      operationId: staging?.operationId ?? this.navigationGeneration,
      elapsedMs: staging ? Math.max(0, Math.round(performance.now() - staging.startedAt)) : 0,
      reason: (error instanceof Error ? error.message : String(error)).slice(0, 160),
    };
    console.warn(JSON.stringify(event));
    this.agent
      .reportMediaPreparationFailure(event)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  private cancelCrossfade(): void {
    if (!this.crossfade()) return;
    this.clearCrossfadeTimer();
    this.crossfade.set(null);
  }

  protected onPhotoLoaded(image: HTMLImageElement, mediaKey: string): void {
    const attempt = this.stagingAttempt;
    if (!attempt || attempt.mediaKey !== mediaKey) return;
    void (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).then(
      () => {
        if (this.stagingAttempt === attempt) this.settleStagingAttempt();
      },
      (error: unknown) => {
        if (this.stagingAttempt === attempt) {
          this.settleStagingAttempt(
            error instanceof Error ? error : new Error('La fotografía no se pudo decodificar.'),
          );
        }
      },
    );
  }

  protected onPhotoError(mediaId: string, mediaSha256: string): void {
    const failedKey = `${mediaId}:${mediaSha256}`;
    const attempt = this.stagingAttempt;
    if (attempt?.mediaKey === failedKey) {
      this.settleStagingAttempt(new Error('La fotografía no se pudo cargar.'));
      return;
    }
    const transition = this.crossfade();
    if (transition && this.mediaIdentity(transition.incoming) === failedKey) {
      this.cancelCrossfade();
      this.unavailableMedia.quarantine(transition.incoming);
      this.reportPreparationFailure(
        transition.incoming,
        new Error('Falló la fotografía entrante.'),
      );
      this.navigate(1, undefined, true);
      return;
    }
    const current = this.currentMedia();
    if (
      !current ||
      this.mediaIdentity(current) !== failedKey ||
      this.overlayOpen() ||
      this.reposeActive()
    )
      return;
    this.unavailableMedia.quarantine(current);
    this.reportPreparationFailure(current, new Error('Falló la fotografía visible.'));
    this.navigate(1, undefined, true);
  }

  protected onStagedVideoReady(video: HTMLVideoElement, mediaKey: string): void {
    const attempt = this.stagingAttempt;
    if (!attempt || attempt.mediaKey !== mediaKey || video.readyState < 2) {
      return;
    }
    this.settleStagingAttempt();
  }

  private finishCrossfade(): void {
    const transition = this.crossfade();
    if (!transition) return;
    this.crossfadeTimer = undefined;
    this.resetPhotoTransform();
    this.manifest.set(transition.target.manifest);
    if (this.pendingManifest()?.version === transition.target.manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(transition.target.index);
    this.crossfade.set(null);
    this.videoPaused.set(false);
    this.persistPlaybackCheckpoint(true);
    if (this.currentMedia()?.kind === 'video') {
      window.setTimeout(() => this.playCurrentVideo(), 0);
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
    this.clearVideoMonitoring();
    this.clearPausedVideoAdvance();
    this.videoPaused.set(false);
    this.navigate(1);
  }

  private videoReachedEnd(video: HTMLVideoElement): boolean {
    if (video.ended) return true;
    const duration = Number(video.duration);
    const currentTime = Number(video.currentTime);
    return (
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(currentTime) &&
      currentTime >= Math.max(0, duration - VIDEO_END_EPSILON_SECONDS)
    );
  }

  private beginVideoSession(video: HTMLVideoElement, mediaId: string): void {
    if (this.videoSessionMediaId === mediaId && this.videoSessionElement === video) return;
    this.clearVideoMonitoring();
    this.videoSessionMediaId = mediaId;
    this.videoSessionElement = video;
    this.videoLastObservedTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    this.videoLastProgressAt = performance.now();
    this.videoRecoveryAttempts = 0;
  }

  private noteVideoProgress(video: HTMLVideoElement, force = false): boolean {
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const progressed =
      force || currentTime >= this.videoLastObservedTime + VIDEO_PROGRESS_EPSILON_SECONDS;
    if (progressed) {
      this.videoLastObservedTime = currentTime;
      this.videoLastProgressAt = performance.now();
    }
    return progressed;
  }

  private armVideoWatchdog(
    video: HTMLVideoElement,
    mediaId: string,
    timeoutMs = VIDEO_STALL_TIMEOUT_MS,
    reason = 'playback-stalled',
  ): void {
    const expectsStartup =
      this.videoPlaybackState() === 'loading' || this.videoPlaybackState() === 'recovering';
    if (
      !this.isCurrentStableVideo(video, mediaId) ||
      ((video.paused || this.videoPaused()) && !expectsStartup)
    )
      return;
    this.beginVideoSession(video, mediaId);
    this.clearVideoWatchdog();
    const generation = this.videoSessionGeneration;
    const elapsed = performance.now() - this.videoLastProgressAt;
    const delay = Math.max(1, timeoutMs - elapsed);
    this.videoWatchdogTimer = window.setTimeout(() => {
      this.videoWatchdogTimer = undefined;
      if (
        generation !== this.videoSessionGeneration ||
        !this.isCurrentStableVideo(video, mediaId) ||
        ((video.paused || this.videoPaused()) &&
          this.videoPlaybackState() !== 'loading' &&
          this.videoPlaybackState() !== 'recovering')
      ) {
        return;
      }
      if (this.videoReachedEnd(video)) {
        this.completeVideo(mediaId);
        return;
      }
      if (video.seeking) {
        this.noteVideoProgress(video, true);
        this.armVideoWatchdog(video, mediaId, timeoutMs, reason);
        return;
      }
      if (this.noteVideoProgress(video)) {
        this.videoPlaybackState.set('playing');
        this.armVideoWatchdog(video, mediaId, VIDEO_STALL_TIMEOUT_MS);
        return;
      }
      this.recoverOrSkipVideo(video, mediaId, reason);
    }, delay);
  }

  private recoverOrSkipVideo(video: HTMLVideoElement, mediaId: string, reason: string): void {
    if (!this.isCurrentStableVideo(video, mediaId)) return;
    this.clearVideoWatchdog();
    if (this.videoRecoveryAttempts < VIDEO_MAX_RECOVERY_ATTEMPTS) {
      this.videoRecoveryAttempts += 1;
      this.videoPlaybackState.set('recovering');
      this.reportPlaybackEvent('viewer.playback.recovery', video, mediaId, reason);
      const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      this.videoRecoveryResumeAt = resumeAt;
      this.noteVideoProgress(video, true);
      const separator = this.currentMedia()?.url.includes('?') ? '&' : '?';
      const restorePosition = () => {
        if (!this.isCurrentStableVideo(video, mediaId)) return;
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 0.1));
        }
      };
      video.addEventListener('loadedmetadata', restorePosition, { once: true });
      video.src = `${this.currentMedia()?.url ?? video.currentSrc}${separator}naiskosRetry=${this.videoSessionGeneration}-${this.videoRecoveryAttempts}`;
      video.load();
      this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'recovery-timeout');
      return;
    }

    const item = this.currentMedia();
    const key = item ? this.videoQuarantineKey(item) : mediaId;
    const failures = (this.videoFailureCounts.get(key) ?? 0) + 1;
    this.videoFailureCounts.set(key, failures);
    if (failures >= VIDEO_QUARANTINE_FAILURES) {
      this.quarantinedVideos.set(key, Date.now() + VIDEO_QUARANTINE_MS);
    }
    this.videoPlaybackState.set('error');
    this.reportPlaybackEvent('viewer.playback.skipped', video, mediaId, reason);
    this.completeVideo(mediaId);
  }

  private clearVideoWatchdog(): void {
    if (this.videoWatchdogTimer !== undefined) {
      window.clearTimeout(this.videoWatchdogTimer);
      this.videoWatchdogTimer = undefined;
    }
  }

  private clearVideoMonitoring(): void {
    this.clearVideoWatchdog();
    this.videoSessionGeneration += 1;
    this.videoSessionMediaId = null;
    this.videoSessionElement = null;
    this.videoLastProgressAt = 0;
    this.videoLastObservedTime = 0;
    this.videoRecoveryAttempts = 0;
    this.videoRecoveryResumeAt = null;
  }

  private markVideoRecoverySucceeded(video: HTMLVideoElement, mediaId: string): void {
    this.reportPlaybackEvent('viewer.playback.recovered', video, mediaId, 'progress-restored');
    this.videoRecoveryAttempts = 0;
    this.videoRecoveryResumeAt = null;
    this.markVideoHealthy(mediaId);
  }

  private markVideoHealthy(mediaId: string): void {
    const item = this.currentMedia();
    if (!item || item.id !== mediaId) return;
    const key = this.videoQuarantineKey(item);
    this.videoFailureCounts.delete(key);
    this.quarantinedVideos.delete(key);
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
        !this.crossfade() &&
        !this.reposeActive()
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
      this.photoTimerInteractionMediaId !== null ||
      this.reposeActive()
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
        this.crossfade() ||
        this.reposeActive()
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
      this.clearVideoMonitoring();
      this.videosPausedInternally.add(video);
      video.pause();
      this.videoPlaybackState.set('paused');
    }
  }

  private resumeCurrentCycle(): void {
    if (this.reposeActive()) return;
    const video = this.currentVideoElement();
    if (video && this.currentMedia()?.kind === 'video') {
      if (this.videoPaused()) {
        const mediaId = this.currentMedia()?.id;
        if (mediaId) this.schedulePausedVideoAdvance(mediaId);
      } else {
        if (video.ended || video.error) video.currentTime = 0;
        this.playCurrentVideo();
      }
    } else {
      this.schedulePhotoAdvance(this.currentMedia(), this.settings().photoDurationSeconds);
    }
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
    const mediaId = this.currentMedia()?.id;
    if (
      !video ||
      !mediaId ||
      this.currentMedia()?.kind !== 'video' ||
      this.overlayOpen() ||
      this.reposeActive()
    ) {
      return;
    }
    video.volume = this.settings().volume;
    video.muted = this.settings().muted;
    this.clearPausedVideoAdvance();
    this.beginVideoSession(video, mediaId);
    this.attemptVideoPlay(video, mediaId);
  }

  private attemptVideoPlay(video: HTMLVideoElement, mediaId: string): void {
    this.beginVideoSession(video, mediaId);
    this.videoPlaybackState.set(this.videoRecoveryAttempts > 0 ? 'recovering' : 'loading');
    this.videoPaused.set(false);
    this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'play-start-timeout');
    void video.play().then(
      () => {
        if (!this.isCurrentStableVideo(video, mediaId)) return;
        this.videoPaused.set(false);
        this.videoPlaybackState.set('playing');
        this.noteVideoProgress(video, true);
        this.armVideoWatchdog(video, mediaId);
      },
      (error: unknown) => {
        if (!this.isCurrentStableVideo(video, mediaId)) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'play-aborted');
          return;
        }
        this.videoPlaybackState.set('error');
        this.recoverOrSkipVideo(video, mediaId, 'play-rejected');
      },
    );
  }

  private isCurrentStableVideo(video: HTMLVideoElement, mediaId: string): boolean {
    const current = this.currentMedia();
    return (
      current?.kind === 'video' &&
      current.id === mediaId &&
      video.dataset['mediaKey'] === this.mediaIdentity(current) &&
      !this.preparingTransition() &&
      !this.crossfade() &&
      !this.overlayOpen() &&
      !this.reposeActive()
    );
  }

  private videoQuarantineKey(item: MediaItem): string {
    return `${item.id}:${item.sha256}`;
  }

  private isVideoQuarantined(item: MediaItem): boolean {
    const key = this.videoQuarantineKey(item);
    const until = this.quarantinedVideos.get(key);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.quarantinedVideos.delete(key);
    return false;
  }

  private viewerPlaybackSnapshot(): ViewerPlaybackSnapshot {
    const media = this.currentMedia();
    const video = media?.kind === 'video' ? this.currentVideoElement() : null;
    return {
      buildId: VIEWER_BUILD_ID,
      sessionId: this.runtimeSessionId,
      quiescedFor: this.quiescedFor,
      uiReady: this.runtimeRendered() && this.repose() !== null && !this.runtimeQuiesced() &&
        (this.reposeActive() || (this.manifest() !== null && !this.loading() &&
          (document.querySelector('.stage--stable, .stage--incoming') !== null || this.manifest()?.media.length === 0))),
      mediaId: media?.id ?? null,
      mediaKind: media?.kind ?? null,
      state: this.reposeActive()
        ? 'repose'
        : media?.kind === 'photo'
          ? 'photo'
          : media?.kind === 'video'
            ? this.videoPlaybackState()
            : 'empty',
      currentTime: video && Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: video && Number.isFinite(video.duration) ? video.duration : 0,
      readyState: video?.readyState ?? 0,
      networkState: video?.networkState ?? 0,
      paused: video?.paused ?? false,
      ended: video?.ended ?? false,
      seeking: video?.seeking ?? false,
      view: this.reposeActive() ? 'repose' : this.overlayOpen() ? 'overlay' : 'viewer',
      navigation: this.viewerNavigationSnapshot(),
    };
  }

  private viewerNavigationSnapshot(): ViewerPlaybackSnapshot['navigation'] {
    const staging = this.staging();
    if (staging) {
      return {
        phase: 'staging',
        operationId: staging.operationId,
        candidateMediaId: staging.target.item.id,
        candidateMediaSha256: staging.target.item.sha256,
        phaseElapsedMs: Math.max(0, Math.round(performance.now() - staging.startedAt)),
        deadlineMs: MEDIA_PREPARATION_TIMEOUT_MS,
        failuresInOperation: this.navigationFailures,
      };
    }
    const transition = this.crossfade();
    if (transition) {
      return {
        phase: 'transitioning',
        operationId: this.navigationGeneration,
        candidateMediaId: transition.incoming.id,
        candidateMediaSha256: transition.incoming.sha256,
        phaseElapsedMs: Math.max(0, Math.round(performance.now() - transition.startedAt)),
        deadlineMs: transition.durationMs + 2_000,
        failuresInOperation: this.navigationFailures,
      };
    }
    return {
      phase: this.navigationFailures > 0 ? 'degraded' : 'stable',
      operationId: null,
      candidateMediaId: null,
      candidateMediaSha256: null,
      phaseElapsedMs: 0,
      deadlineMs: null,
      failuresInOperation: this.navigationFailures,
    };
  }

  private readPlaybackCheckpoint(): PlaybackCheckpoint | null {
    try {
      const raw = window.localStorage.getItem(PLAYBACK_CHECKPOINT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw) as Partial<PlaybackCheckpoint>;
      if (
        typeof value.frameId !== 'string' ||
        typeof value.mediaId !== 'string' ||
        typeof value.mediaSha256 !== 'string' ||
        (value.mediaKind !== 'photo' && value.mediaKind !== 'video') ||
        typeof value.currentTime !== 'number' ||
        !Number.isFinite(value.currentTime) ||
        typeof value.userPaused !== 'boolean' ||
        typeof value.updatedAt !== 'string'
      ) {
        return null;
      }
      return value as PlaybackCheckpoint;
    } catch {
      return null;
    }
  }

  private persistPlaybackCheckpoint(force = false): void {
    const manifest = this.manifest();
    const media = this.currentMedia();
    if (!manifest || !media) return;
    const video = media.kind === 'video' ? this.currentVideoElement() : null;
    const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const userPaused = media.kind === 'video' && this.videoPaused();
    const signature = [
      manifest.frameId,
      media.id,
      media.sha256,
      media.kind,
      media.kind === 'video' ? Math.floor(currentTime) : 0,
      userPaused ? 1 : 0,
    ].join(':');
    const now = Date.now();
    if (
      !force &&
      (signature === this.lastPlaybackCheckpointSignature ||
        now - this.lastPlaybackCheckpointWriteAt < PLAYBACK_CHECKPOINT_INTERVAL_MS)
    ) {
      return;
    }
    const checkpoint: PlaybackCheckpoint = {
      frameId: manifest.frameId,
      mediaId: media.id,
      mediaSha256: media.sha256,
      mediaKind: media.kind,
      currentTime,
      userPaused,
      updatedAt: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(PLAYBACK_CHECKPOINT_KEY, JSON.stringify(checkpoint));
      this.lastPlaybackCheckpointSignature = signature;
      this.lastPlaybackCheckpointWriteAt = now;
    } catch {
      // La persistencia mejora la continuidad, pero nunca bloquea la presentación.
    }
  }

  private applyReposeState(state: ReposeState): void {
    const currentState = this.repose();
    if (currentState && Date.parse(state.updatedAt) < Date.parse(currentState.updatedAt)) return;
    const initialized = currentState !== null;
    const previous = currentState?.active ?? true;
    this.repose.set(state);
    if (!previous && state.active) {
      this.enterRepose();
    } else if (previous && !state.active) {
      this.leaveRepose(initialized);
    }
  }

  private enterRepose(): void {
    const media = this.currentMedia();
    const video = this.currentVideoElement();
    this.persistPlaybackCheckpoint(true);
    this.clearReposeVideoResumeTimer();
    this.reposeVideoIntent =
      media?.kind === 'video'
        ? {
            mediaId: media.id,
            // videoPaused represents an explicit user pause. A video that is
            // loading or buffering still has an automatic-play intent even
            // though the browser reports `paused` momentarily.
            resume: !this.videoPaused() && !video?.ended,
          }
        : null;
    this.cancelNavigation();
    this.cancelCrossfade();
    this.clearPhotoTimer();
    this.clearVideoMonitoring();
    this.clearPausedVideoAdvance();
    this.clearViewerPointers();
    this.activeView.set('viewer');
    if (video && !video.paused) {
      this.videosPausedInternally.add(video);
      video.pause();
    }
  }

  private leaveRepose(deferVideoResume = true): void {
    this.hideReposeMenu();
    if (this.pendingManifest()) {
      this.reposeVideoIntent = null;
      this.applyPendingManifestOrResume();
      return;
    }
    const media = this.currentMedia();
    if (media?.kind === 'video') {
      const intent = this.reposeVideoIntent;
      const shouldResume = intent?.mediaId === media.id ? intent.resume : !this.videoPaused();
      if (shouldResume) {
        this.videoPaused.set(false);
        if (!deferVideoResume) {
          this.playCurrentVideo();
          this.reposeVideoIntent = null;
          return;
        }
        this.videoPlaybackState.set('loading');
        // Leave the repose state and let its pause event settle before asking
        // Chromium to play again. This prevents a late pause event from
        // winning the race against the resume request.
        this.clearReposeVideoResumeTimer();
        this.reposeVideoResumeTimer = window.setTimeout(() => {
          this.reposeVideoResumeTimer = undefined;
          if (this.currentMedia()?.id === media.id && !this.reposeActive()) {
            this.playCurrentVideo();
          }
        }, 0);
      } else {
        this.clearReposeVideoResumeTimer();
        this.schedulePausedVideoAdvance(media.id);
      }
    } else {
      this.schedulePhotoAdvance(media, this.settings().photoDurationSeconds);
    }
    this.reposeVideoIntent = null;
  }

  private clearReposeMenuTimer(): void {
    if (this.reposeMenuTimer !== undefined) {
      window.clearTimeout(this.reposeMenuTimer);
      this.reposeMenuTimer = undefined;
    }
  }

  private clearReposeVideoResumeTimer(): void {
    if (this.reposeVideoResumeTimer !== undefined) {
      window.clearTimeout(this.reposeVideoResumeTimer);
      this.reposeVideoResumeTimer = undefined;
    }
  }

  private reportPlaybackEvent(
    type: ViewerPlaybackEvent['type'],
    video: HTMLVideoElement,
    mediaId: string,
    reason: string,
  ): void {
    const media = this.currentMedia();
    if (media?.id !== mediaId) return;
    const event: ViewerPlaybackEvent = {
      ...this.viewerPlaybackSnapshot(),
      type,
      reason,
      attempt: this.videoRecoveryAttempts,
      mediaSha256: media.sha256,
      mediaErrorCode: video.error?.code ?? null,
    };
    this.agent
      .reportPlaybackEvent(event)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  private currentVideoElement(): HTMLVideoElement | null {
    const media = this.currentMedia();
    if (!media) {
      return null;
    }
    const mediaKey = this.mediaIdentity(media);
    return (
      this.videoElements
        ?.toArray()
        .map((element) => element.nativeElement)
        .find((video) => video.dataset['mediaKey'] === mediaKey) ?? null
    );
  }

  protected mediaIdentity(item: MediaItem): string {
    return `${item.id}:${item.sha256}`;
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
