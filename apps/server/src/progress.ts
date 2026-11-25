import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProgressEntry } from '@umh/types';

interface StoredProgress {
  [ref: string]: { position: number; duration: number; updatedAt: string };
}

export class ProgressStore {
  private file: string;
  private data: StoredProgress = {};

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'progress.json');
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }

  get(ref: string): ProgressEntry | null {
    const e = this.data[ref];
    return e ? { ref, ...e } : null;
  }

  set(ref: string, position: number, duration: number): ProgressEntry {
    const entry: ProgressEntry = { ref, position, duration, updatedAt: new Date().toISOString() };
    this.data[ref] = { position, duration, updatedAt: entry.updatedAt };
    this.persist();
    return entry;
  }

  list(limit = 50): ProgressEntry[] {
    return Object.entries(this.data)
      .map(([ref, e]) => ({ ref, ...e }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
}
