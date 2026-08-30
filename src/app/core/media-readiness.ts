import { Injectable } from '@angular/core';

import { MediaItem } from './models';

const PREPARATION_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class MediaReadiness {
  async prepare(item: MediaItem): Promise<void> {
    if (item.kind === 'photo') {
      await this.prepareImage(item.url);
      return;
    }
    if (item.posterUrl) {
      await this.prepareImage(item.posterUrl);
      return;
    }
    await this.prepareVideo(item.url);
  }

  private async prepareImage(url: string): Promise<void> {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await withTimeout(
      typeof image.decode === 'function' ? image.decode() : waitForImage(image),
      PREPARATION_TIMEOUT_MS,
      `No se pudo preparar la imagen ${url}`,
    );
  }

  private async prepareVideo(url: string): Promise<void> {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error(`No se pudo preparar ${url}`)), {
            once: true,
          });
          video.load();
        }),
        PREPARATION_TIMEOUT_MS,
        `No se pudo preparar el video ${url}`,
      );
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('No se pudo cargar la imagen')), {
      once: true,
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }
  }
}
