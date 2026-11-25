import { useEffect, useState } from 'react';
import type { ProviderStatus } from '@umh/types';
import { deleteSource, listSourceStatuses, saveSource, testSource } from '../direct/engine';
import type { DirectSource, DirectSourceType } from '../direct/vault';
import { Icon } from './icons';

const TYPES: { value: DirectSourceType; label: string; icon: string; desc: string }[] = [
  { value: 'jellyfin', label: 'Jellyfin', icon: 'server', desc: 'URL + clé API ou identifiants' },
  { value: 'emby', label: 'Emby', icon: 'server', desc: 'URL + clé API ou identifiants' },
  { value: 'plex', label: 'Plex', icon: 'globe', desc: 'X-Plex-Token (URL vide = auto via plex.tv)' },
  { value: 'kodi', label: 'Kodi', icon: 'tv', desc: 'JSON-RPC (ex http://192.168.1.10:8080) + télécommande' },
  { value: 'webdav', label: 'WebDAV', icon: 'cloud', desc: 'URL WebDAV (Nextcloud, NAS…) + identifiants' },
  { value: 'smb', label: 'SMB / Windows share', icon: 'hdd', desc: 'host, port 445, domaine, user, mot de passe, partage, chemin' },
  { value: 'ftp', label: 'FTP', icon: 'hdd', desc: 'host, port 21, user, mot de passe, chemin' },
  { value: 'sftp', label: 'SFTP / SSH', icon: 'lock', desc: 'host, port 22, user, mot de passe, chemin' },
  { value: 'dlna', label: 'UPnP / DLNA', icon: 'cast', desc: 'Découverte automatique des serveurs média du réseau' },
];

interface FormState {
  id: string;
  type: DirectSourceType;
  name: string;
  baseUrl: string;
  host: string;
  port: string;
  domain: string;
  share: string;
  path: string;
  username: string;
  password: string;
  token: string;
  enabled: boolean;
}

const empty = (type: DirectSourceType): FormState => ({
  id: '', type, name: TYPES.find((t) => t.value === type)?.label ?? type,
  baseUrl: '', host: '', port: '', domain: '', share: '', path: '/',
  username: '', password: '', token: '', enabled: true,
});

function toSource(f: FormState): DirectSource {
  return {
    id: f.id || `${f.type}-${Date.now().toString(36)}`,
    type: f.type,
    name: f.name || TYPES.find((t) => t.value === f.type)?.label || f.type,
    enabled: f.enabled,
    baseUrl: f.baseUrl.trim() || undefined,
    host: f.host.trim() || undefined,
    port: f.port ? parseInt(f.port, 10) : undefined,
    domain: f.domain.trim() || undefined,
    share: f.share.trim() || undefined,
    path: f.path.trim() || undefined,
    username: f.username.trim() || undefined,
    password: f.password || undefined,
    token: f.token.trim() || undefined,
  };
}

