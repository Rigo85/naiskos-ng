import { FrameManifest, MediaItem } from './models';

export function collageBackground(item: MediaItem, enabled: boolean): string {
  const colors = item.bandColors;
  return enabled && Array.isArray(colors) && colors.length === 2 &&
    colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    ? `linear-gradient(180deg, ${colors[0]}, ${colors[1]})` : '#000';
}

/** A palette-only publication is not a navigation/recovery event. */
export function samePlaybackContent(a: FrameManifest, b: FrameManifest): boolean {
  if (a.frameId !== b.frameId || a.settingsRevision !== b.settingsRevision ||
    JSON.stringify(a.settings) !== JSON.stringify(b.settings) || a.media.length !== b.media.length) return false;
  return a.media.every((item, index) => {
    const { bandColors: _a, ...left } = item;
    const { bandColors: _b, ...right } = b.media[index];
    return JSON.stringify(left) === JSON.stringify(right);
  });
}
