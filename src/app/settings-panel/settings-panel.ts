import { Component, computed, input, model, output, signal } from '@angular/core';
import { COLOR_PRESETS, fmt, layoutOf, Settings, Unit } from '../models';

type NumKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

@Component({
  selector: 'app-settings-panel',
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.css',
})
export class SettingsPanel {
  readonly settings = model.required<Settings>();
  /** natural width / natural height of the loaded photo, or null when none. */
  readonly imageAspect = input<number | null>(null);
  readonly imageUrl = input<string | null>(null);
  readonly imageName = input<string>('');
  readonly imageSize = input<{ w: number; h: number } | null>(null);

  readonly filePicked = output<File>();
  readonly clearImage = output<void>();
  readonly exportImage = output<void>();

  readonly presets = COLOR_PRESETS;
  readonly fmt = fmt;

  readonly layout = computed(() => layoutOf(this.settings()));
  readonly hasMargins = computed(() => {
    const s = this.settings();
    return s.marginTop + s.marginRight + s.marginBottom + s.marginLeft > 0;
  });
  readonly marginsDiffer = computed(() => {
    const s = this.settings();
    return !(s.marginTop === s.marginRight && s.marginTop === s.marginBottom && s.marginTop === s.marginLeft);
  });
  /** per-side margin editing; starts open when the stored margins already differ */
  private readonly perSideChoice = signal<boolean | null>(null);
  readonly perSide = computed(() => this.perSideChoice() ?? this.marginsDiffer());
  readonly cropped = computed(() => {
    const s = this.settings();
    return s.cropScale !== 1 || s.cropX !== 0 || s.cropY !== 0;
  });

  /** image pixels per canvas unit, for the "scale" readout */
  readonly pxPerUnit = computed(() => {
    const img = this.imageSize();
    const s = this.settings();
    const l = this.layout();
    if (!img) return null;
    const base = s.fit === 'cover' ? Math.max(img.w / l.picW, img.h / l.picH) : Math.min(img.w / l.picW, img.h / l.picH);
    return base * s.cropScale;
  });

  patch<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  /** Live update while typing: only commits real numbers, never rewrites the field. */
  onNum(key: NumKey, ev: Event, min: number, max: number): void {
    const raw = (ev.target as HTMLInputElement).value.trim();
    if (raw === '' || raw === '-' || raw === '.') return;
    const n = Number(raw);
    if (!isFinite(n)) return;
    this.patch(key, Math.min(max, Math.max(min, n)));
  }

  /** On blur: put the stored value back if the field was left empty/invalid. */
  onBlur(key: NumKey, ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const n = Number(el.value);
    if (el.value.trim() === '' || !isFinite(n) || n !== this.settings()[key]) {
      el.value = String(this.settings()[key]);
    }
  }

  step(key: NumKey, delta: number, min: number, max: number): void {
    const cur = this.settings()[key];
    this.patch(key, Math.min(max, Math.max(min, cur + delta)));
  }

  setAllMargins(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value.trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return;
    const m = Math.round(n * 100) / 100;
    this.settings.update((s) => ({ ...s, marginTop: m, marginRight: m, marginBottom: m, marginLeft: m }));
  }

  onMarginBlur(ev: Event): void {
    const el = ev.target as HTMLInputElement;
    if (el.value.trim() === '' || !isFinite(Number(el.value))) el.value = String(this.settings().marginTop);
  }

  togglePerSide(): void {
    this.perSideChoice.set(!this.perSide());
  }

  setUnit(u: Unit): void {
    const s = this.settings();
    if (s.unit === u) return;
    const k = u === 'in' ? 1 / 2.54 : 2.54;
    const cv = (n: number) => Math.round(n * k * 100) / 100;
    this.settings.set({
      ...s,
      unit: u,
      canvasW: cv(s.canvasW),
      canvasH: cv(s.canvasH),
      marginTop: cv(s.marginTop),
      marginRight: cv(s.marginRight),
      marginBottom: cv(s.marginBottom),
      marginLeft: cv(s.marginLeft),
    });
  }

  /** Set the canvas height so the picture area has the photo's proportions. */
  matchPhoto(): void {
    const a = this.imageAspect();
    if (!a) return;
    const s = this.settings();
    const picW = s.canvasW - s.marginLeft - s.marginRight;
    const h = picW / a + s.marginTop + s.marginBottom;
    this.patch('canvasH', Math.round(h * 100) / 100);
  }

  swap(): void {
    const s = this.settings();
    this.settings.set({
      ...s,
      canvasW: s.canvasH,
      canvasH: s.canvasW,
      marginTop: s.marginLeft,
      marginLeft: s.marginTop,
      marginBottom: s.marginRight,
      marginRight: s.marginBottom,
    });
  }

  resetCrop(): void {
    this.settings.update((s) => ({ ...s, cropScale: 1, cropX: 0, cropY: 0 }));
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.filePicked.emit(f);
    input.value = '';
  }
}
