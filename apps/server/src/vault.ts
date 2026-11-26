import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderConfig } from '@umh/types';

interface StoredProvider {
  config: ProviderConfig;
  secrets: Record<string, string>;
}

export class Vault {
  private key: Buffer;
  private file: string;

  constructor(private dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'providers.json');
    const envKey = process.env.UMH_MASTER_KEY ?? '';
    const keyFile = path.join(dataDir, '.key');
    if (envKey) {
      if (!/^[0-9a-fA-F]{64}$/.test(envKey)) throw new Error('UMH_MASTER_KEY doit contenir 64 caractères hexadécimaux (32 octets)');
      this.key = Buffer.from(envKey, 'hex');
    } else if (existsSync(keyFile)) {
      this.key = readFileSync(keyFile);
    } else {
      this.key = randomBytes(32);
      writeFileSync(keyFile, this.key, { mode: 0o600 });
      chmodSync(keyFile, 0o600);
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [iv, tag, ct] = payload.split(':');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8');
  }

  loadProviders(): ProviderConfig[] {
    if (!existsSync(this.file)) return [];
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredProvider[];
      return stored.map((s) => {
        const cfg = { ...s.config };
        for (const [field, payload] of Object.entries(s.secrets ?? {})) {
          (cfg as unknown as Record<string, string>)[field] = this.decrypt(payload);
        }
        return cfg;
      });
    } catch {
      return [];
    }
  }

  saveProviders(configs: ProviderConfig[]): void {
    const stored: StoredProvider[] = configs.map((cfg) => {
      const secrets: Record<string, string> = {};
      const copy = { ...cfg };
      for (const field of ['token', 'password'] as const) {
        const v = cfg[field];
        if (v) {
          secrets[field] = this.encrypt(v);
          (copy as unknown as Record<string, string>)[field] = '';
        }
      }
      return { config: copy, secrets };
    });
    writeFileSync(this.file, JSON.stringify(stored, null, 2), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }
}
