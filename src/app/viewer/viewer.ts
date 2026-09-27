import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { fmt, Settings } from '../models';
import { WakeLockService } from '../wake-lock.service';

interface Pt {
  x: number;
  y: number;
}

const MAX_ZOOM = 10;

@Component({
  selector: 'app-viewer',
  templateUrl: './viewer.html',
  styleUrl: './viewer.css',
})
export class Viewer {
  readonly settings = input.required<Settings>();
  readonly imageUrl = input.required<string>();

  readonly openSettings = output<void>();
  readonly close = output<void>();

  readonly wake = inject(WakeLockService);

  readonly fmt = fmt;
  readonly Math = Math;

  // ---- viewport / stage geometry -------------------------------------------------
  readonly vw = signal(window.innerWidth);
  readonly vh = signal(window.innerHeight);

  /** The canvas rectangle, in screen px, letterboxed into the viewport. */
  readonly stage = computed(() => {
    const s = this.settings();
    const W = this.vw();
    const H = this.vh();
    const a = s.canvasW / s.canvasH;
    let w = W;
    let h = W / a;
    if (h > H) {
      h = H;
      w = H * a;
    }
    return { w, h, x: (W - w) / 2, y: (H - h) / 2 };
  });

  // ---- zoom / pan ------------------------------------------------------------------
  readonly scale = signal(1);
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly transform = computed(() => `translate(${this.tx()}px, ${this.ty()}px) scale(${this.scale()})`);

  // ---- ui state --------------------------------------------------------------------
  readonly chrome = signal(true);
  readonly focusMode = signal(false);
  readonly selected = signal<{ r: number; c: number } | null>(null);
  readonly isFullscreen = signal(!!document.fullscreenElement);
  readonly canFullscreen = !!document.documentElement.requestFullscreen;
  readonly isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  readonly toast = signal('');

  // ---- derived grid data -----------------------------------------------------------
  readonly cellW = computed(() => this.settings().canvasW / this.settings().cols);
  readonly cellH = computed(() => this.settings().canvasH / this.settings().rows);
  readonly subCellW = computed(() => this.cellW() / this.settings().subFactor);
  readonly subCellH = computed(() => this.cellH() / this.settings().subFactor);

  readonly mainV = computed(() => this.range(1, this.settings().cols).map((i) => i * this.cellW()));
  readonly mainH = computed(() => this.range(1, this.settings().rows).map((i) => i * this.cellH()));
  readonly subV = computed(() => {
    const s = this.settings();
    if (!s.subEnabled) return [];
    return this.range(1, s.cols * s.subFactor)
      .filter((i) => i % s.subFactor !== 0)
      .map((i) => i * this.subCellW());
  });
  readonly subH = computed(() => {
    const s = this.settings();
    if (!s.subEnabled) return [];
    return this.range(1, s.rows * s.subFactor)
      .filter((i) => i % s.subFactor !== 0)
      .map((i) => i * this.subCellH());
  });
  readonly cells = computed(() => {
    const s = this.settings();
    const out: { r: number; c: number; x: number; y: number; w: number; h: number; label: string }[] = [];
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        out.push({
          r,
          c,
          x: c * this.cellW(),
          y: r * this.cellH(),
          w: this.cellW(),
          h: this.cellH(),
          label: `${this.colName(c)}${r + 1}`,
        });
      }
    }
    return out;
  });
  readonly selectedCell = computed(() => {
    const sel = this.selected();
    if (!sel) return null;
    return this.cells().find((k) => k.r === sel.r && k.c === sel.c) ?? null;
  });
  readonly imgTransform = computed(() => {
    const s = this.settings();
    return `scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})`;
  });

  private pointers = new Map<number, Pt>();
  private gesture: { dist: number; mid: Pt; scale: number; tx: number; ty: number } | null = null;
  private down: { pt: Pt; t: number; moved: boolean } | null = null;
  private lastTap = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Reset the selection when the grid shape changes.
    effect(() => {
      const s = this.settings();
      const sel = this.selected();
      if (sel && (sel.r >= s.rows || sel.c >= s.cols)) this.selected.set(null);
    });
    effect(() => {
      // re-clamp on resize / settings change
      this.stage();
      this.clamp();
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
    if (ev.key === 'Escape') this.close.emit();
    if (ev.key === ' ') {
      ev.preventDefault();
      this.chrome.update((v) => !v);
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

  toggleFocus(): void {
    this.focusMode.update((v) => !v);
    if (!this.focusMode()) this.selected.set(null);
    else this.showToast('Tap a cell to focus on it. Tap again to clear.');
  }

  resetZoom(): void {
    this.scale.set(1);
    this.tx.set(0);
    this.ty.set(0);
  }

  showToast(msg: string, ms = 2200): void {
    this.toast.set(msg);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), ms);
  }

  // ---- pointer handling (tap, pan, pinch) -----------------------------------------------
  onPointerDown(ev: PointerEvent): void {
    if ((ev.target as HTMLElement).closest('.chrome')) return;
    // capture on the surface itself so pointerup/move keep reaching its listeners
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
      };
      if (this.down) this.down.moved = true;
    }
  }

  onPointerMove(ev: PointerEvent): void {
    const prev = this.pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    this.pointers.set(ev.pointerId, cur);

    if (this.pointers.size === 2 && this.gesture) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const g = this.gesture;
      const k = Math.min(MAX_ZOOM, Math.max(1, (g.scale * dist) / g.dist));
      // keep the point under the pinch midpoint fixed
      const ratio = k / g.scale;
      this.scale.set(k);
      this.tx.set(mid.x - (g.mid.x - g.tx) * ratio);
      this.ty.set(mid.y - (g.mid.y - g.ty) * ratio);
      this.clamp();
      return;
    }

    if (this.pointers.size === 1 && this.down) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.hypot(cur.x - this.down.pt.x, cur.y - this.down.pt.y) > 8) this.down.moved = true;
      if (this.down.moved && this.scale() > 1) {
        this.tx.update((v) => v + dx);
        this.ty.update((v) => v + dy);
        this.clamp();
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
      if (this.scale() > 1) this.resetZoom();
      else this.zoomAt(pt, 2.5);
      return;
    }
    this.lastTap = now;
    if (this.focusMode()) {
      const cell = this.cellAt(pt);
      if (cell) {
        const sel = this.selected();
        this.selected.set(sel && sel.r === cell.r && sel.c === cell.c ? null : cell);
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
    this.clamp();
  }

  /** Which main cell is under a screen point, accounting for zoom/pan. */
  private cellAt(pt: Pt): { r: number; c: number } | null {
    const st = this.stage();
    const k = this.scale();
    // undo the zoom transform (origin 0,0 of the host)
    const x = (pt.x - this.tx()) / k - st.x;
    const y = (pt.y - this.ty()) / k - st.y;
    if (x < 0 || y < 0 || x > st.w || y > st.h) return null;
    const s = this.settings();
    return {
      c: Math.min(s.cols - 1, Math.floor((x / st.w) * s.cols)),
      r: Math.min(s.rows - 1, Math.floor((y / st.h) * s.rows)),
    };
  }

  private clamp(): void {
    const k = this.scale();
    if (k <= 1) {
      this.tx.set(0);
      this.ty.set(0);
      return;
    }
    const W = this.vw();
    const H = this.vh();
    // scaled content spans [tx, tx + W*k]; keep it covering the viewport
    this.tx.set(Math.min(0, Math.max(W - W * k, this.tx())));
    this.ty.set(Math.min(0, Math.max(H - H * k, this.ty())));
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
