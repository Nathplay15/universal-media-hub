import DirectSources from '../ui/DirectSources';

export default function SettingsPage() {
  return (
    <div className="settings">
      <h1>Sources</h1>
      <p className="sub">
        100 % autonome : l'app contacte directement tes serveurs et partages depuis ton téléphone.
        Jellyfin, Emby, Plex, Kodi, WebDAV, SMB, FTP, SFTP, UPnP/DLNA… aucun serveur intermédiaire.
      </p>
      <DirectSources />
    </div>
  );
}
