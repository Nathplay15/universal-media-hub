import { useEffect, useState } from 'react';
import type { ProviderConfig, ProviderStatus, ProviderType } from '@umh/types';
import { apiBase, deleteProvider, fetchProviders, isDirectMode, saveProvider, setApiBase, setMode, testProvider } from '../backend';
import { Icon } from '../ui/icons';
import DirectSources from '../ui/DirectSources';

const TYPE_META: Record<ProviderType, { label: string; icon: string; desc: string }> = {
  local: { label: 'Stockage local', icon: 'hdd', desc: 'Dossiers de votre machine (montages SMB/NFS inclus)' },
  jellyfin: { label: 'Jellyfin', icon: 'server', desc: 'Serveur Jellyfin — URL + clé API' },
  emby: { label: 'Emby', icon: 'server', desc: 'Serveur Emby — URL + clé API' },
  plex: { label: 'Plex', icon: 'globe', desc: 'Serveur Plex — token X-Plex-Token (découverte auto si URL laissée vide)' },
  kodi: { label: 'Kodi', icon: 'tv', desc: 'Kodi en JSON-RPC (ex: http://192.168.1.10:8080) — bibliothèque + télécommande' },
  streamio: { label: 'Streamio', icon: 'cast', desc: 'Addons Stremio (URLs de manifest.json)' },
};

interface FormState {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  token: string;
  username: string;
  password: string;
  paths: string;
  addons: string;
  enabled: boolean;
}

const emptyForm = (type: ProviderType): FormState => ({
  id: '',
  type,
  name: TYPE_META[type].label,
  baseUrl: '',
  token: '',
  username: '',
  password: '',
  paths: '',
  addons: '',
  enabled: true,
});

function toConfig(f: FormState): ProviderConfig {
  return {
    id: f.id,
    type: f.type,
    name: f.name || TYPE_META[f.type].label,
    baseUrl: f.baseUrl.trim() || undefined,
    token: f.token.trim() || undefined,
    username: f.username.trim() || undefined,
    password: f.password || undefined,
    paths: f.paths.split('\n').map((s) => s.trim()).filter(Boolean),
    addons: f.addons.split('\n').map((s) => s.trim()).filter(Boolean),
    enabled: f.enabled,
  };
}

