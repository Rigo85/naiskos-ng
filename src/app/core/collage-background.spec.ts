import { describe, expect, it } from 'vitest';
import { collageBackground, samePlaybackContent } from './collage-background';
import { DEFAULT_FRAME_SETTINGS, FrameManifest, MediaItem } from './models';
import { orderManifestMedia } from './slideshow-policy';

describe('fondos decorativos', () => {
  it('valida colores y no acepta CSS ni recursos externos', () => {
    for (const colors of [null, undefined, ['red', 'blue'], ['#123456', 'url(https://invalid)']]) {
      expect(collageBackground({ bandColors: colors } as MediaItem, true)).toBe('#000');
    }
    const item = { bandColors: ['#123456', '#abcdef'] } as MediaItem;
    expect(collageBackground(item, false)).toBe('#000');
    expect(collageBackground(item, true)).toBe('linear-gradient(180deg, #123456, #abcdef)');
  });
  it('no cambia aleatorio ni identidad de reproducción por una publicación de colores', () => {
    const media = Array.from({ length: 30 }, (_, index) => ({ id: String(index), sha256: String(index) } as MediaItem));
    const a: FrameManifest = { schemaVersion: 1, frameId: 'f', version: 1, publishedAt: '', settingsRevision: 0,
      settings: DEFAULT_FRAME_SETTINGS, media: orderManifestMedia(media, 'shuffle', 1) };
    const b: FrameManifest = { ...a, version: 33, publishedAt: 'later',
      media: orderManifestMedia(media.map((item) => ({ ...item, bandColors: ['#112233', '#445566'] as [string, string] })), 'shuffle', 33) };
    expect(b.media.map((i) => i.id)).toEqual(a.media.map((i) => i.id));
    expect(samePlaybackContent(a, b)).toBe(true);
    expect(samePlaybackContent(a, { ...b, media: b.media.slice(1) })).toBe(false);
    expect(samePlaybackContent(a, { ...b, settings: { ...b.settings, showCaption: false } })).toBe(false);
  });
});
