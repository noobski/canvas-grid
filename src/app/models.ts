export type Unit = 'cm' | 'in';
export type FitMode = 'cover' | 'contain';

export interface Settings {
  canvasW: number;
  canvasH: number;
  unit: Unit;
  /** margins between the canvas edge and the picture, in `unit` */
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  showMargins: boolean;
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
  /** crop of the photo inside the picture area: extra zoom (>=1) and pan as a fraction of the picture size */
  cropScale: number;
  cropX: number;
  cropY: number;
}

export const DEFAULT_SETTINGS: Settings = {
  canvasW: 40,
  canvasH: 30,
  unit: 'cm',
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  showMargins: true,
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
  cropScale: 1,
  cropX: 0,
  cropY: 0,
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

/** The picture area (canvas minus margins) and the resulting cell sizes, all in `unit`. */
export interface Layout {
  picW: number;
  picH: number;
  cellW: number;
  cellH: number;
  subW: number;
  subH: number;
  /** picture offset from the canvas corner */
  x: number;
  y: number;
}

export function layoutOf(s: Settings): Layout {
  const picW = Math.max(0.1, s.canvasW - s.marginLeft - s.marginRight);
  const picH = Math.max(0.1, s.canvasH - s.marginTop - s.marginBottom);
  return {
    picW,
    picH,
    cellW: picW / s.cols,
    cellH: picH / s.rows,
    subW: picW / s.cols / s.subFactor,
    subH: picH / s.rows / s.subFactor,
    x: s.marginLeft,
    y: s.marginTop,
  };
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '–';
  const r = Math.round(n * 100) / 100;
  return r.toString();
}
