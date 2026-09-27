import { Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COLOR_PRESETS, fmt, Settings, Unit } from '../models';

@Component({
  selector: 'app-settings-panel',
  imports: [FormsModule],
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

  readonly cellW = computed(() => this.settings().canvasW / this.settings().cols);
  readonly cellH = computed(() => this.settings().canvasH / this.settings().rows);
  readonly subCellW = computed(() => this.cellW() / this.settings().subFactor);
  readonly subCellH = computed(() => this.cellH() / this.settings().subFactor);

  /** image pixels per canvas unit, for the "scale" readout */
  readonly pxPerUnit = computed(() => {
    const img = this.imageSize();
    const s = this.settings();
    if (!img) return null;
    if (s.fit === 'cover') {
      return Math.max(img.w / s.canvasW, img.h / s.canvasH);
    }
    return Math.min(img.w / s.canvasW, img.h / s.canvasH);
  });

  patch<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings.update((s) => ({ ...s, [key]: value }));
  }

  num<K extends keyof Settings>(key: K, value: unknown, min: number, max: number): void {
    const n = Number(value);
    if (!isFinite(n)) return;
    this.patch(key, Math.min(max, Math.max(min, n)) as Settings[K]);
  }

  step<K extends keyof Settings>(key: K, delta: number, min: number, max: number): void {
    const cur = Number(this.settings()[key]);
    this.num(key, cur + delta, min, max);
  }

  setUnit(u: Unit): void {
    const s = this.settings();
    if (s.unit === u) return;
    const k = u === 'in' ? 1 / 2.54 : 2.54;
    this.settings.set({
      ...s,
      unit: u,
      canvasW: Math.round(s.canvasW * k * 100) / 100,
      canvasH: Math.round(s.canvasH * k * 100) / 100,
    });
  }

  matchPhoto(): void {
    const a = this.imageAspect();
    if (!a) return;
    const s = this.settings();
    this.patch('canvasH', Math.round((s.canvasW / a) * 100) / 100);
  }

  swap(): void {
    const s = this.settings();
    this.settings.set({ ...s, canvasW: s.canvasH, canvasH: s.canvasW });
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.filePicked.emit(f);
    input.value = '';
  }
}
