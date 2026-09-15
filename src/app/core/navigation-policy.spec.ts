import { describe, expect, it } from 'vitest';

import { DEFAULT_FRAME_SETTINGS, FrameManifest, MediaItem } from './models';
import { MediaFailureRegistry, navigationPlan } from './navigation-policy';

function item(id: string, sha256 = id): MediaItem {
  return {
    id,
    kind: 'photo',
    url: `/media/${sha256}.webp`,
    posterUrl: null,
    caption: null,
    senderName: null,
    receivedAt: '2026-09-15T00:00:00.000Z',
    fitMode: 'inherit',
    rotationDegrees: 0,
    durationSeconds: null,
    sha256,
    sizeBytes: 1,
    posterSizeBytes: null,
  };
}

function manifest(version: number, ids: string[]): FrameManifest {
  return {
    schemaVersion: 1,
    frameId: 'frame-1',
    version,
    publishedAt: '2026-09-15T00:00:00.000Z',
    settingsRevision: 1,
    settings: DEFAULT_FRAME_SETTINGS,
    media: ids.map((id) => item(id)),
  };
}

describe('navigation policy', () => {
  it('recorre una instantanea completa una sola vez y en ambas direcciones', () => {
    const active = manifest(1, ['a', 'b', 'c']);
    expect(
      navigationPlan({
        active,
        pending: null,
        currentIndex: 0,
        currentMediaId: 'a',
        direction: 1,
      }).map(({ item }) => item.id),
    ).toEqual(['b', 'c', 'a']);
    expect(
      navigationPlan({
        active,
        pending: null,
        currentIndex: 0,
        currentMediaId: 'a',
        direction: -1,
      }).map(({ item }) => item.id),
    ).toEqual(['c', 'b', 'a']);
  });

  it('prioriza una seleccion explicita y continua desde ella', () => {
    const active = manifest(1, ['a', 'b', 'c']);
    expect(
      navigationPlan({
        active,
        pending: null,
        currentIndex: 0,
        currentMediaId: 'a',
        direction: 1,
        preferredMediaId: 'c',
      }).map(({ item }) => item.id),
    ).toEqual(['c', 'a', 'b']);
  });

  it('congela el manifiesto pendiente que corresponde a la operacion', () => {
    const active = manifest(1, ['a', 'b']);
    const pending = manifest(2, ['new', 'a', 'b']);
    const plan = navigationPlan({
      active,
      pending,
      currentIndex: 0,
      currentMediaId: 'a',
      direction: 1,
    });
    expect(plan.map(({ item }) => item.id)).toEqual(['new', 'a', 'b']);
    expect(plan.every(({ manifest: snapshot }) => snapshot === pending)).toBe(true);
  });

  it('expira por hash y no mantiene apartada una variante nueva', () => {
    const registry = new MediaFailureRegistry(1_000);
    const first = item('a', 'old');
    const replacement = item('a', 'new');
    registry.quarantine(first, 10_000);
    expect(registry.contains(first, 10_999)).toBe(true);
    expect(registry.contains(replacement, 10_999)).toBe(false);
    expect(registry.contains(first, 11_001)).toBe(false);
  });
});
