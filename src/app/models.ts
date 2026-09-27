export type Unit = 'cm' | 'in';
export type FitMode = 'cover' | 'contain';

export interface Settings {
  canvasW: number;
  canvasH: number;
  unit: Unit;
  cols: number;
  rows: number;
  mainColor: string;
  mainWidth: number;
  subEnabled: boolean;
  subFactor: number;
  subColor: string;
  subWidth: number;
  showDims: boolean;
  showLabels: boolean;
  diagonals: boolean;
  fit: FitMode;
  grayscale: boolean;
  flipH: boolean;
  flipV: boolean;
  dimOthers: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  canvasW: 40,
  canvasH: 30,
  unit: 'cm',
  cols: 4,
  rows: 4,
  mainColor: '#000000',
  mainWidth: 1.5,
  subEnabled: false,
  subFactor: 2,
  subColor: '#ff3b30',
  subWidth: 1,
  showDims: true,
  showLabels: false,
  diagonals: false,
  fit: 'cover',
  grayscale: false,
  flipH: false,
  flipV: false,
  dimOthers: true,
};

export const COLOR_PRESETS = [
  '#000000',
  '#ffffff',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#34c759',
  '#00c7be',
  '#007aff',
  '#af52de',
  '#ff2d55',
];

export function fmt(n: number): string {
  if (!isFinite(n)) return '–';
  const r = Math.round(n * 100) / 100;
  return r.toString();
}
