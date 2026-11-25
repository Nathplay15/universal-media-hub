# MediaHub — hub multimédia universel

Toutes vos sources multimédia dans **une seule application** : Plex, Jellyfin, Emby, Kodi, Streamio (addons Stremio), stockage local (dossiers, SMB/NFS montés), et plus tard IPTV, musique (Subsonic), podcasts…

- **Bibliothèque unifiée** : films, séries, épisodes, musique, chaînes, vidéos locales au même endroit
- **Recherche fédérée** sur toutes les sources en même temps (touche `/`)
- **Lecteur universel** : HLS (hls.js) et lecture directe, sous-titres VTT/SRT/ASS, pistes audio, qualités, vitesse, Picture-in-Picture, plein écran, gestes tactiles (double-tap ±10 s, balayage volume/luminosité), raccourcis clavier, reprise de lecture automatique
- **Télécommande Kodi** intégrée (lecture lancée sur l'appareil Kodi via JSON-RPC)
- **Application Android (APK)** via Capacitor
- **Sécurisé** : les tokens/mots de passe des fournisseurs sont chiffrés au repos (AES-256-GCM)

## Architecture

```
apps/web       → UI React + Vite (+ Capacitor pour l'APK), lecteur hls.js
apps/server    → API Fastify unifiée (REST), proxy de fichiers avec Range, vault chiffré
packages/types → modèle de données partagé (MediaItem, Library, StreamInfo…)
packages/providers → connecteurs : local, jellyfin, emby, plex, kodi, streamio
```

Chaque fournisseur implémente l'interface `MediaProvider` (`packages/types/src/index.ts`) : `listLibraries`, `listItems`, `getItem`, `getChildren`, `search`, `getStreamInfo`, `health`, `control`.

## Démarrage rapide (développement)

```bash
npm install
cp .env.example .env        # optionnel
npm run dev:server          # API sur http://localhost:4000
npm run dev:web             # UI sur http://localhost:5173 (proxy /api → 4000)
```

Ouvrez http://localhost:5173 → **Sources & réglages** → ajoutez vos serveurs :

| Source | Champs requis |
|---|---|
| Stockage local | chemins de dossiers vus par le serveur (ex `/mnt/nas`) |
| Jellyfin / Emby | URL + clé API (ou identifiants) |
| Plex | X-Plex-Token (URL vide = découverte auto via plex.tv) |
| Kodi | URL JSON-RPC (ex `http://192.168.1.10:8080`) + identifiants HTTP si activés |
| Streamio | URLs de `manifest.json` d'addons Stremio |

## Production (Docker)

```bash
docker compose up -d --build
# UI + API sur http://localhost:4000
# Montez vos médias : volumes: - /mnt/nas:/media:ro  (puis source "local" avec /media)
```

## Application Android (APK)

**En local** (nécessite Android Studio / SDK + JDK 17) :

```bash
npm run build
cd apps/web
npx cap add android        # première fois seulement
npm run android:apk        # build web + sync + assembleDebug → android/app/build/outputs/apk/debug/app-debug.apk
```

**Automatiquement (CI)** : à chaque push sur `main`, le workflow [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) construit `app-debug.apk` et le publie en **artifact téléchargeable** (onglet *Actions* → run → *Artifacts*).

Configurez l'URL de votre serveur MediaHub dans l'app Android via `localStorage` / variable `UMH_API` au besoin (en dev, le proxy Vite redirige `/api`).

## API (extraits)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/libraries` | bibliothèques agrégées de toutes les sources |
| GET | `/api/library?provider=&id=&limit=&sort=` | contenu d'une bibliothèque |
| GET | `/api/item?ref=` / `/api/item/children?ref=` | fiche média / saisons-épisodes |
| GET | `/api/search?q=` | recherche fédérée |
| GET | `/api/stream?ref=` | infos de lecture (url, sous-titres, pistes, qualités) |
| GET | `/api/play?ref=` | redirection vers le flux (ou `/api/fs/...` en local) |
| GET | `/api/fs/:enc` | fichier local (Range supporté, jail root) |
| GET/PUT | `/api/progress` | reprise de lecture |
| GET | `/api/continue` | « Reprendre la lecture » |
| POST | `/api/remote` | télécommande (Kodi) |
| GET/PUT/DELETE | `/api/providers` | gestion des sources (secrets chiffrés) |

## Sécurité

- Secrets chiffrés AES-256-GCM (`data/providers.json`, clé dans `UMH_MASTER_KEY` ou `data/.key` générée, mode 0600)
- `/api/fs/` restreint aux racines déclarées (vérification realpath, anti path-traversal)
- Aucune ressource exposée publiquement par défaut : bind sur `0.0.0.0` uniquement en conteneur local/LAN

## Roadmap

- [ ] IPTV (playlists M3U), musique Subsonic/Navidrome, podcasts RSS, YouTube/Invidious
- [ ] Profils multi-utilisateurs, droits par bibliothèque
- [ ] Casting (Chromecast / DLNA), app iOS
- [ ] Métadonnées enrichies (TMDB) pour les fichiers locaux

## Tester l'APK Android

1. Télécharger l'artifact `mediahub-app-debug-apk` : onglet **Actions** → run « CI — tests + APK Android » → Artifacts (ou `gh api repos/<owner>/<repo>/actions/artifacts/<id>/zip > umh.zip && unzip umh.zip`)
2. Installer sur le téléphone : `adb install app-debug.apk` (USB débogage) ou transférer le fichier et autoriser « sources inconnues »
3. Démarrer le serveur MediaHub sur la machine/NAS : `docker compose up -d --build` (ou `npm run dev:server`), port **4000**
4. Dans l'app APK → **Sources & réglages** → champ « URL du serveur » : saisir `http://<IP_LAN>:4000` (ex `http://192.168.1.10:4000`) → Enregistrer
5. Ajouter vos sources (dossier local `/media`, Jellyfin, Plex…) → Accueil → lire une vidéo

## Mode 100 % autonome (APK sans serveur)

L'app embarque un moteur « direct » : dans **Sources & réglages → Mode « Autonome (APK) »**, ajoute :
- **Jellyfin / Emby / Plex / Kodi / WebDAV** : appels HTTP directs depuis le téléphone (tokens chiffrés en local, WebCrypto AES-GCM)
- **SMB, FTP, SFTP** : plugins natifs (smbj, commons-net, sshj) + proxy HTTP local (NanoHTTPD) avec Range → lisible dans le lecteur et seekable
- **UPnP/DLNA** : découverte SSDP + browsing ContentDirectory (SOAP) natifs
- **Chromecast** : bouton cast dans le lecteur (Cast SDK, receiver par défaut)
- Kodi : bibliothèque + télécommande (Player.Open/PlayPause/Seek) en JSON-RPC direct

En mode autonome, la progression de lecture est stockée localement (localStorage). Le mode « Via serveur » reste disponible pour tout centraliser sur un NAS.
