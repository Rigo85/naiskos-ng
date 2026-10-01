import { collageBackground, samePlaybackContent } from './core/collage-background';
import { iconForWeatherCode } from './core/weather-icons';
import { WeatherIcon } from './weather-icon';
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
import { Subscription, catchError, firstValueFrom, of, switchMap, timer, timeout } from 'rxjs';
import { CollageCycle } from './core/collage-cycle';
import { CollagePlannerClient } from './core/collage-planner-client';
import { CollageTrace, collageStorage } from './core/collage-trace';

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
import { PhotoReserve } from './core/photo-reserve';
import { SceneLease } from './core/scene-lease';
import {
  MediaFailureRegistry,
} from './core/navigation-policy';
import {
  buildScenes, MediaScene, omitSceneItems, refineScene, SceneCandidate, sceneNavigationPlan,
} from './core/collage-policy';

type SlidePhase = 'stable' | 'staging' | 'outgoing' | 'incoming';
type AppView = 'viewer' | 'menu' | 'gallery' | 'settings' | 'notifications';
type GalleryFilter = 'all' | 'photo' | 'video';
type GalleryOrder = 'newest' | 'oldest';
type SettingsSection = 'presentation' | 'widgets' | 'playback' | 'storage' | 'device';
type NavigationSource = 'manual' | 'gallery' | 'automatic' | 'system';

interface NavigationIntent {
  direction: -1 | 1;
  preferred?: string;
  source: NavigationSource;
  requestedAt: number;
}

interface RenderedSlide {
  scene: MediaScene;
  item: MediaItem;
  phase: SlidePhase;
  fitMode: FitMode;
}

interface CrossfadeState {
  operationId: number;
  source: NavigationSource;
  direction: -1 | 1;
  outgoingScene: MediaScene;
  outgoing: MediaItem;
  outgoingFitMode: FitMode;
  incoming: MediaItem;
  incomingFitMode: FitMode;
  durationMs: number;
  target: SceneCandidate;
  startedAt: number;
}

interface StagingState {
  outgoingScene: MediaScene | null;
  operationId: number;
  outgoing: MediaItem | null;
  outgoingFitMode: FitMode | null;
  target: SceneCandidate;
  incomingFitMode: FitMode;
  startedAt: number;
}

