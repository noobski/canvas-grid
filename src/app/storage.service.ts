import { Injectable } from '@angular/core';
import { DEFAULT_SETTINGS, Settings } from './models';

const SETTINGS_KEY = 'canvas-grid.settings.v1';
const DB_NAME = 'canvas-grid';
const STORE = 'files';
const IMAGE_KEY = 'image';

@Injectable({ providedIn: 'root' })
export class StorageService {
  loadSettings(): Settings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const stored = JSON.parse(raw) as Partial<Settings>;
      const s: Settings = { ...DEFAULT_SETTINGS, ...stored };
      // v1 → v2: margins were introduced with a 0 default; now 4 cm all round
      if (!stored.v || stored.v < 2) {
        if (s.marginTop + s.marginRight + s.marginBottom + s.marginLeft === 0) {
          const m = s.unit === 'in' ? 1.5 : 4;
          s.marginTop = s.marginRight = s.marginBottom = s.marginLeft = m;
        }
        s.v = 2;
      }
      return s;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(s: Settings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* private mode etc. */
    }
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async saveImage(blob: Blob): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, IMAGE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      /* ignore — image simply won't persist */
    }
  }

  async loadImage(): Promise<Blob | null> {
    try {
      const db = await this.openDb();
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(IMAGE_KEY);
        req.onsuccess = () => resolve((req.result as Blob) ?? null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return blob;
    } catch {
      return null;
    }
  }

  async clearImage(): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(IMAGE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    } catch {
      /* ignore */
    }
  }
}