function fromStatus(s: ProviderStatus): FormState {
  return { ...emptyForm(s.type), id: s.id, type: s.type, name: s.name, enabled: s.enabled };
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(() => apiBase());
  const [mode, setModeState] = useState<'direct' | 'server'>(() => (isDirectMode() ? 'direct' : 'server'));

  const refresh = () => fetchProviders().then(setProviders).catch(() => {});

  useEffect(() => {
    refresh();
  }, []);

  const onSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const cfg = toConfig(editing);
      if (!cfg.id) cfg.id = `${cfg.type}-${Date.now().toString(36)}`;
      const status = await saveProvider(cfg);
      setNotice(status.healthy ? `« ${status.name} » connecté ✔` : `« ${status.name} » enregistré — connexion échouée : ${status.error ?? '?'}`);
      setEditing(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (id: string) => {
    setNotice(null);
    const s = await testProvider(id);
    setNotice(s.healthy ? `« ${s.name} » répond ✔ ${s.detail ?? ''}` : `« ${s.name} » injoignable : ${s.error ?? '?'}`);
    refresh();
  };

  const onDelete = async (id: string) => {
    if (!confirm('Supprimer cette source ?')) return;
    await deleteProvider(id);
    refresh();
  };

  return (
    <div className="settings">
      <h1>Sources & réglages</h1>
      <p className="sub">Connectez tous vos services multimédia : ils seront agrégés dans une seule bibliothèque, avec recherche fédérée et lecture universelle.</p>
      <div className="provider-card">
        <div className="provider-icon">
          <Icon name="globe" size={22} />
        </div>
        <div className="provider-info" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            style={{ flex: 1 }}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.10:4000 (vide = même serveur, ex: navigateur)"
          />
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              setApiBase(serverUrl);
              setNotice(serverUrl ? `URL du serveur enregistrée : ${apiBase()}` : 'URL du serveur vidée (mode relatif / navigateur)');
              refresh();
            }}
          >
            <Icon name="check" size={16} /> Enregistrer
          </button>
        </div>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem', margin: '-6px 0 16px 4px' }}>
        URL du serveur MediaHub — indispensable dans l'app Android (APK) pour joindre votre serveur (ex: http://IP_LAN:4000).
      </div>
      <div className="provider-card">
        <div className="provider-icon">
          <Icon name="cast" size={22} />
        </div>
        <div className="provider-info">
          <div className="provider-name">Mode de fonctionnement</div>
          <div className="provider-sub">
            {mode === 'direct'
              ? '100 % autonome : l’app contacte directement Jellyfin, Emby, Plex, Kodi, WebDAV, SMB, FTP, SFTP, DLNA… aucun serveur requis'
              : 'Via un serveur MediaHub (API /api sur le port 4000)'}
          </div>
        </div>
        <div className="provider-actions">
          <button className={`btn btn-small ${mode === 'direct' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => { setMode('direct'); setModeState('direct'); }}>
            Autonome (APK)
          </button>
          <button className={`btn btn-small ${mode === 'server' ? 'btn-accent' : 'btn-ghost'}`} onClick={() => { setMode('server'); setModeState('server'); }}>
            Via serveur
          </button>
        </div>
      </div>
      {mode === 'direct' ? (
        <DirectSources />
      ) : (
        <>
      {notice && <div className="error-box" style={{ borderColor: 'rgba(34,197,94,.4)', background: 'rgba(34,197,94,.1)', color: '#86efac' }}><Icon name="check" size={20} /><div>{notice}</div></div>}
      <button className="btn btn-accent" style={{ marginBottom: 20 }} onClick={() => { setError(null); setEditing(emptyForm('local')); }}>
        <Icon name="plus" size={18} /> Ajouter une source
      </button>
      {providers.map((p) => {
        const meta = TYPE_META[p.type];
        return (
          <div className="provider-card" key={p.id}>
            <div className="provider-icon">
              <Icon name={meta.icon} size={22} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{p.name}</div>
              <div className="provider-sub">
                {meta.label} · {p.id}
                {p.healthy && p.detail ? ` · ${p.detail}` : ''}
                {!p.healthy && p.error ? ` · ⚠ ${p.error}` : ''}
              </div>
            </div>
            <span className={`status-dot ${p.healthy ? 'ok' : 'err'}`} title={p.healthy ? 'Connecté' : p.error ?? 'Hors ligne'} />
            <div className="provider-actions">
              <button className="icon-btn" title="Tester la connexion" onClick={() => onTest(p.id)}>
                <Icon name="cast" size={17} />
              </button>
              <button className="icon-btn" title="Modifier" onClick={() => { setError(null); setEditing(fromStatus(p)); }}>
                <Icon name="settings" size={17} />
              </button>
              <button className="icon-btn danger" title="Supprimer" onClick={() => onDelete(p.id)}>
                <Icon name="trash" size={17} />
              </button>
            </div>
          </div>
        );
      })}
      {providers.length === 0 && <div className="empty"><div className="big">🔌</div><p>Aucune source configurée pour le moment.</p></div>}
      </>
      )}

      {editing && (
        <div className="form-modal-backdrop" onClick={() => setEditing(null)}>
          <div className="form-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? `Modifier : ${editing.name}` : `Nouvelle source : ${TYPE_META[editing.type].label}`}</h2>
            {!editing.id && (
              <div className="field">
                <label>Type de source</label>
                <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as ProviderType })}>
                  {(Object.keys(TYPE_META) as ProviderType[]).map((t) => (
                    <option key={t} value={t}>{TYPE_META[t].label} — {TYPE_META[t].desc}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Nom affiché</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={TYPE_META[editing.type].label} />
            </div>
            {editing.type === 'local' && (
              <div className="field">
                <label>Dossiers à scanner (un par ligne)</label>
                <textarea value={editing.paths} onChange={(e) => setEditing({ ...editing, paths: e.target.value })} placeholder={'/media/films\n/media/series\n/mnt/nas/videos'} />
                <div className="hint">Chemins absolus vus par le serveur (ex: /mnt/nas). Les vidéos sont lues directement, avec prise en charge des sous-titres .vtt/.srt/.ass à côté des fichiers.</div>
              </div>
            )}
            {editing.type === 'streamio' && (
              <div className="field">
                <label>Addons Stremio (URL de manifest.json, une par ligne)</label>
                <textarea value={editing.addons} onChange={(e) => setEditing({ ...editing, addons: e.target.value })} placeholder={'https://v3-cinemeta.strem.io/manifest.json\nhttps://addon.example.com/manifest.json'} />
              </div>
            )}
            {['jellyfin', 'emby', 'plex', 'kodi'].includes(editing.type) && (
              <div className="field">
                <label>URL du serveur {editing.type === 'plex' ? '(laisser vide pour la découverte automatique via plex.tv)' : ''}</label>
                <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder={editing.type === 'kodi' ? 'http://192.168.1.10:8080' : 'http://192.168.1.10:8096'} />
              </div>
            )}
            {editing.type === 'plex' && (
              <div className="field">
                <label>Token Plex (X-Plex-Token)</label>
                <input value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} placeholder="xoxox…" type="password" />
                <div className="hint">Trouvable sur plex.tv → Paramètres → Compte → « X-Plex-Token », ou via un appareil autorisé.</div>
              </div>
            )}
            {(editing.type === 'jellyfin' || editing.type === 'emby') && (
              <>
                <div className="field">
                  <label>Clé API</label>
                  <input value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} placeholder="Clé API du tableau de bord" type="password" />
                </div>
                <div className="field">
                  <label>Ou identifiants (récupère automatiquement un token)</label>
                  <input value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} placeholder="Nom d'utilisateur" />
                </div>
                <div className="field">
                  <input value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder="Mot de passe" type="password" />
                </div>
              </>
            )}
            {editing.type === 'kodi' && (
              <>
                <div className="field">
                  <label>Identifiant HTTP (si activé dans Kodi)</label>
                  <input value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} placeholder="Nom d'utilisateur" />
                </div>
                <div className="field">
                  <input value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder="Mot de passe" type="password" />
                </div>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Annuler</button>
              <button className="btn btn-accent" onClick={onSave} disabled={saving}>
                {saving ? <Icon name="loader" size={18} /> : <Icon name="check" size={18} />} Enregistrer & connecter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