export default function DirectSources() {
  const [sources, setSources] = useState<ProviderStatus[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => listSourceStatuses().then(setSources).catch(() => {});

  useEffect(() => {
    refresh();
  }, []);

  const onSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const st = await saveSource(toSource(editing));
      setNotice(st.healthy ? `« ${st.name} » OK ✔ ${st.detail ?? ''}` : `« ${st.name} » enregistrée — erreur : ${st.error ?? '?'}`);
      setEditing(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (id: string) => {
    const st = await testSource(id);
    setNotice(st.healthy ? `« ${st.name} » répond ✔ ${st.detail ?? ''}` : `« ${st.name} » injoignable : ${st.error ?? '?'}`);
    refresh();
  };

  const onDelete = async (id: string) => {
    if (!confirm('Supprimer cette source ?')) return;
    await deleteSource(id);
    refresh();
  };

  const typeMeta = (t: string) => TYPES.find((x) => x.value === t);

  return (
    <div>
      {notice && <div className="error-box" style={{ borderColor: 'rgba(34,197,94,.4)', background: 'rgba(34,197,94,.1)', color: '#86efac' }}><Icon name="check" size={20} /><div>{notice}</div></div>}
      <button className="btn btn-accent" style={{ marginBottom: 20 }} onClick={() => { setError(null); setEditing(empty('jellyfin')); }}>
        <Icon name="plus" size={18} /> Ajouter une source directe
      </button>
      {sources.map((s) => {
        const meta = typeMeta(s.type);
        return (
          <div className="provider-card" key={s.id}>
            <div className="provider-icon">
              <Icon name={meta?.icon ?? 'folder'} size={22} />
            </div>
            <div className="provider-info">
              <div className="provider-name">{s.name}</div>
              <div className="provider-sub">
                {meta?.label} · {s.id}
                {s.healthy && s.detail ? ` · ${s.detail}` : ''}
                {!s.healthy && s.error ? ` · ⚠ ${s.error}` : ''}
              </div>
            </div>
            <span className={`status-dot ${s.healthy ? 'ok' : 'err'}`} title={s.healthy ? 'Connecté' : s.error ?? 'Hors ligne'} />
            <div className="provider-actions">
              <button className="icon-btn" title="Tester" onClick={() => onTest(s.id)}>
                <Icon name="cast" size={17} />
              </button>
              <button
                className="icon-btn"
                title="Modifier"
                onClick={async () => {
                  const { loadSources } = await import('../direct/vault');
                  const src = (await loadSources()).find((x) => x.id === s.id);
                  setError(null);
                  setEditing(src ? { ...empty(src.type), id: src.id, type: src.type, name: src.name, baseUrl: src.baseUrl ?? '', host: src.host ?? '', port: src.port ? String(src.port) : '', domain: src.domain ?? '', share: src.share ?? '', path: src.path ?? '/', username: src.username ?? '', password: src.password ?? '', token: src.token ?? '', enabled: src.enabled } : empty(s.type as DirectSourceType));
                }}
              >
                <Icon name="settings" size={17} />
              </button>
              <button className="icon-btn danger" title="Supprimer" onClick={() => onDelete(s.id)}>
                <Icon name="trash" size={17} />
              </button>
            </div>
          </div>
        );
      })}
      {sources.length === 0 && (
        <div className="empty">
          <div className="big">📡</div>
          <p>Aucune source directe. Ajoute Jellyfin, Plex, un partage SMB, un NAS DLNA… l'app fonctionnera 100 % hors ligne de tout serveur.</p>
        </div>
      )}

      {editing && (
        <div className="form-modal-backdrop" onClick={() => setEditing(null)}>
          <div className="form-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing.id ? `Modifier : ${editing.name}` : `Nouvelle source : ${typeMeta(editing.type)?.label}`}</h2>
            {!editing.id && (
              <div className="field">
                <label>Type</label>
                <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as DirectSourceType })}>
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label>Nom affiché</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            {['jellyfin', 'emby', 'plex', 'kodi', 'webdav'].includes(editing.type) && (
              <div className="field">
                <label>URL {editing.type === 'plex' ? '(vide = découverte auto plex.tv)' : ''}</label>
                <input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder={editing.type === 'kodi' ? 'http://192.168.1.10:8080' : 'http://192.168.1.10:8096'} />
              </div>
            )}
            {['smb', 'ftp', 'sftp'].includes(editing.type) && (
              <>
                <div className="field">
                  <label>Hôte</label>
                  <input value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} placeholder="192.168.1.20" />
                </div>
                <div className="field">
                  <label>Port</label>
                  <input value={editing.port} onChange={(e) => setEditing({ ...editing, port: e.target.value })} placeholder={editing.type === 'smb' ? '445' : editing.type === 'ftp' ? '21' : '22'} />
                </div>
                {editing.type === 'smb' && (
                  <>
                    <div className="field"><label>Domaine (optionnel)</label><input value={editing.domain} onChange={(e) => setEditing({ ...editing, domain: e.target.value })} placeholder="WORKGROUP" /></div>
                    <div className="field"><label>Partage (share)</label><input value={editing.share} onChange={(e) => setEditing({ ...editing, share: e.target.value })} placeholder="Videos" /></div>
                  </>
                )}
                <div className="field"><label>Chemin racine</label><input value={editing.path} onChange={(e) => setEditing({ ...editing, path: e.target.value })} placeholder="/" /></div>
              </>
            )}
            {editing.type === 'plex' && (
              <div className="field">
                <label>Token X-Plex-Token</label>
                <input type="password" value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} placeholder="xoxox…" />
              </div>
            )}
            {(editing.type === 'jellyfin' || editing.type === 'emby') && (
              <>
                <div className="field">
                  <label>Clé API (recommandée)</label>
                  <input type="password" value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} placeholder="Clé générée dans Tableau de bord → Clés API" />
                  <div className="hint">La clé API évite les erreurs d'authentification par mot de passe depuis l'app mobile.</div>
                </div>
                <div className="field"><label>… ou utilisateur (si pas de clé API)</label><input value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></div>
                <div className="field"><label>Mot de passe</label><input type="password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></div>
              </>
            )}
            {['kodi', 'webdav', 'smb', 'ftp', 'sftp'].includes(editing.type) && (
              <>
                <div className="field"><label>Utilisateur</label><input value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></div>
                <div className="field"><label>Mot de passe</label><input type="password" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></div>
              </>
            )}
            {error && <div className="form-error">{error}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>Annuler</button>
              <button className="btn btn-accent" onClick={onSave} disabled={saving}>
                {saving ? <Icon name="loader" size={18} /> : <Icon name="check" size={18} />} Enregistrer & tester
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
