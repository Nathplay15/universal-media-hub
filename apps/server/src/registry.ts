import type { MediaProvider, ProviderConfig, ProviderStatus } from '@umh/types';
import { createProvider } from '@umh/providers';
import { Vault } from './vault.js';

interface Entry {
  instance: MediaProvider;
  config: ProviderConfig;
  health: { ok: boolean; error?: string; detail?: string; at: number };
}

const HEALTH_TTL_MS = 30_000;

export class Registry {
  private entries = new Map<string, Entry>();

  constructor(private vault: Vault) {}

  async load(): Promise<void> {
    for (const cfg of this.vault.loadProviders()) {
      if (!cfg.enabled) {
        this.entries.set(cfg.id, { instance: createProvider(cfg.type), config: cfg, health: { ok: false, error: 'Désactivé', at: 0 } });
        continue;
      }
      await this.upsert(cfg, { persist: false, checkHealth: false });
    }
  }

  listConfigs(): ProviderConfig[] {
    return [...this.entries.values()].map((e) => e.config);
  }

  async upsert(cfg: ProviderConfig, opts: { persist?: boolean; checkHealth?: boolean } = {}): Promise<ProviderStatus> {
    const instance = createProvider(cfg.type);
    const entry: Entry = { instance, config: cfg, health: { ok: false, at: 0 } };
    this.entries.set(cfg.id, entry);
    if (cfg.enabled) {
      try {
        await instance.init(cfg);
        entry.health = { ok: true, at: Date.now() };
      } catch (e) {
        entry.health = { ok: false, error: (e as Error).message, at: Date.now() };
      }
      if (opts.checkHealth !== false) await this.refreshHealth(cfg.id);
    }
    if (opts.persist !== false) this.vault.saveProviders(this.listConfigs());
    return this.status(cfg.id);
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id);
    this.vault.saveProviders(this.listConfigs());
  }

  async refreshHealth(id: string): Promise<ProviderStatus | null> {
    const entry = this.entries.get(id);
    if (!entry || !entry.config.enabled) return entry ? this.status(id) : null;
    try {
      await entry.instance.init(entry.config);
      entry.health = { ...(await entry.instance.health()), at: Date.now() };
    } catch (e) {
      entry.health = { ok: false, error: (e as Error).message, at: Date.now() };
    }
    return this.status(id);
  }

  status(id: string): ProviderStatus {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Fournisseur inconnu: ${id}`);
    return {
      id: e.config.id,
      type: e.config.type,
      name: e.config.name,
      enabled: e.config.enabled,
      healthy: e.health.ok,
      error: e.health.error,
      detail: e.health.detail,
    };
  }

  statuses(): ProviderStatus[] {
    return [...this.entries.values()].map((e) => ({
      id: e.config.id,
      type: e.config.type,
      name: e.config.name,
      enabled: e.config.enabled,
      healthy: e.health.ok && Date.now() - e.health.at < HEALTH_TTL_MS ? true : e.health.ok,
      error: e.health.error,
      detail: e.health.detail,
    }));
  }

  get(id: string): MediaProvider {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Fournisseur inconnu: ${id}`);
    return e.instance;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  all(): MediaProvider[] {
    return [...this.entries.values()].filter((e) => e.config.enabled).map((e) => e.instance);
  }

  fsRoots(): string[] {
    const roots: string[] = [];
    for (const e of this.entries.values()) {
      if (e.config.type === 'local' && e.config.enabled) roots.push(...(e.config.paths ?? []));
    }
    return roots;
  }
}
