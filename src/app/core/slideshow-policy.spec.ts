import { DEFAULT_FRAME_SETTINGS, FrameManifest, MediaItem } from './models';
import { activatePendingManifest, adjacentIndex, orderManifestMedia } from './slideshow-policy';

function item(id: string): MediaItem {
  return {
    id,
    kind: 'photo',
    url: `/media/${id}`,
    posterUrl: null,
    caption: null,
    senderName: null,
    receivedAt: '2026-08-08T00:00:00.000Z',
    fitMode: 'inherit',
    rotationDegrees: 0,
    durationSeconds: null,
    sha256: id,
    sizeBytes: 1,
    posterSizeBytes: null,
  };
}

function manifest(version: number, ids: string[]): FrameManifest {
  return {
    schemaVersion: 1,
    frameId: 'frame-1',
    version,
    publishedAt: '2026-08-08T00:00:00.000Z',
    settingsRevision: 0,
    settings: DEFAULT_FRAME_SETTINGS,
    media: ids.map(item),
  };
}

describe('slideshow policy', () => {
  it('wraps navigation at both ends', () => {
    expect(adjacentIndex(3, 2, 1)).toBe(0);
    expect(adjacentIndex(3, 0, -1)).toBe(2);
  });

  it('ordena únicamente por llegada al manifiesto y mantiene aleatorio estable', () => {
    const older = { ...item('older'), receivedAt: '2026-08-01T00:00:00.000Z' };
    const newer = { ...item('newer'), receivedAt: '2026-08-02T00:00:00.000Z' };

    expect(orderManifestMedia([older, newer], 'newest', 1).map((entry) => entry.id)).toEqual([
      'newer',
      'older',
    ]);
    expect(orderManifestMedia([older, newer], 'oldest', 1).map((entry) => entry.id)).toEqual([
      'older',
      'newer',
    ]);
    expect(orderManifestMedia([older, newer], 'shuffle', 7)).toEqual(
      orderManifestMedia([older, newer], 'shuffle', 7),
    );
  });

  it('shows newly synchronized media on the next natural transition', () => {
    const result = activatePendingManifest(
      manifest(1, ['old-b', 'old-a']),
      manifest(2, ['new-c', 'old-b', 'old-a']),
      'old-b',
      1,
    );
    expect(result).toEqual({ index: 0, showsNewMedia: true });
  });

  it('preserves normal navigation when an update adds no media', () => {
    const result = activatePendingManifest(
      manifest(1, ['b', 'a']),
      manifest(2, ['b', 'a']),
      'b',
      1,
    );
    expect(result).toEqual({ index: 1, showsNewMedia: false });
  });
});
