import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault } from './vault.js';

describe('Vault (chiffrement AES-256-GCM)', () => {
  it('chiffre/déchiffre et ne persiste jamais les secrets en clair', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'umh-vault-'));
    process.env.UMH_MASTER_KEY = 'ab'.repeat(32);
    try {
      const v = new Vault(dir);
      const ct = v.encrypt('secret-token-123');
      expect(ct).not.toContain('secret-token-123');
      expect(v.decrypt(ct)).toBe('secret-token-123');

      v.saveProviders([{ id: 'plex-1', type: 'plex', name: 'Plex', token: 'secret-token-123', password: 'motdepasse', enabled: true }]);
      const raw = await readFile(path.join(dir, 'providers.json'), 'utf8');
      expect(raw).not.toContain('secret-token-123');
      expect(raw).not.toContain('motdepasse');

      const loaded = v.loadProviders();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].token).toBe('secret-token-123');
      expect(loaded[0].password).toBe('motdepasse');
    } finally {
      delete process.env.UMH_MASTER_KEY;
    }
  });

  it('rejette une UMH_MASTER_KEY invalide', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'umh-vault2-'));
    process.env.UMH_MASTER_KEY = 'zz-not-hex';
    try {
      expect(() => new Vault(dir)).toThrow();
    } finally {
      delete process.env.UMH_MASTER_KEY;
    }
  });
});
