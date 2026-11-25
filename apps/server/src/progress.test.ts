import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProgressStore } from './progress.js';

describe('ProgressStore', () => {
  it('set/get/list avec tri par date décroissante', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'umh-prog-'));
    const s = new ProgressStore(dir);
    expect(s.get('a:1')).toBeNull();
    s.set('a:1', 10, 100);
    await new Promise((r) => setTimeout(r, 10));
    s.set('b:2', 50, 100);
    expect(s.get('a:1')?.position).toBe(10);
    const list = s.list();
    expect(list).toHaveLength(2);
    expect(list[0].ref).toBe('b:2');
    expect(list[1].ref).toBe('a:1');
  });
});
