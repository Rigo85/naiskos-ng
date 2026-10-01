import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotoReserve } from './photo-reserve';
import { MediaItem } from './models';

const photo = (id: string, width = 1280, height = 800) => ({
  id, kind: 'photo', width, height, sha256: id, url: `/photo/${id}`,
} as MediaItem);
class FakeImage {
  src = ''; decoding = ''; naturalWidth = 1280; naturalHeight = 800;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  decode = vi.fn(async () => {});
  removeAttribute() { this.src = ''; }
}
function setup() {
  const images: FakeImage[] = [];
  return { images, reserve: new PhotoReserve(() => {
    const image = new FakeImage(); images.push(image); return image as unknown as HTMLImageElement;
  }) };
}
afterEach(() => vi.useRealTimers());
describe('bounded auxiliary scene', () => {
  it('retains decoded photos and avoids duplicating the same load', async () => {
    const { reserve, images } = setup(); const items = [photo('a'), photo('b')];
    const job = reserve.prepare(items);
    expect(await reserve.prepare(items)).toBe('unchanged');
    images.forEach((i) => i.onload!()); expect(await job).toBe('ready');
    expect(reserve.has(items)).toBe(true); expect(images).toHaveLength(2);
    reserve.clear(); expect(images.every((i) => i.src === '')).toBe(true);
  });
  it('caps count and estimated decoded bytes before loading', async () => {
    const { reserve, images } = setup();
    expect(await reserve.prepare([photo('huge', 8000, 8000)])).toBe('budget');
    expect(await reserve.prepare(Array.from({ length: 5 }, (_, i) => photo(`${i}`)))).toBe('budget');
    expect(images).toHaveLength(0);
  });
  it('rechecks actual dimensions instead of trusting metadata', async () => {
    const { reserve, images } = setup(); const job = reserve.prepare([photo('a')]);
    images[0].naturalWidth = 8000; images[0].naturalHeight = 8000; images[0].onload!();
    expect(await job).toBe('budget'); expect(images[0].src).toBe('');
  });
  it('cancellation and late decode cannot complete a newer reservation', async () => {
    const { reserve, images } = setup(); let resolve!: () => void;
    const old = reserve.prepare([photo('old')]);
    images[0].decode.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    images[0].onload!(); const fresh = reserve.prepare([photo('new')]);
    expect(await old).toBe('cancelled'); resolve(); await Promise.resolve();
    expect(reserve.has([photo('new')])).toBe(false);
    images[1].onload!(); expect(await fresh).toBe('ready');
    reserve.clear();
  });
  it('has a finite deadline and backoff; videos load only posters', async () => {
    vi.useFakeTimers(); const { reserve, images } = setup(); const items = [photo('a')];
    const job = reserve.prepare(items); await vi.advanceTimersByTimeAsync(5_000);
    expect(await job).toBe('failed'); expect(await reserve.prepare(items)).toBe('unchanged');
    const video = { ...photo('v'), kind: 'video' as const, url: '/video.mp4', posterUrl: '/poster.jpg' };
    const poster = reserve.prepare([video]); expect(images[1].src).toBe('/poster.jpg');
    images[1].onload!(); expect(await poster).toBe('poster-only'); reserve.clear();
  });
});