interface StagingAttempt {
  pendingKeys: Set<string>;
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
class ScenePreparationError extends Error {
  constructor(readonly item: MediaItem, message: string) { super(message); }
}

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
  imports: [WeatherIcon],
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
  private readonly collageTrace = new CollageTrace(
    (event) => firstValueFrom(this.agent.reportCollageEvent(event).pipe(timeout(5_000))),
    this.runtimeSessionId, VIEWER_BUILD_ID, collageStorage());
  private readonly collageCycle = new CollageCycle(new CollagePlannerClient(),
    (action, details) => this.collageTrace.emit(action, details), collageStorage());
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
  private readonly sceneCache = new WeakMap<FrameManifest, MediaScene[]>();
  // Initial round seed; CollageCycle owns subsequent seeds and restart checkpoints.
  private readonly adaptiveMixSeed = Math.floor(Math.random() * 0x1_0000_0000);
  private readonly committedScene = signal<MediaScene | null>(null);
  protected readonly collageEnabled = computed(() => (this.settings().collageMode ?? 'off') !== 'off');
  protected readonly currentScene = computed(() => {
    const manifest = this.manifest();
    return this.committedScene() ?? (manifest ? this.scenesFor(manifest)[this.currentIndex()] : null) ?? null;
  });
  protected readonly currentMedia = computed(() => this.currentScene()?.driver ?? null);
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
    return current ? iconForWeatherCode(current.weatherCode, current.isDay) : 'pending';
  });
  protected readonly weatherIcon = computed(() => {
    const current = this.weather().current;
    if (!current || this.weather().status !== 'ready') return 'pending';
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
          scene: crossfade.outgoingScene,
          phase: 'outgoing',
          fitMode: crossfade.outgoingFitMode,
        },
        {
          item: crossfade.incoming,
          scene: crossfade.target.scene,
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
                scene: staging.outgoingScene!,
                phase: 'stable' as const,
                fitMode: staging.outgoingFitMode,
              },
            ]
          : []),
        {
          item: staging.target.item,
          scene: staging.target.scene,
          phase: 'staging',
          fitMode: staging.incomingFitMode,
        },
      ];
    }
    const current = this.currentMedia();
    return current
      ? [{ item: current, scene: this.currentScene()!, phase: 'stable', fitMode: this.fitModeFor(current, this.settings()) }]
      : [];
  });
  protected readonly preloadUrls = computed(() => {
    if (this.collageEnabled()) return [];
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

  private pointerStart: (GesturePoint & { pointerId: number; transition: CrossfadeState | null }) | null = null;
  private readonly activePointers = new Map<number, ActivePointer>();
  private photoGesture: PhotoGestureState | null = null;
  private suppressNavigationUntilPointersClear = false;
  private photoTimerInteractionMediaId: string | null = null;
  private photoInteractionStartedAt: number | null = null;
  private photoTimer: number | undefined;
  private photoTimerGeneration = 0;
  private crossfadeTimer: number | undefined;
  private navigationRetryTimer: number | undefined;
  private navigationRetryAt: number | null = null;
  private navigationRetryDelay = 0;
  private videoWatchdogTimer: number | undefined;
  private pausedVideoAdvanceTimer: number | undefined;
  private videoSessionGeneration = 0;
  private videoSessionMediaId: string | null = null;
  private videoSessionElement: HTMLVideoElement | null = null;
  private videoLastProgressAt = 0;
  private videoLastObservedTime = 0;
  private videoRecoveryAttempts = 0;
  private videoRecoveryResumeAt: number | null = null;
  private sceneLease: SceneLease | null = null;
  private leaseSequence = 0;
  private readonly videoFailureCounts = new Map<string, number>();
  private readonly quarantinedVideos = new Map<string, number>();
  private readonly unavailableMedia = new MediaFailureRegistry(MEDIA_QUARANTINE_MS);
  private navigationGeneration = 0;
  private collagePreload: { target: SceneCandidate | null; ready: boolean; sourceKey: string;
    done: Promise<void>; startedAt: number } | null = null;
  private readonly photoReserve = new PhotoReserve();
  private reserveDirection: -1 | 1 = 1;
  private navigationIntent: NavigationIntent | null = null;
  private deferredNavigation: { operationId: number; direction: -1 | 1; requestedAt: number } | null = null;
  private collagePreloadTimer: number | undefined;
  private collagePreloadAttemptKey: string | null = null;
  private stagingAttempt: StagingAttempt | null = null;
  private sceneRefreshId: string | undefined;
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
    this.restoreVideoExclusions();
    this.subscriptions.add(timer(500, 500).subscribe(() => this.checkSceneLease()));
    afterNextRender(() => this.runtimeRendered.set(true));
    this.subscriptions.add(timer(3_000, 3_000).subscribe(() => { this.warmCollage(); void this.preloadCollage(); }));
    this.subscriptions.add(timer(0, 1_000).pipe(
      switchMap(() => this.agent.getRuntimeControl().pipe(catchError(() => of(null)))),
    ).subscribe((control) => {
      for (const entry of control?.playbackExclusions ?? []) {
        if (entry.until > Date.now()) this.quarantinedVideos.set(`${entry.mediaId}:${entry.sha256}`, entry.until);
      }
      const current = this.currentMedia();
      const externallyBlocked = current?.kind === 'video' && this.isVideoQuarantined(current);
      if (this.sceneLease && !this.sceneLease.expired &&
        (externallyBlocked || control?.playbackSafety?.healthy === false && control.playbackSafety.leaseId === this.sceneLease.id) &&
        !this.reposeActive() && !this.overlayOpen() && !this.preparingTransition() && !this.crossfade()) {
        this.sceneLease.expired = true;
        const item = this.currentMedia();
        if (item?.kind === 'video' && control?.playbackSafety?.reason !== 'pause-budget-expired') this.excludeVideo(item);
        this.collageTrace.emit('scene-budget-expired', { reason: 'agent-safety', operationId: this.leaseSequence });
        this.navigate(1, undefined, 'system');
      }
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
    this.collageCycle.destroy();
    this.collageTrace.destroy();
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
      transition: this.crossfade(),
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    };

    const current = this.currentMedia();
    const transform = this.photoTransform();
    if (
      !this.collageEnabled() &&
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
    this.collageTrace.emit('input-classified', { reason: action,
      elapsedMs: Math.max(0, Math.round(end.at - start.at)) });

    if (action === 'open-settings') {
      this.abandonPhotoTimerInteraction();
      this.openMainMenu();
      return;
    }
    if (this.collageEnabled() && action !== 'tap-left' && action !== 'tap-right') {
      this.finishPhotoTimerInteraction();
      return;
    }
    if (action === 'next') {
      this.abandonPhotoTimerInteraction();
      this.navigateFromGesture(1, start.transition);
      return;
    }
    if (action === 'previous') {
      this.abandonPhotoTimerInteraction();
      this.navigateFromGesture(-1, start.transition);
      return;
    }
    if (action === 'tap-left' || action === 'tap-right') {
      const side = action === 'tap-left' ? 'left' : 'right';
      const isSecondTap = this.lastTapSide === side && event.timeStamp - this.lastTapAt <= 350;
      this.lastTapAt = event.timeStamp;
      this.lastTapSide = side;
      if (!isSecondTap) {
        this.abandonPhotoTimerInteraction();
        this.navigateFromGesture(side === 'left' ? -1 : 1, start.transition);
        return;
      }
      this.collageTrace.emit('navigation-ignored', { reason: 'double-tap' });
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
    this.navigate(1, mediaId, 'gallery');
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
    if (video.closest('.stage--staging') || video !== this.currentVideoElement()) return;
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
        this.sceneLease?.seek(performance.now(), Math.min(checkpoint.currentTime, Math.max(0, video.duration - 0.1)));
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

  protected onVideoEnded(video: HTMLVideoElement, mediaId: string): void {
    if (!this.isCurrentStableVideo(video, mediaId)) return;
    if (video && this.videoRecoveryResumeAt !== null) {
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
    if (this.isCurrentStableVideo(video, mediaId)) {
      const resumed = this.sceneLease?.snapshot(performance.now()).pauseRemainingMs != null;
      this.sceneLease?.play(performance.now());
      if (resumed) this.traceSceneBudget('play');
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
    if (this.sceneLease?.expired) return;
    if (video !== this.currentVideoElement() || video.closest('.stage--staging')) return;
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
      this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'technical-pause-timeout');
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
    if (video !== this.currentVideoElement() || video.closest('.stage--staging')) return;
    if (this.currentMedia()?.id === mediaId && !this.crossfade()) {
      this.updateVideoProgress(video);
      if (!video.seeking) this.noteVideoProgress(video);
      if (
        this.videoRecoveryAttempts > 0 &&
        this.videoRecoveryResumeAt !== null &&
        !video.seeking && video.currentTime >= this.videoRecoveryResumeAt + 0.5
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
      !video.seeking &&
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
    this.videoPlaybackState.set('loading');
    this.armVideoWatchdog(video, mediaId, VIDEO_START_TIMEOUT_MS, 'seek-timeout');
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
    if (this.failReadyCollagePreload(`${mediaId}:${mediaSha256}`)) return;
    if (this.stagingAttempt && this.staging()?.target.scene.cells.some((cell) => this.mediaIdentity(cell.item) === `${mediaId}:${mediaSha256}`)) {
      this.failStagedCell(`${mediaId}:${mediaSha256}`, `El video no se pudo preparar (código ${video.error?.code ?? 0}).`);
      return;
    }
    const failedKey = `${mediaId}:${mediaSha256}`;
    const transition = this.crossfade();
    if (transition && this.mediaIdentity(transition.incoming) === failedKey) {
      this.cancelCrossfade();
      this.unavailableMedia.quarantine(transition.incoming);
      this.reportPreparationFailure(transition.incoming, new Error('Falló el video entrante.'));
      this.navigate(1, undefined, 'system');
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
      this.sceneLease?.play(performance.now());
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
    this.sceneLease?.seek(performance.now(), Math.min(Math.max(0, requestedTime), duration));
    this.traceSceneBudget('seek');
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
      !this.collageEnabled() &&
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
    this.photoInteractionStartedAt ??= performance.now();
    this.clearPhotoTimer();
  }

  private finishPhotoTimerInteraction(): void {
    if (this.activePointers.size > 0) {
      return;
    }
    const mediaId = this.photoTimerInteractionMediaId;
    this.photoInteractionStartedAt = null;
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
    this.photoInteractionStartedAt = null;
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
    this.suspendSceneLease(true);
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
    const comparable = this.pendingManifest() ?? current;
    if (comparable && samePlaybackContent(comparable, orderedNext)) {
      const items = new Map(orderedNext.media.map((item) => [item.id, item]));
      this.sceneCache.set(orderedNext, this.scenesFor(comparable).map((scene) => ({
        ...scene, driver: items.get(scene.driver.id)!,
        cells: scene.cells.map((cell) => ({ ...cell, item: items.get(cell.item.id)! })),
      })));
      // Keep DOM, timers, video intent and an in-flight preparation intact. New palettes
      // become visible at the next natural scene boundary, never halfway through a fade.
      if (this.pendingManifest() || this.preparingTransition() || this.crossfade()) {
        this.pendingManifest.set(orderedNext);
      } else {
        this.committedScene.set(this.currentScene());
        this.manifest.set(orderedNext);
      }
      return;
    }
    const pendingOperation = this.galleryOperation();
    this.clearDeferredNavigation('content-changed');
    this.cancelCollagePreload('manifest-changed');
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
        this.navigate(1, preferredMediaId, 'system');
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
      if (!this.reposeActive()) window.setTimeout(() => this.navigate(1, undefined, 'system'), 0);
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

  private navigateFromGesture(direction: -1 | 1, startedDuring: CrossfadeState | null): void {
    // Pointerdown may fall inside the automatic fade and pointerup just after
    // commit. It is still the same overlapping gesture, not a request to skip C.
    if (startedDuring?.source === 'automatic' && direction === startedDuring.direction &&
      startedDuring.operationId === this.navigationGeneration && !this.crossfade() &&
      !this.preparingTransition() && !this.overlayOpen() && !this.reposeActive() &&
      this.currentScene()?.key === startedDuring.target.scene.key) {
      this.collageTrace.emit('navigation-requested', { source: 'manual', direction });
      this.collageTrace.emit('navigation-joined', { reason: 'automatic-just-committed', source: 'manual',
        direction, operationId: startedDuring.operationId });
      this.schedulePhotoAdvance(this.currentMedia(), this.settings().photoDurationSeconds);
      return;
    }
    this.navigate(direction, undefined, 'manual');
  }

  private navigate(direction: -1 | 1, preferredMediaId?: string, source: NavigationSource = 'automatic', requestedAt?: number): void {
    const at = requestedAt ?? performance.now();
    if (requestedAt === undefined) this.collageTrace.emit('navigation-requested', { source, direction });
    if (this.overlayOpen() || this.reposeActive()) {
      this.collageTrace.emit('navigation-ignored', { reason: 'overlay-or-repose', source, direction });
      return;
    }
    this.clearNavigationRetry();
    const transition = this.crossfade();
    if (transition) {
      if (source === 'manual' && !preferredMediaId) {
        if (transition.source === 'automatic' && direction === transition.direction) {
          this.clearDeferredNavigation('joined-automatic');
          this.collageTrace.emit('navigation-joined', { reason: 'automatic-crossfade', source, direction,
            operationId: transition.operationId });
        } else {
          const replaced = this.deferredNavigation !== null;
          this.deferredNavigation = { operationId: transition.operationId, direction, requestedAt: at };
          this.collageTrace.emit('navigation-deferred', { reason: replaced ? 'replaced' : 'queued', source,
            direction, operationId: transition.operationId });
        }
      } else this.collageTrace.emit('navigation-ignored', { reason: 'crossfade', source, direction });
      return;
    }
    if (this.preparingTransition()) {
      if (source === 'automatic') return;
      if (this.navigationIntent?.direction === direction && this.navigationIntent.preferred === preferredMediaId) {
        this.collageTrace.emit('preload-joined', { operationId: this.navigationGeneration, reason: 'same-navigation' });
        return;
      }
      // A repeated request for the same in-flight preload joins its original
      // deadline rather than destroying the DOM/decode work.
      if (!this.collagePreload) this.cancelNavigation();
    }
    const active = this.manifest();
    if (!active || !(this.pendingManifest()?.media.length || active.media.length)) return;

    this.reserveDirection = direction;
    this.navigationIntent = { direction, preferred: preferredMediaId, source, requestedAt: at };
    this.clearPhotoTimer();
    this.clearVideoMonitoring();
    this.clearPausedVideoAdvance();
    this.clearViewerPointers();
    void this.prepareAndStartCrossfade(direction, preferredMediaId);
  }

  private clearDeferredNavigation(reason: string): void {
    const pending = this.deferredNavigation;
    if (!pending) return;
    this.deferredNavigation = null;
    this.collageTrace.emit('navigation-deferred-cleared', { reason, direction: pending.direction,
      operationId: pending.operationId });
  }

  private recordNavigationVisible(operationId: number, reason: 'direct' | 'crossfade'): void {
    const intent = this.navigationIntent;
    if (!intent) return;
    this.collageTrace.emit('navigation-visible', { operationId, source: intent.source, reason,
      elapsedMs: Math.round(performance.now() - intent.requestedAt) });
    this.navigationIntent = null;
  }

  private scheduleCollagePreload(delayMs = 0): void {
    if (this.collagePreloadTimer !== undefined) window.clearTimeout(this.collagePreloadTimer);
    if (!this.collageEnabled()) return;
    this.collagePreloadTimer = window.setTimeout(() => {
      this.collagePreloadTimer = undefined;
      void this.preloadCollage();
    }, delayMs);
  }

  private async preloadCollage(): Promise<void> {
    const current = this.currentScene();
    if (!this.collageEnabled() || !current || this.overlayOpen() || this.reposeActive() ||
      this.preparingTransition() || this.crossfade() || this.collagePreload ||
      this.collagePreloadAttemptKey === current.key) return;
    this.collagePreloadAttemptKey = current.key;
    const operation = { target: null as SceneCandidate | null, ready: false, sourceKey: current.key,
      done: Promise.resolve(), startedAt: performance.now() };
    this.collagePreload = operation;
    operation.done = this.prepareCollagePreload(operation, current);
    await operation.done;
  }

  private async prepareCollagePreload(operation: NonNullable<App['collagePreload']>, current: MediaScene): Promise<void> {
    try {
      const next = (await this.navigationCandidates(1, undefined, false))[0];
      if (this.collagePreload !== operation) return;
      if (!next || next.scene.cells.some((c) => current.cells.some((v) => v.item.id === c.item.id))) {
        this.collagePreload = null;
        return;
      }
      const target = await this.collageCycle.refine(next);
      if (this.collagePreload !== operation) return;
      operation.target = target;
      await this.stageCandidate(this.navigationGeneration, current.driver,
        this.fitModeFor(current.driver, this.settings()), target);
      if (this.collagePreload !== operation) return;
      operation.ready = true;
      this.collageTrace.emit('preload-ready', { mediaIds: target.scene.cells.map((c) => c.item.id),
        round: target.cycle?.round ?? 0, operationId: this.navigationGeneration,
        elapsedMs: Math.round(performance.now() - operation.startedAt) });
      void this.warmAuxiliary(operation);
    } catch (error) {
      if (this.collagePreload !== operation) return;
      this.collagePreload = null;
      if (error instanceof ScenePreparationError) {
        this.unavailableMedia.quarantine(error.item);
        this.reportPreparationFailure(error.item, error);
      }
      this.discardStagingAttempt(new NavigationCancelledError('Precarga finalizada.'));
      this.collageTrace.emit('preload-failed', { reason: 'preparation-failed', operationId: this.navigationGeneration });
      this.collagePreloadAttemptKey = null;
      // Retry/recompose while current content continues, not at its deadline.
      this.scheduleCollagePreload(error instanceof ScenePreparationError ? 0 : 5_000);
    }
  }

  private cancelCollagePreload(reason: string): void {
    if (this.collagePreloadTimer !== undefined) window.clearTimeout(this.collagePreloadTimer);
    this.collagePreloadTimer = undefined;
    this.collagePreloadAttemptKey = null;
    if (reason !== 'navigation-changed') this.photoReserve.clear();
    if (!this.collagePreload) return;
    this.collagePreload = null;
    this.discardStagingAttempt(new NavigationCancelledError('Precarga cancelada.'));
    this.collageTrace.emit('preload-cancelled', { reason, operationId: this.navigationGeneration });
  }

  private async warmAuxiliary(operation: NonNullable<App['collagePreload']>): Promise<void> {
    const candidates = await this.navigationCandidates(this.reserveDirection, undefined, false);
    if (this.collagePreload !== operation || this.reposeActive() || this.overlayOpen()) return;
    const candidate = this.reserveDirection === -1 ? candidates[0] : candidates[1];
    if (!candidate) { this.photoReserve.clear(); return; }
    const result = await this.photoReserve.prepare(candidate.scene.cells.map((c) => c.item));
    if (result !== 'unchanged' && this.collagePreload === operation) this.collageTrace.emit('reserve-ready', {
      reason: result, mediaIds: candidate.scene.cells.map((c) => c.item.id), direction: this.reserveDirection });
  }

  private failReadyCollagePreload(mediaKey: string): boolean {
    if (!this.collagePreload?.ready) return false;
    const item = this.collagePreload.target?.scene.cells.find((c) => this.mediaIdentity(c.item) === mediaKey)?.item;
    if (!item) return false;
    this.unavailableMedia.quarantine(item);
    this.reportPreparationFailure(item, new Error('Falló un medio ya precargado.'));
    this.cancelCollagePreload('prepared-media-failed');
    this.scheduleCollagePreload(0);
    return true;
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
    const plan = this.navigationCandidates(direction, preferredMediaId);
    const candidates = Array.isArray(plan) ? plan : await plan;
    if (generation !== this.navigationGeneration) return;
    const preload = this.collagePreload;
    if (preload && direction === 1 && !preferredMediaId && preload.sourceKey === this.currentScene()?.key) {
      if (!preload.ready) this.collageTrace.emit('preload-joined', { operationId: generation });
      await preload.done;
      if (generation !== this.navigationGeneration) return;
      const target = preload.target, expected = candidates[0];
      if (this.collagePreload === preload && preload.ready && target && expected &&
        target.manifest.frameId === expected.manifest.frameId &&
        target.manifest.settings.collageMode === expected.manifest.settings.collageMode &&
        target.manifest.settings.defaultFitMode === expected.manifest.settings.defaultFitMode &&
        target.cycle?.fingerprint === expected.cycle?.fingerprint && target.cycle?.round === expected.cycle?.round &&
        target.cycle?.seed === expected.cycle?.seed && target.historyIndex === expected.historyIndex &&
        target.scene.cells.length === expected.scene.cells.length && target.scene.cells.every((c, i) =>
          this.mediaIdentity(c.item) === this.mediaIdentity(expected.scene.cells[i].item) &&
          c.item.url === expected.scene.cells[i].item.url && c.item.fitMode === expected.scene.cells[i].item.fitMode)) {
        this.collagePreload = null;
        this.collageTrace.emit('preload-used', { mediaIds: target.scene.cells.map((c) => c.item.id),
          round: target.cycle?.round ?? 0, operationId: generation });
        const refreshed = { ...target, manifest: expected.manifest, scene: { ...target.scene,
          cells: target.scene.cells.map((c, i) => ({ ...c, item: expected.scene.cells[i].item })),
          driver: expected.scene.driver } };
        if (outgoing && outgoingFitMode) this.beginCrossfade(generation, outgoing, outgoingFitMode, refreshed);
        else this.commitPreparedCandidate(generation, refreshed);
        return;
      }
    }
    if (this.collagePreload) this.cancelCollagePreload('navigation-changed');
    const searchStartedAt = performance.now();
    this.navigationFailures = 0;
    let attempted = 0;
    let exhausted = true;

    for (let position = 0; position < candidates.length; position += 1) {
      let candidate = candidates[position];
      const available = omitSceneItems(candidate.scene, (item) => this.collageUnavailable(item));
      if (!available) continue;
      candidate = { ...candidate, scene: available, item: available.driver };
      candidate = candidate.cycle || candidate.historyIndex !== undefined
        ? await this.collageCycle.refine(candidate)
        : { ...candidate, scene: refineScene(available, candidate.manifest.settings.defaultFitMode) };
      if (generation !== this.navigationGeneration) return;
      if (outgoing && candidate.scene.key === this.currentScene()?.key) {
        if (candidates.length === 1) {
          if (candidate.manifest.version !== active.version) {
            this.commitPreparedCandidate(generation, candidate, false);
            return;
          }
          const onlyVideo = outgoing.kind === 'video' ? this.currentVideoElement() : null;
          if (onlyVideo && (onlyVideo.ended || onlyVideo.currentTime > 0)) {
            onlyVideo.currentTime = 0;
          }
          this.startSceneLease(outgoing);
          this.finishNavigationPreparation(generation);
          this.unavailableMedia.clear(candidate.item);
          this.resumeCurrentCycle();
          return;
        }
        continue;
      }
      if (this.collageUnavailable(candidate.item)) continue;
      if (attempted > 0 && performance.now() - searchStartedAt >= NAVIGATION_SEARCH_SLICE_MS) {
        exhausted = false;
        break;
      }
      attempted += 1;
      try {
        await this.stageCandidate(generation, outgoing, outgoingFitMode, candidate);
      } catch (error) {
        if (error instanceof NavigationCancelledError || generation !== this.navigationGeneration) return;
        const failedItem = error instanceof ScenePreparationError ? error.item : candidate.item;
        this.unavailableMedia.quarantine(failedItem);
        this.navigationFailures += 1;
        this.reportPreparationFailure(failedItem, error);
        const remainder = omitSceneItems(candidate.scene, (item) => item.id === failedItem.id);
        if (remainder) candidates.splice(position + 1, 0,
          { ...candidate, scene: remainder, item: remainder.driver });
        continue;
      }
      if (generation !== this.navigationGeneration) return;
      this.unavailableMedia.clear(candidate.item);
      if (outgoing && outgoingFitMode) this.beginCrossfade(generation, outgoing, outgoingFitMode, candidate);
      else this.commitPreparedCandidate(generation, candidate);
      return;
    }
    if (generation !== this.navigationGeneration) return;
    this.finishNavigationPreparation(generation);
    this.resumeCurrentCycle();
    this.scheduleNavigationRetry(direction,
      exhausted ? NAVIGATION_RETRY_DELAY_MS : NAVIGATION_CONTINUATION_DELAY_MS);
  }

  private collageUnavailable(item: MediaItem): boolean {
    return this.unavailableMedia.contains(item) || (item.kind === 'video' && this.isVideoQuarantined(item));
  }

  private warmCollage(): void {
    if (this.collageEnabled() && !this.overlayOpen() && !this.reposeActive() &&
      !this.preparingTransition() && !this.crossfade()) void this.collageCycle.warm(this.currentScene(), (m) => this.collageUnavailable(m));
  }

  private navigationCandidates(direction: -1 | 1, preferredMediaId?: string, traceSelection = true): SceneCandidate[] | Promise<SceneCandidate[]> {
    const active = this.manifest()!;
    const target = this.pendingManifest() ?? active;
    if ((target.settings.collageMode ?? 'off') !== 'off') return this.collageCycle.candidates(
      target, window.innerWidth / window.innerHeight, this.adaptiveMixSeed,
      this.currentScene(), direction, preferredMediaId, (item) => this.collageUnavailable(item), traceSelection);
    this.collageCycle.reset();
    return sceneNavigationPlan({
      active,
      pending: this.pendingManifest(),
      currentIndex: this.currentIndex(),
      currentMediaId: this.currentMedia()?.id ?? null,
      direction,
      ...(preferredMediaId ? { preferredMediaId } : {}),
    }, (manifest) => this.scenesFor(manifest));
  }

  private stageCandidate(
    operationId: number,
    outgoing: MediaItem | null,
    outgoingFitMode: FitMode | null,
    target: SceneCandidate,
  ): Promise<void> {
    this.discardStagingAttempt(new NavigationCancelledError('Preparación sustituida.'));
    if (this.photoReserve.has(target.scene.cells.map((c) => c.item))) {
      this.collageTrace.emit('reserve-used', { mediaIds: target.scene.cells.map((c) => c.item.id), operationId });
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => {
          const item = target.scene.cells.find((cell) => this.stagingAttempt?.pendingKeys.has(this.mediaIdentity(cell.item)))?.item ?? target.item;
          this.settleStagingAttempt(new ScenePreparationError(item, 'Tiempo de preparación agotado.'));
        },
        MEDIA_PREPARATION_TIMEOUT_MS,
      );
      const cleanup = () => {
        window.clearTimeout(timeout);
      };
      this.stagingAttempt = {
        pendingKeys: new Set(target.scene.cells.map((cell) => this.mediaIdentity(cell.item))),
        resolve,
        reject,
        cleanup,
      };
      this.staging.set({
        operationId,
        outgoing,
        outgoingScene: this.currentScene(),
        outgoingFitMode,
        target,
        incomingFitMode: this.fitModeFor(target.item, target.manifest.settings),
        startedAt: performance.now(),
      });
    });
  }

  private commitPreparedCandidate(
    generation: number,
    target: SceneCandidate,
    resetTransform = true,
  ): void {
    if (generation !== this.navigationGeneration) return;
    if (resetTransform) this.resetPhotoTransform();
    this.manifest.set(target.manifest);
    if (this.pendingManifest()?.version === target.manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(target.index);
    this.committedScene.set(target.scene);
    this.startSceneLease(target.item);
    this.collageCycle.commit(target);
    this.collagePreloadAttemptKey = null;
    this.staging.set(null);
    this.preparingTransition.set(false);
    this.recordNavigationVisible(generation, 'direct');
    this.connectionWarning.set(null);
    this.videoPaused.set(false);
    this.persistPlaybackCheckpoint(true);
    this.warmCollage();
    this.scheduleCollagePreload(0);
    if (target.item.kind === 'video') {
      window.setTimeout(() => this.playCurrentVideo(), 0);
    }
  }

  private commitEmptyManifest(manifest: FrameManifest): void {
    this.sceneLease = null;
    this.collageCycle.reset();
    this.cancelNavigation();
    this.cancelCrossfade();
    this.resetPhotoTransform();
    this.manifest.set(manifest);
    if (this.pendingManifest()?.version === manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(0);
    this.committedScene.set(null);
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
    const preferred = this.sceneRefreshId;
    this.sceneRefreshId = undefined;
    this.navigate(1, preferred, 'system');
  }

  private settleStagingAttempt(error?: Error): void {
    const attempt = this.stagingAttempt;
    if (!attempt) return;
    this.stagingAttempt = null;
    attempt.cleanup();
    if (error) attempt.reject(error);
    else attempt.resolve();
  }

  private markStagedCellReady(mediaKey: string): void {
    const attempt = this.stagingAttempt;
    if (!attempt) return;
    attempt.pendingKeys.delete(mediaKey);
    if (attempt.pendingKeys.size === 0) this.settleStagingAttempt();
  }

  private failStagedCell(mediaKey: string, message: string): void {
    const item = this.staging()?.target.scene.cells.find((cell) => this.mediaIdentity(cell.item) === mediaKey)?.item;
    if (item) this.settleStagingAttempt(new ScenePreparationError(item, message));
  }

  private discardStagingAttempt(error: Error): void {
    this.settleStagingAttempt(error);
    this.staging.set(null);
  }

  private beginCrossfade(
    generation: number,
    outgoing: MediaItem,
    outgoingFitMode: FitMode,
    target: SceneCandidate,
  ): void {
    if (generation !== this.navigationGeneration) return;
    const intent = this.navigationIntent;
    this.recordNavigationVisible(generation, 'crossfade');
    const outgoingVideo = this.currentVideoElement();
    if (outgoingVideo && !outgoingVideo.paused) outgoingVideo.pause();
    const durationMs = target.manifest.settings.fadeDurationMs;
    this.crossfade.set({
      operationId: generation,
      source: intent?.source ?? 'system',
      direction: intent?.direction ?? 1,
      outgoing,
      outgoingScene: this.currentScene()!,
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
    this.crossfadeTimer = window.setTimeout(() => this.finishCrossfade(generation), durationMs);
  }

  private finishNavigationPreparation(generation: number): void {
    if (generation !== this.navigationGeneration) return;
    this.discardStagingAttempt(new NavigationCancelledError('Preparación finalizada.'));
    this.preparingTransition.set(false);
    this.navigationIntent = null;
  }

  private cancelNavigation(): void {
    this.clearDeferredNavigation('navigation-cancelled');
    this.cancelCollagePreload('navigation-cancelled');
    this.navigationGeneration += 1;
    this.discardStagingAttempt(new NavigationCancelledError('Preparación cancelada.'));
    this.preparingTransition.set(false);
    this.navigationIntent = null;
    this.clearNavigationRetry();
  }

  private scheduleNavigationRetry(direction: -1 | 1, delayMs: number): void {
    this.clearNavigationRetry();
    this.navigationRetryAt = performance.now();
    this.navigationRetryDelay = delayMs;
    this.navigationRetryTimer = window.setTimeout(() => {
      this.navigationRetryTimer = undefined;
      this.navigate(direction, undefined, 'system');
    }, delayMs);
  }

  private clearNavigationRetry(): void {
    this.navigationRetryAt = null;
    if (this.navigationRetryTimer !== undefined) {
      window.clearTimeout(this.navigationRetryTimer);
      this.navigationRetryTimer = undefined;
    }
  }

  private reportPreparationFailure(item: MediaItem, error: unknown): void {
    if (this.collageEnabled()) this.collageTrace.emit('media-failed', {
      mediaIds: [item.id], reason: 'media-preparation-failed', manifestVersion: this.manifest()?.version ?? 0,
    });
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
    this.clearDeferredNavigation('crossfade-cancelled');
    if (!this.crossfade()) return;
    this.clearCrossfadeTimer();
    this.crossfade.set(null);
  }

  protected onPhotoLoaded(image: HTMLImageElement, mediaKey: string): void {
    const attempt = this.stagingAttempt;
    if (!attempt || !attempt.pendingKeys.has(mediaKey) || !image.closest('.stage--staging')) return;
    void (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).then(
      () => {
        if (this.stagingAttempt === attempt) this.markStagedCellReady(mediaKey);
      },
      (error: unknown) => {
        if (this.stagingAttempt === attempt) {
          this.failStagedCell(mediaKey, error instanceof Error ? error.message : 'La fotografía no se pudo decodificar.');
        }
      },
    );
  }

  protected onPhotoError(mediaId: string, mediaSha256: string): void {
    const failedKey = `${mediaId}:${mediaSha256}`;
    if (this.failReadyCollagePreload(failedKey)) return;
    const attempt = this.stagingAttempt;
    if (attempt && this.staging()?.target.scene.cells.some((cell) => this.mediaIdentity(cell.item) === failedKey)) {
      this.failStagedCell(failedKey, 'La fotografía no se pudo cargar.');
      return;
    }
    const transition = this.crossfade();
    const incomingItem = transition?.target.scene.cells.find((cell) => this.mediaIdentity(cell.item) === failedKey)?.item;
    if (transition && incomingItem) {
      this.cancelCrossfade();
      this.unavailableMedia.quarantine(incomingItem);
      this.reportPreparationFailure(
        incomingItem,
        new Error('Falló la fotografía entrante.'),
      );
      this.navigate(1, undefined, 'system');
      return;
    }
    const current = this.currentScene()?.cells.find((cell) => this.mediaIdentity(cell.item) === failedKey)?.item;
    if (
      !current ||
      this.mediaIdentity(current) !== failedKey ||
      this.overlayOpen() ||
      this.reposeActive()
    )
      return;
    this.unavailableMedia.quarantine(current);
    this.reportPreparationFailure(current, new Error('Falló la fotografía visible.'));
    this.navigate(1, undefined, 'system');
  }

  protected onStagedVideoReady(video: HTMLVideoElement, mediaKey: string): void {
    const attempt = this.stagingAttempt;
    if (!attempt || !attempt.pendingKeys.has(mediaKey) || video.readyState < 2 || !video.closest('.stage--staging')) {
      return;
    }
    this.markStagedCellReady(mediaKey);
  }

  private finishCrossfade(operationId: number): void {
    const transition = this.crossfade();
    if (!transition || transition.operationId !== operationId) return;
    this.crossfadeTimer = undefined;
    this.resetPhotoTransform();
    this.manifest.set(transition.target.manifest);
    if (this.pendingManifest()?.version === transition.target.manifest.version) {
      this.pendingManifest.set(null);
    }
    this.currentIndex.set(transition.target.index);
    this.committedScene.set(transition.target.scene);
    this.startSceneLease(transition.target.item);
    this.collageCycle.commit(transition.target);
    this.collagePreloadAttemptKey = null;
    this.crossfade.set(null);
    this.videoPaused.set(false);
    this.persistPlaybackCheckpoint(true);
    // Consume before starting B's timer/playback/lookahead. Bind the request to
    // this exact committed transition, never to a later recovery or wake-up.
    const pending = this.deferredNavigation;
    this.deferredNavigation = null;
    if (pending?.operationId === transition.operationId && !this.overlayOpen() && !this.reposeActive()) {
      this.collageTrace.emit('navigation-deferred-used', { direction: pending.direction,
        operationId: transition.operationId, elapsedMs: Math.round(performance.now() - pending.requestedAt) });
      this.navigate(pending.direction, undefined, 'manual', pending.requestedAt);
      return;
    }
    this.warmCollage();
    this.scheduleCollagePreload(0);
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
      if (!video.seeking && this.noteVideoProgress(video)) {
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
    if (this.videoRecoveryAttempts < VIDEO_MAX_RECOVERY_ATTEMPTS && this.sceneLease?.takeRecovery()) {
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
    if (item) this.excludeVideo(item);
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
    this.videoRecoveryResumeAt = null;
  }

  private markVideoHealthy(mediaId: string): void {
    const item = this.currentMedia();
    if (!item || item.id !== mediaId) return;
    const key = this.videoQuarantineKey(item);
    this.videoFailureCounts.delete(key);
    this.quarantinedVideos.delete(key);
  }

  private schedulePausedVideoAdvance(mediaId: string): void {
    const newlyPaused = this.sceneLease?.snapshot(performance.now()).pauseRemainingMs === null;
    this.sceneLease?.pause(performance.now(), this.settings().photoDurationSeconds);
    if (newlyPaused) this.traceSceneBudget('pause');
    this.clearPausedVideoAdvance();
    const durationMs = this.settings().photoDurationSeconds * 1_000;
    this.scheduleCollagePreload();
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
    if (!video.seeking) this.sceneLease?.progress(video.currentTime);
    this.videoCurrentTime.set(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    this.videoDuration.set(Number.isFinite(video.duration) ? video.duration : 0);
    if (!video.paused && Number.isFinite(video.duration) && video.duration - video.currentTime <= 5 &&
      this.isCurrentStableVideo(video, this.currentMedia()?.id ?? '')) void this.preloadCollage();
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
    this.sceneLease?.restartPhoto(performance.now(), duration);
    const mediaId = media.id;
    this.scheduleCollagePreload();
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
    if (this.collagePreloadTimer !== undefined) window.clearTimeout(this.collagePreloadTimer);
    this.collagePreloadTimer = undefined;
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
    this.suspendSceneLease(false);
    if (this.sceneLease?.expired || (this.currentMedia()?.kind === 'video' && this.isVideoQuarantined(this.currentMedia()!))) {
      this.navigationFailures = Math.max(1, this.navigationFailures);
      this.videoPlaybackState.set('error');
      this.currentVideoElement()?.pause();
      this.connectionWarning.set('No hay otro medio disponible. Reintentando…');
      this.scheduleNavigationRetry(1, NAVIGATION_RETRY_DELAY_MS);
      return;
    }
    if (this.sceneRefreshId && !this.overlayOpen()) {
      const preferred = this.sceneRefreshId;
      this.sceneRefreshId = undefined;
      this.navigate(1, preferred, 'system');
      return;
    }
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
      if (manifest.settings.order !== settings.order || manifest.settings.collageMode !== settings.collageMode ||
        manifest.settings.defaultFitMode !== settings.defaultFitMode) {
        this.clearDeferredNavigation('settings-changed');
        this.cancelCollagePreload('settings-changed');
      }
      const currentId = this.currentMedia()?.id;
      const next = this.orderManifest({ ...manifest, settings });
      const regroup = manifest.settings.order !== settings.order ||
        (manifest.settings.collageMode ?? 'off') !== (settings.collageMode ?? 'off');
      if (!regroup) this.sceneCache.set(next, this.scenesFor(manifest));
      const transition = this.crossfade();
      if (!regroup && transition) {
        // A local audio/text edit during the fade must survive its commit.
        this.crossfade.set({ ...transition, target: { ...transition.target,
          manifest: { ...transition.target.manifest, settings } } });
      }
      if (regroup) {
        this.collageCycle.reset();
        const currentScene = this.currentScene();
        this.cancelNavigation();
        this.cancelCrossfade();
        this.clearVideoMonitoring();
        this.clearPausedVideoAdvance();
        this.resetPhotoTransform();
        this.committedScene.set(currentScene);
        this.sceneRefreshId = currentId;
      }
      this.manifest.set(next);
      if (currentId) {
        const index = this.scenesFor(next).findIndex((scene) => scene.cells.some((cell) => cell.item.id === currentId));
        if (index >= 0) this.currentIndex.set(index);
      }
    }
    const pending = this.pendingManifest();
    if (pending) this.pendingManifest.set(this.orderManifest({ ...pending, settings }));
  }

  private scenesFor(manifest: FrameManifest): MediaScene[] {
    if ((manifest.settings.collageMode ?? 'off') !== 'off') {
      const dynamic = this.collageCycle.lookup(manifest, window.innerWidth / window.innerHeight);
      if (dynamic) return dynamic;
    }
    let scenes = this.sceneCache.get(manifest);
    if (!scenes) {
      // UI fallback is linear singles. Full layout reconciliation belongs to worker.
      scenes = buildScenes(manifest.media, 'off',
        window.innerWidth / window.innerHeight, this.adaptiveMixSeed);
      this.sceneCache.set(manifest, scenes);
    }
    return scenes;
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
    const scene = this.committedScene();
    if (scene) this.committedScene.set({
      ...scene,
      driver: scene.driver.id === updated.id ? updated : scene.driver,
      cells: scene.cells.map((cell) => cell.item.id === updated.id ? { ...cell, item: updated } : cell),
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
      this.preparingTransition() || this.crossfade() ||
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
    this.sceneLease?.play(performance.now());
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
      !this.sceneLease?.expired &&
      current.id === mediaId &&
      video.dataset['mediaKey'] === this.mediaIdentity(current) &&
      video === this.currentVideoElement() &&
      !video.closest('.stage--staging') &&
      !this.preparingTransition() &&
      !this.crossfade() &&
      !this.overlayOpen() &&
      !this.reposeActive()
    );
  }

  private videoQuarantineKey(item: MediaItem): string {
    return `${item.id}:${item.sha256}`;
  }

  private startSceneLease(item: MediaItem): void {
    const seconds = item.kind === 'video'
      ? (Number.isFinite(item.durationSeconds) && Number(item.durationSeconds) > 0
        ? Math.min(122, Number(item.durationSeconds)) : 120)
      : this.settings().photoDurationSeconds;
    this.sceneLease = new SceneLease(`${this.runtimeSessionId}:${++this.leaseSequence}`,
      seconds, item.kind === 'video', performance.now());
    this.collageTrace.emit('scene-budget-started', { mediaIds: [item.id],
      budgetMs: seconds * 1000 + (item.kind === 'video' ? 20_000 : 1000),
      operationId: this.leaseSequence });
  }

  private traceSceneBudget(reason: string): void {
    const state = this.sceneLease?.snapshot(performance.now());
    if (state) this.collageTrace.emit('scene-budget-adjusted', { reason,
      operationId: this.leaseSequence, elapsedMs: state.elapsedMs, budgetMs: state.budgetMs });
  }

  private suspendSceneLease(suspended: boolean): void {
    const lease = this.sceneLease;
    if (!lease) return;
    const now = performance.now(), previous = lease.snapshot(now).suspended;
    lease.update(now, suspended);
    if (previous !== suspended) this.collageTrace.emit('scene-budget-suspension', {
      reason: suspended ? 'suspended' : 'resumed', operationId: this.leaseSequence,
      elapsedMs: lease.snapshot(now).elapsedMs, budgetMs: lease.snapshot(now).budgetMs });
  }

  private checkSceneLease(): void {
    const lease = this.sceneLease, item = this.currentMedia();
    if (!lease || !item) return;
    if (item.kind === 'photo' && this.activePointers.size > 0 && this.photoInteractionStartedAt !== null &&
      performance.now() - this.photoInteractionStartedAt >= 30_000) {
      this.clearViewerPointers();
      this.schedulePhotoAdvance(item, this.settings().photoDurationSeconds);
    }
    const suspended = this.reposeActive() || this.overlayOpen() || this.runtimeQuiesced() ||
      this.preparingTransition() || this.crossfade() !== null ||
      (item.kind === 'photo' && this.activePointers.size > 0);
    const now = performance.now();
    this.suspendSceneLease(suspended);
    const video = item.kind === 'video' ? this.currentVideoElement() : null;
    if (!suspended && !lease.expired && video && this.videoReachedEnd(video)) {
      this.completeVideo(item.id);
      return;
    }
    if (lease.expired || !lease.due(now)) return;
    const pauseExpired = lease.snapshot(now).pauseRemainingMs !== null;
    lease.expired = true;
    this.collageTrace.emit('scene-budget-expired', { mediaIds: [item.id],
      operationId: this.leaseSequence, elapsedMs: lease.snapshot(now).elapsedMs,
      budgetMs: lease.snapshot(now).budgetMs });
    if (item.kind === 'video' && !pauseExpired && !this.videoPaused()) {
      this.excludeVideo(item);
      if (video) this.reportPlaybackEvent('viewer.playback.skipped', video, item.id, 'scene-budget-expired');
      else this.reportPreparationFailure(item, new Error('scene-budget-expired: missing video element'));
    }
    this.navigate(1, undefined, 'system');
  }

  private excludeVideo(item: MediaItem): void {
    this.quarantinedVideos.set(this.videoQuarantineKey(item), Date.now() + VIDEO_QUARANTINE_MS);
    const entries = [...this.quarantinedVideos].filter(([, until]) => until > Date.now()).slice(-128);
    try { window.localStorage.setItem('naiskos.video-exclusions.v1', JSON.stringify(entries)); }
    catch { /* Agent protection remains available if browser storage is full. */ }
  }

  private restoreVideoExclusions(): void {
    try {
      const entries: unknown = JSON.parse(window.localStorage.getItem('naiskos.video-exclusions.v1') ?? '[]');
      if (!Array.isArray(entries)) return;
      for (const entry of entries.slice(-128)) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length <= 200 &&
          typeof entry[1] === 'number' && entry[1] > Date.now()) {
          this.quarantinedVideos.set(entry[0], Math.min(entry[1], Date.now() + VIDEO_QUARANTINE_MS));
        }
      }
    } catch { /* A malformed checkpoint must not prevent playback. */ }
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
      ...(this.sceneLease ? { lease: this.sceneLease.snapshot(performance.now()) } : {}),
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
    if (staging && !this.collagePreload) {
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
      phase: this.navigationRetryAt !== null || this.navigationFailures > 0 ? 'degraded' : 'stable',
      operationId: this.navigationRetryAt !== null ? this.navigationGeneration : null,
      candidateMediaId: null,
      candidateMediaSha256: null,
      phaseElapsedMs: this.navigationRetryAt === null ? 0 : Math.max(0, performance.now() - this.navigationRetryAt),
      deadlineMs: this.navigationRetryAt === null ? null : this.navigationRetryDelay,
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
    this.suspendSceneLease(true);
    this.collageCycle.suspend();
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
    this.suspendSceneLease(false);
    this.collageCycle.resume();
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

  protected fitModeFor(item: MediaItem, settings: FrameSettings): FitMode {
    return item.fitMode === 'inherit' ? settings.defaultFitMode : item.fitMode;
  }

  protected backgroundFor(item: MediaItem): string {
    return collageBackground(item, this.collageEnabled() &&
      (this.settings().collageBackground ?? DEFAULT_FRAME_SETTINGS.collageBackground) === 'material');
  }
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
