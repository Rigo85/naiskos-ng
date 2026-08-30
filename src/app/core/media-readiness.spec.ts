import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaReadiness } from './media-readiness';
import { MediaItem } from './models';

const photo: MediaItem = {
  id: 'photo-ready',
  kind: 'photo',
  url: '/media/photo-ready.webp',
  posterUrl: null,
  caption: null,
  senderName: null,
  receivedAt: '2026-08-17T00:00:00.000Z',
  fitMode: 'inherit',
  rotationDegrees: 0,
  durationSeconds: null,
  sha256: 'abc',
  sizeBytes: 1,
  posterSizeBytes: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('MediaReadiness', () => {
  it('espera la decodificación de una fotografía antes de declararla lista', async () => {
    const decode = vi.fn(() => Promise.resolve());
    class ReadyImage {
      decoding = 'auto';
      src = '';
      decode = decode;
    }
    vi.stubGlobal('Image', ReadyImage);

    await new MediaReadiness().prepare(photo);

    expect(decode).toHaveBeenCalledOnce();
  });
});
