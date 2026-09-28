import { Component, HostListener, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { fmt, layoutOf, Settings } from '../models';
import { WakeLockService } from '../wake-lock.service';

interface Pt {
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Cell extends Rect {
  r: number;
  c: number;
  label: string;
}

const MAX_ZOOM = 24;
const FOCUS_PAD = 24; // px of breathing room around a focused cell

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.html',
  styleUrl: './viewer.css',
})
export class Viewer {
  /** two-way: the viewer writes the crop back into the settings */
  readonly settings = model.required<Settings>();
  readonly imageUrl = input.required<string>();
  readonly imageSize = input<{ w: number; h: number } | null>(null);

  readonly openSettings = output<void>();
  readonly close = output<void>();

  readonly wake = inject(WakeLockService);
  readonly fmt = fmt;
  readonly Math = Math;

  // ---- viewport / stage geometry -------------------------------------------------
  readonly vw = signal(window.innerWidth);
  readonly vh = signal(window.innerHeight);

  readonly layout = computed(() => layoutOf(this.settings()));
  readonly hasMargins = computed(() => {
    const s = this.settings();
    return s.marginTop + s.marginRight + s.marginBottom + s.marginLeft > 0;
  });
  readonly marginsShown = computed(() => this.settings().showMargins && this.hasMargins());

  /** The displayed frame (whole canvas, or just the picture area), in screen px, letterboxed into the viewport. */
  readonly stage = computed<Rect>(() => {
    const s = this.settings();
    const l = this.layout();
    const W = this.vw();
    const H = this.vh();
    const a = this.marginsShown() ? s.canvasW / s.canvasH : l.picW / l.picH;
    let w = W;
    let h = W / a;
    if (h > H) {
      h = H;
      w = H * a;
    }
    return { w, h, x: (W - w) / 2, y: (H - h) / 2 };
  });

  /** The picture area inside the stage, relative to the stage, in px. */
  readonly pic = computed<Rect>(() => {
    const st = this.stage();
    if (!this.marginsShown()) return { x: 0, y: 0, w: st.w, h: st.h };
    const s = this.settings();
    const l = this.layout();
    const kx = st.w / s.canvasW;
    const ky = st.h / s.canvasH;
    return { x: l.x * kx, y: l.y * ky, w: l.picW * kx, h: l.picH * ky };
  });

  // ---- zoom / pan of the whole view ---------------------------------------------------
  readonly scale = signal(1);
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly transform = computed(() => `translate(${this.tx()}px, ${this.ty()}px) scale(${this.scale()})`);

  // ---- ui state --------------------------------------------------------------------
  readonly chrome = signal(true);
  readonly mode = signal<'view' | 'crop'>('view');
  readonly focusMode = signal(false);
  readonly selected = signal<{ r: number; c: number } | null>(null);
  readonly isFullscreen = signal(!!document.fullscreenElement);
  readonly isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  readonly toast = signal('');

