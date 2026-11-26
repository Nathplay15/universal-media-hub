import { registerPlugin } from '@capacitor/core';

export interface LanFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface LanConn {
  type: 'smb' | 'ftp' | 'sftp' | 'http';
  host?: string;
  port?: number;
  domain?: string;
  share?: string;
  user?: string;
  pass?: string;
  path?: string;
  url?: string;
  auth?: string;
}

export interface LanFilesPlugin {
  ping(req: LanConn): Promise<{ ok: boolean; error?: string; size?: number }>;
  browse(req: LanConn): Promise<{ items: LanFileEntry[] }>;
  propfind(req: { url: string; auth?: string; depth?: number }): Promise<{ status: number; xml: string }>;
  openStream(req: LanConn): Promise<{ id: string; url: string }>;
  closeStream(req: { id: string }): Promise<void>;
}

export interface DlnaDevice {
  id: string;
  name: string;
  location: string;
}

export interface DlnaItem {
  id: string;
  title: string;
  isDir: boolean;
  url?: string;
  mime?: string;
  size?: number;
}

export interface DlnaPlugin {
  discover(): Promise<{ devices: DlnaDevice[] }>;
  browse(req: { deviceId: string; objectId?: string }): Promise<{ items: DlnaItem[] }>;
}

export interface CastPlugin {
  isAvailable(): Promise<{ available: boolean; state: number }>;
  state(): Promise<{ state: number; connected: boolean }>;
  cast(req: { url: string; contentType?: string; title?: string }): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
}

export const LanFiles = registerPlugin<LanFilesPlugin>('LanFiles');
export const Dlna = registerPlugin<DlnaPlugin>('Dlna');
export const Cast = registerPlugin<CastPlugin>('Cast');
