import { Component, computed, effect, inject, signal } from '@angular/core';
import { SettingsPanel } from './settings-panel/settings-panel';
import { Viewer } from './viewer/viewer';
import { StorageService } from './storage.service';
import { WakeLockService } from './wake-lock.service';
import { Settings } from './models';

@Component({
  selector: 'app-root',
  imports: [SettingsPanel, Viewer],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly storage = inject(StorageService);
  private readonly wake = inject(WakeLockService);

  readonly settings = signal<Settings>(this.storage.loadSettings());
  readonly imageUrl = signal<string | null>(null);
  readonly imageSize = signal<{ w: number; h: number } | null>(null);
  readonly imageName = signal('');
  readonly imageAspect = computed(() => {
    const s = this.imageSize();
    return s ? s.w / s.h : null;
  });

  readonly viewing = signal(false);
  readonly drawer = signal(false);
  readonly restoring = signal(true);

  private blob: Blob | null = null;

  constructor() {
    effect(() => this.storage.saveSettings(this.settings()));
    this.storage.loadImage().then((b) => {
      if (b) this.setImage(b, 'Saved photo');
      this.restoring.set(false);
    });
  }

  async onFile(f: File): Promise<void> {
    await this.setImage(f, f.name);
    this.storage.saveImage(f);
  }

  private setImage(b: Blob, name: string): Promise<void> {
    if (this.imageUrl()) URL.revokeObjectURL(this.imageUrl()!);
    this.blob = b;
    const url = URL.createObjectURL(b);
    this.imageUrl.set(url);
    this.imageName.set(name);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.imageSize.set({ w: img.naturalWidth, h: img.naturalHeight });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  removeImage(): void {
    if (this.imageUrl()) URL.revokeObjectURL(this.imageUrl()!);
    this.blob = null;
    this.imageUrl.set(null);
    this.imageSize.set(null);
    this.imageName.set('');
    this.storage.clearImage();
  }

  start(): void {
    if (!this.imageUrl()) return;
    this.viewing.set(true);
    this.drawer.set(false);
    // called from a tap, so the video fallback is allowed to play
    this.wake.enable();
  }

  stop(): void {
    this.viewing.set(false);
    this.drawer.set(false);
    this.wake.disable();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  /** Render photo + grid at full resolution and download as PNG. */
  async exportPng(): Promise<void> {
    const url = this.imageUrl();
    const size = this.imageSize();
    if (!url || !size) return;
    const s = this.settings();
    const img = new Image();
    img.src = url;
    await img.decode();

    // Output canvas has the drawing canvas's aspect ratio, sized from the photo.
    const a = s.canvasW / s.canvasH;
    let outW: number;
    let outH: number;
    if (s.fit === 'cover') {
      // as many photo pixels as fit inside the canvas aspect
      if (size.w / size.h > a) {
        outH = size.h;
        outW = Math.round(size.h * a);
      } else {
        outW = size.w;
        outH = Math.round(size.w / a);
      }
    } else {
      if (size.w / size.h > a) {
        outW = size.w;
        outH = Math.round(size.w / a);
      } else {
        outH = size.h;
        outW = Math.round(size.h * a);
      }
    }
    const cv = document.createElement('canvas');
    cv.width = outW;
    cv.height = outH;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, outW, outH);

    // draw photo (cover/contain), with mirroring and grayscale
    const scale = s.fit === 'cover' ? Math.max(outW / size.w, outH / size.h) : Math.min(outW / size.w, outH / size.h);
    const dw = size.w * scale;
    const dh = size.h * scale;
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    if (s.grayscale) ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    // grid — line widths scaled so they look like they do on screen at ~1000px wide
    const px = outW / 1000;
    const cellW = outW / s.cols;
    const cellH = outH / s.rows;
    if (s.subEnabled) {
      ctx.strokeStyle = s.subColor;
      ctx.lineWidth = Math.max(1, s.subWidth * px);
      ctx.beginPath();
      for (let i = 1; i < s.cols * s.subFactor; i++) {
        if (i % s.subFactor === 0) continue;
        const x = (i * cellW) / s.subFactor;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, outH);
      }
      for (let i = 1; i < s.rows * s.subFactor; i++) {
        if (i % s.subFactor === 0) continue;
        const y = (i * cellH) / s.subFactor;
        ctx.moveTo(0, y);
        ctx.lineTo(outW, y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = s.mainColor;
    if (s.diagonals) {
      ctx.lineWidth = Math.max(1, s.mainWidth * 0.6 * px);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          ctx.moveTo(c * cellW, r * cellH);
          ctx.lineTo((c + 1) * cellW, (r + 1) * cellH);
          ctx.moveTo((c + 1) * cellW, r * cellH);
          ctx.lineTo(c * cellW, (r + 1) * cellH);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = Math.max(1, s.mainWidth * px);
    ctx.beginPath();
    for (let i = 1; i < s.cols; i++) {
      ctx.moveTo(i * cellW, 0);
      ctx.lineTo(i * cellW, outH);
    }
    for (let i = 1; i < s.rows; i++) {
      ctx.moveTo(0, i * cellH);
      ctx.lineTo(outW, i * cellH);
    }
    ctx.stroke();
    ctx.strokeRect(0, 0, outW, outH);

    if (s.showLabels) {
      ctx.font = `${Math.round(18 * px)}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const label = `${String.fromCharCode(65 + (c % 26))}${r + 1}`;
          const tw = ctx.measureText(label).width;
          const x = c * cellW + 6 * px;
          const y = r * cellH + 6 * px;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x - 3 * px, y - 2 * px, tw + 6 * px, 22 * px);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, x, y);
        }
      }
    }

    const blob: Blob | null = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return;
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(blob);
    a2.download = `grid-${s.cols}x${s.rows}-${s.canvasW}x${s.canvasH}${s.unit}.png`;
    document.body.appendChild(a2);
    a2.click();
    setTimeout(() => {
      URL.revokeObjectURL(a2.href);
      a2.remove();
    }, 1000);
  }
}
