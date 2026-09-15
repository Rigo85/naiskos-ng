import { FrameManifest, MediaItem } from './models';
import { activatePendingManifest, adjacentIndex } from './slideshow-policy';

export interface NavigationCandidate {
  manifest: FrameManifest;
  index: number;
  item: MediaItem;
}

export interface NavigationPlanInput {
  active: FrameManifest;
  pending: FrameManifest | null;
  currentIndex: number;
  currentMediaId: string | null;
  direction: -1 | 1;
  preferredMediaId?: string;
}

/**
 * Produces a finite, duplicate-free snapshot of a navigation request. The
 * caller may safely await between candidates without allowing a newer
 * manifest to alter the operation that is already in flight.
 */
export function navigationPlan(input: NavigationPlanInput): NavigationCandidate[] {
  const manifest = input.pending ?? input.active;
  if (manifest.media.length === 0) return [];

  let firstIndex: number;
  if (input.preferredMediaId) {
    const preferred = manifest.media.findIndex((item) => item.id === input.preferredMediaId);
    firstIndex = preferred >= 0 ? preferred : 0;
  } else if (input.pending) {
    firstIndex = activatePendingManifest(
      input.active,
      input.pending,
      input.currentMediaId,
      input.direction,
    ).index;
  } else {
    firstIndex = adjacentIndex(manifest.media.length, input.currentIndex, input.direction);
  }

  const result: NavigationCandidate[] = [];
  const visited = new Set<string>();
  let index = firstIndex;
  for (let offset = 0; offset < manifest.media.length; offset += 1) {
    const item = manifest.media[index];
    const identity = `${item.id}:${item.sha256}`;
    if (!visited.has(identity)) {
      visited.add(identity);
      result.push({ manifest, index, item });
    }
    index = adjacentIndex(manifest.media.length, index, input.direction);
  }
  return result;
}

export class MediaFailureRegistry {
  private readonly entries = new Map<string, number>();

  constructor(private readonly quarantineMs: number) {}

  key(item: MediaItem): string {
    return `${item.id}:${item.sha256}`;
  }

  quarantine(item: MediaItem, now = Date.now()): void {
    this.entries.set(this.key(item), now + this.quarantineMs);
  }

  clear(item: MediaItem): void {
    this.entries.delete(this.key(item));
  }

  contains(item: MediaItem, now = Date.now()): boolean {
    const key = this.key(item);
    const until = this.entries.get(key);
    if (until === undefined) return false;
    if (until > now) return true;
    this.entries.delete(key);
    return false;
  }
}