  // ---- derived grid data (in picture units) -----------------------------------------
  readonly mainV = computed(() => this.range(1, this.settings().cols).map((i) => i * this.layout().cellW));
  readonly mainH = computed(() => this.range(1, this.settings().rows).map((i) => i * this.layout().cellH));
  readonly subV = computed(() => {
    const s = this.settings();
    if (!s.subEnabled) return [];
    return this.range(1, s.cols * s.subFactor)
      .filter((i) => i % s.subFactor !== 0)
      .map((i) => i * this.layout().subW);
  });
  readonly subH = computed(() => {
    const s = this.settings();
    if (!s.subEnabled) return [];
    return this.range(1, s.rows * s.subFactor)
      .filter((i) => i % s.subFactor !== 0)
      .map((i) => i * this.layout().subH);
  });
  readonly cells = computed<Cell[]>(() => {
    const s = this.settings();
    const l = this.layout();
    const out: Cell[] = [];
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        out.push({ r, c, x: c * l.cellW, y: r * l.cellH, w: l.cellW, h: l.cellH, label: `${this.colName(c)}${r + 1}` });
      }
    }
    return out;
  });
  readonly selectedCell = computed(() => {
    const sel = this.selected();
    if (!sel) return null;
    return this.cells().find((k) => k.r === sel.r && k.c === sel.c) ?? null;
  });
  /** Sub-lines drawn only inside the focused cell when the global subdivision is off. */
  readonly focusSubV = computed(() => {
    const s = this.settings();
    const sel = this.selectedCell();
    if (!sel || s.subEnabled) return [];
    return this.range(1, s.subFactor).map((i) => sel.x + (i * sel.w) / s.subFactor);
  });
  readonly focusSubH = computed(() => {
    const s = this.settings();
    const sel = this.selectedCell();
    if (!sel || s.subEnabled) return [];
    return this.range(1, s.subFactor).map((i) => sel.y + (i * sel.h) / s.subFactor);
  });
  readonly flipTransform = computed(() => {
    const s = this.settings();
    return `scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})`;
  });
  readonly cropTransform = computed(() => {
    const s = this.settings();
    return `translate(${s.cropX * 100}%, ${s.cropY * 100}%) scale(${s.cropScale})`;
  });

  private pointers = new Map<number, Pt>();
  private gesture: { dist: number; mid: Pt; scale: number; tx: number; ty: number; crop: number } | null = null;
  private down: { pt: Pt; t: number; moved: boolean } | null = null;
  private lastTap = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      // drop the selection when the grid shape changes underneath it
      const s = this.settings();
      const sel = this.selected();
      if (sel && (sel.r >= s.rows || sel.c >= s.cols)) this.exitFocus();
    });
    effect(() => {
      // re-fit on resize / rotation
      this.stage();
      const sel = this.selectedCell();
      if (sel) this.zoomToCell(sel);
      else this.clampView();
    });
  }

  // ---- window events ----------------------------------------------------------------
  @HostListener('window:resize')
  onResize(): void {
    this.vw.set(window.innerWidth);
    this.vh.set(window.innerHeight);
  }

  @HostListener('document:fullscreenchange')
  onFsChange(): void {
    this.isFullscreen.set(!!document.fullscreenElement);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      if (this.selected()) this.exitFocus();
      else this.close.emit();
    }
    if (ev.key === ' ') {
      ev.preventDefault();
      this.chrome.update((v) => !v);
    }
    if (this.selected()) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') this.stepCell(1);
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') this.stepCell(-1);
    }
  }

  // ---- actions -----------------------------------------------------------------------
  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions).catch(() => this.fullscreenHint());
    } else {
      this.fullscreenHint();
    }
  }

  private fullscreenHint(): void {
    this.showToast(
      this.isStandalone
        ? 'Already running full screen.'
        : 'iPhone: tap Share → “Add to Home Screen”, then open it from there for true full screen.',
      5000,
    );
  }

  toggleCrop(): void {
    if (this.selected()) this.exitFocus();
    const on = this.mode() === 'view';
    this.mode.set(on ? 'crop' : 'view');
    if (on) {
      this.resetZoom();
      this.showToast('Crop: pinch to zoom and drag to move the photo under the grid. Double-tap resets.');
    }
  }

  toggleFocus(): void {
    if (this.selected() || this.focusMode()) {
      this.exitFocus();
      return;
    }
    this.mode.set('view');
    this.focusMode.set(true);
    this.showToast('Tap a cell to fill the screen with it.');
  }

  exitFocus(): void {
    this.focusMode.set(false);
    this.selected.set(null);
    this.resetZoom();
  }

  stepCell(delta: number): void {
    const sel = this.selected();
    const s = this.settings();
    const n = s.rows * s.cols;
    const idx = sel ? sel.r * s.cols + sel.c : 0;
    const next = (idx + delta + n) % n;
    this.select({ r: Math.floor(next / s.cols), c: next % s.cols });
  }

  private select(cell: { r: number; c: number }): void {
    this.selected.set(cell);
    const full = this.selectedCell();
    if (full) this.zoomToCell(full);
  }

  resetZoom(): void {
    this.scale.set(1);
    this.tx.set(0);
    this.ty.set(0);
  }

  resetCrop(): void {
    this.settings.update((s) => ({ ...s, cropScale: 1, cropX: 0, cropY: 0 }));
  }

  showToast(msg: string, ms = 2600): void {
    this.toast.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), ms);
  }

  // ---- pointer handling (tap, pan, pinch) -----------------------------------------------
  onPointerDown(ev: PointerEvent): void {
    if ((ev.target as HTMLElement).closest('.chrome')) return;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 1) {
      this.down = { pt: { x: ev.clientX, y: ev.clientY }, t: Date.now(), moved: false };
      this.gesture = null;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        scale: this.scale(),
        tx: this.tx(),
        ty: this.ty(),
        crop: this.settings().cropScale,
      };
      if (this.down) this.down.moved = true;
    }
  }

  onPointerMove(ev: PointerEvent): void {
    const prev = this.pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    this.pointers.set(ev.pointerId, cur);
    const cropping = this.mode() === 'crop';

    if (this.pointers.size === 2 && this.gesture) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = this.gesture;
      if (cropping) {
        const k = Math.min(8, Math.max(1, (g.crop * dist) / g.dist));
        const dm = { x: mid.x - g.mid.x, y: mid.y - g.mid.y };
        g.mid = mid;
        this.settings.update((s) => this.clampCrop({ ...s, cropScale: k, cropX: s.cropX + dm.x / this.pic().w, cropY: s.cropY + dm.y / this.pic().h }));
        return;
      }
      const k = Math.min(MAX_ZOOM, Math.max(1, (g.scale * dist) / g.dist));
      const ratio = k / g.scale;
      this.scale.set(k);
      this.tx.set(mid.x - (g.mid.x - g.tx) * ratio);
      this.ty.set(mid.y - (g.mid.y - g.ty) * ratio);
      this.clampView();
      return;
    }

    if (this.pointers.size === 1 && this.down) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.hypot(cur.x - this.down.pt.x, cur.y - this.down.pt.y) > 8) this.down.moved = true;
      if (!this.down.moved) return;
      if (cropping) {
        const p = this.pic();
        const sgnX = this.settings().flipH ? -1 : 1;
        const sgnY = this.settings().flipV ? -1 : 1;
        this.settings.update((s) =>
          this.clampCrop({ ...s, cropX: s.cropX + (sgnX * dx) / (p.w * this.scale()), cropY: s.cropY + (sgnY * dy) / (p.h * this.scale()) }),
        );
      } else if (this.scale() > 1) {
        this.tx.update((v) => v + dx);
        this.ty.update((v) => v + dy);
        this.clampView();
      }
    }
  }

  onPointerUp(ev: PointerEvent): void {
    const wasTracked = this.pointers.delete(ev.pointerId);
    if (!wasTracked) return;
    if (this.pointers.size < 2) this.gesture = null;
    if (this.pointers.size === 0 && this.down) {
      const d = this.down;
      this.down = null;
      if (!d.moved && Date.now() - d.t < 400) this.onTap(d.pt);
    }
  }

  private onTap(pt: Pt): void {
    const now = Date.now();
    if (now - this.lastTap < 300) {
      this.lastTap = 0;
      if (this.mode() === 'crop') this.resetCrop();
      else if (this.selected()) this.exitFocus();
      else if (this.scale() > 1) this.resetZoom();
      else this.zoomAt(pt, 2.5);
      return;
    }
    this.lastTap = now;
    if (this.focusMode() && !this.selected()) {
      const cell = this.cellAt(pt);
      if (cell) {
        this.select(cell);
        this.chrome.set(true);
      }
      return;
    }
    this.chrome.update((v) => !v);
  }

  private zoomAt(pt: Pt, k: number): void {
    const g = this.scale();
    const ratio = k / g;
    this.scale.set(k);
    this.tx.set(pt.x - (pt.x - this.tx()) * ratio);
    this.ty.set(pt.y - (pt.y - this.ty()) * ratio);
    this.clampView();
  }

  /** Zoom the view so one cell fills the screen. */
  private zoomToCell(cell: Cell): void {
    const st = this.stage();
    const p = this.pic();
    const l = this.layout();
    const kx = p.w / l.picW;
    const ky = p.h / l.picH;
    // cell rect in unzoomed screen px
    const cx = st.x + p.x + cell.x * kx;
    const cy = st.y + p.y + cell.y * ky;
    const cw = cell.w * kx;
    const ch = cell.h * ky;
    const W = this.vw();
    const H = this.vh();
    const k = Math.min(MAX_ZOOM, (W - FOCUS_PAD) / cw, (H - FOCUS_PAD) / ch);
    this.scale.set(k);
    this.tx.set(W / 2 - k * (cx + cw / 2));
    this.ty.set(H / 2 - k * (cy + ch / 2));
    this.clampView(FOCUS_PAD);
  }

  /** Which main cell is under a screen point, accounting for zoom/pan. */
  private cellAt(pt: Pt): { r: number; c: number } | null {
    const st = this.stage();
    const p = this.pic();
    const k = this.scale();
    const x = (pt.x - this.tx()) / k - st.x - p.x;
    const y = (pt.y - this.ty()) / k - st.y - p.y;
    if (x < 0 || y < 0 || x > p.w || y > p.h) return null;
    const s = this.settings();
    return {
      c: Math.min(s.cols - 1, Math.floor((x / p.w) * s.cols)),
      r: Math.min(s.rows - 1, Math.floor((y / p.h) * s.rows)),
    };
  }

  private clampView(slack = 0): void {
    const k = this.scale();
    if (k <= 1) {
      this.tx.set(0);
      this.ty.set(0);
      return;
    }
    const W = this.vw();
    const H = this.vh();
    this.tx.set(Math.min(slack, Math.max(W - W * k - slack, this.tx())));
    this.ty.set(Math.min(slack, Math.max(H - H * k - slack, this.ty())));
  }

  /** Keep the photo covering the picture area (cover mode) or at least inside sensible bounds. */
  private clampCrop(s: Settings): Settings {
    const img = this.imageSize();
    const p = this.pic();
    if (!img || p.w === 0 || p.h === 0) return s;
    const base = s.fit === 'cover' ? Math.max(p.w / img.w, p.h / img.h) : Math.min(p.w / img.w, p.h / img.h);
    const dw = img.w * base * s.cropScale;
    const dh = img.h * base * s.cropScale;
    const maxX = Math.max(0, (dw - p.w) / 2 / p.w);
    const maxY = Math.max(0, (dh - p.h) / 2 / p.h);
    return {
      ...s,
      cropX: Math.min(maxX, Math.max(-maxX, s.cropX)),
      cropY: Math.min(maxY, Math.max(-maxY, s.cropY)),
    };
  }

  private range(from: number, toExclusive: number): number[] {
    const out: number[] = [];
    for (let i = from; i < toExclusive; i++) out.push(i);
    return out;
  }

  colName(c: number): string {
    let s = '';
    let n = c;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  }
}
