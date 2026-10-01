import { MediaItem } from './models';

export const PHOTO_RESERVE_BYTES = 32 * 1024 * 1024;
/** One auxiliary scene, not a library cache. Keeps decoded image handles only.
 * Videos contribute a poster, never a third decoder. DOM staging still validates
 * readiness: Chromium is allowed to evict its own decoded/GPU caches. */
export class PhotoReserve {
  private images: HTMLImageElement[] = [];
  private abort: (() => void) | null = null;
  private key = '';
  private ready = false;
  private generation = 0;
  private retryAt = 0;

  constructor(private readonly createImage = () => new Image()) {}

  private identity(items: MediaItem[]): string {
    return JSON.stringify(items.map((m) => [m.id, m.sha256, m.kind === 'video' ? m.posterUrl : m.url]));
  }

  has(items: MediaItem[]): boolean { return this.ready && this.key === this.identity(items); }

  async prepare(items: MediaItem[]): Promise<'ready' | 'poster-only' | 'budget' | 'failed' | 'cancelled' | 'unchanged'> {
    const key = this.identity(items);
    if (this.key === key && (this.ready || this.abort || Date.now() < this.retryAt)) return 'unchanged';
    this.clear(); this.key = key;
    if (!items.length || items.length > 4 || items.some((m) => !m.width || !m.height ||
      m.width <= 0 || m.height <= 0 || m.kind === 'video' && !m.posterUrl) ||
      items.reduce((bytes, m) => bytes + m.width! * m.height! * 4, 0) > PHOTO_RESERVE_BYTES) {
      this.retryAt = Date.now() + 30_000; return 'budget';
    }
    const generation = this.generation;
    return new Promise((resolve) => {
      let remaining = items.length, bytes = 0, settled = false;
      const finish = (result: 'ready' | 'poster-only' | 'budget' | 'failed' | 'cancelled') => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.images.forEach((image) => { image.onload = null; image.onerror = null; });
        if (generation === this.generation) {
          this.abort = null;
          this.ready = result === 'ready' || result === 'poster-only';
          if (!this.ready) { this.releaseImages(); this.retryAt = Date.now() + 5_000; }
        }
        resolve(result);
      };
      const timer = setTimeout(() => finish('failed'), 5_000);
      this.abort = () => finish('cancelled');
      this.images = items.map((item) => {
        const image = this.createImage();
        image.decoding = 'async';
        image.onload = () => {
          void image.decode().then(() => {
            if (settled || generation !== this.generation) return;
            bytes += image.naturalWidth * image.naturalHeight * 4;
            if (bytes > PHOTO_RESERVE_BYTES) { finish('budget'); return; }
            if (--remaining === 0) finish(items.some((m) => m.kind === 'video') ? 'poster-only' : 'ready');
          }, () => finish('failed'));
        };
        image.onerror = () => finish('failed');
        image.src = item.kind === 'video' ? item.posterUrl! : item.url;
        return image;
      });
    });
  }

  clear(): void {
    this.abort?.(); this.abort = null; this.generation++;
    this.releaseImages(); this.key = ''; this.ready = false; this.retryAt = 0;
  }
  private releaseImages(): void {
    for (const image of this.images) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
    this.images = [];
  }
}
