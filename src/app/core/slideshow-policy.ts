import { DisplayOrder, FrameManifest, MediaItem } from './models';

export function orderManifestMedia(
  media: MediaItem[],
  order: DisplayOrder,
  version: number,
): MediaItem[] {
  const result = [...media];
  const timestamp = (item: MediaItem) => {
    const time = new Date(item.receivedAt).getTime();
    return Number.isFinite(time) ? time : 0;
  };
  if (order === 'oldest') {
    return result.sort((left, right) => timestamp(left) - timestamp(right));
  }
  if (order === 'shuffle') {
    return result.sort(
      (left, right) => stableRank(left.id, version) - stableRank(right.id, version),
    );
  }
  return result.sort((left, right) => timestamp(right) - timestamp(left));
}

function stableRank(id: string, version: number): number {
  let hash = version | 0;
  for (const character of id) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
  }
  return hash >>> 0;
}

export function adjacentIndex(length: number, current: number, direction: -1 | 1): number {
  if (length <= 0) {
    return 0;
  }
  return (current + direction + length) % length;
}

export function activatePendingManifest(
  active: FrameManifest,
  pending: FrameManifest,
  currentMediaId: string | null,
  direction: -1 | 1,
): { index: number; showsNewMedia: boolean } {
  if (pending.media.length === 0) {
    return { index: 0, showsNewMedia: false };
  }

  const activeIds = new Set(active.media.map((item) => item.id));
  const firstNewIndex = pending.media.findIndex((item) => !activeIds.has(item.id));
  if (direction === 1 && firstNewIndex >= 0) {
    return { index: firstNewIndex, showsNewMedia: true };
  }

  const preservedIndex = pending.media.findIndex((item) => item.id === currentMediaId);
  if (preservedIndex < 0) {
    return { index: direction === 1 ? 0 : pending.media.length - 1, showsNewMedia: false };
  }
  return {
    index: adjacentIndex(pending.media.length, preservedIndex, direction),
    showsNewMedia: false,
  };
}
