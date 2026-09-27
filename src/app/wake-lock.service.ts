import { Injectable, signal } from '@angular/core';
import { NOSLEEP_MP4 } from './nosleep-video';

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(t: string, f: () => void): void };

/**
 * Keeps the screen on while the viewer is open.
 * Uses the Screen Wake Lock API where available (Chrome, Safari 16.4+),
 * and falls back to a looping invisible video (the NoSleep.js trick) elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  readonly active = signal(false);
  readonly method = signal<'wakelock' | 'video' | 'none'>('none');

  private sentinel: WakeLockSentinelLike | null = null;
  private video: HTMLVideoElement | null = null;
  private wanted = false;
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.wanted) this.acquire();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Must be called from a user gesture the first time (for the video fallback). */
  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        /* ignore */
      }
      this.sentinel = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }
    this.active.set(false);
    this.method.set('none');
  }

  private async acquire(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
    if (nav.wakeLock) {
      try {
        this.sentinel = await nav.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => {
          this.sentinel = null;
          if (!this.wanted) return;
          this.active.set(false);
        });
        this.active.set(true);
        this.method.set('wakelock');
        return;
      } catch {
        /* fall through to the video trick */
      }
    }
    this.startVideo();
  }

  private startVideo(): void {
    if (!this.video) {
      const v = document.createElement('video');
      v.setAttribute('playsinline', '');
      v.setAttribute('muted', '');
      v.muted = true;
      v.loop = true;
      v.src = NOSLEEP_MP4;
      v.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0.01;pointer-events:none;';
      document.body.appendChild(v);
      this.video = v;
    }
    this.video
      .play()
      .then(() => {
        this.active.set(true);
        this.method.set('video');
      })
      .catch(() => {
        this.active.set(false);
        this.method.set('none');
      });
  }
}
