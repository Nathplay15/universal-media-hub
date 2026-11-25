import { describe, expect, it } from 'vitest';
import { b64u, extOf, mimeOf, parseFileName, unb64u } from './util.js';

describe('parseFileName', () => {
  it('détecte épisode de série + année', () => {
    const p = parseFileName('Ma.Super.Serie.S01E02.Pilote.2023.1080p.BluRay.x264-GRP.mkv');
    expect(p.seriesTitle).toBe('Ma Super Serie');
    expect(p.season).toBe(1);
    expect(p.episode).toBe(2);
    expect(p.year).toBe(2023);
    expect(p.title).toContain('S01E02');
  });

  it('détecte un film avec année', () => {
    const p = parseFileName('Film Test 2021.mp4');
    expect(p.title).toBe('Film Test');
    expect(p.year).toBe(2021);
    expect(p.season).toBeUndefined();
  });

  it('nettoie les tags qualité/release', () => {
    const p = parseFileName('Inception.2010.720p.WEB-DL.mkv');
    expect(p.title).toBe('Inception');
    expect(p.year).toBe(2010);
  });
});

describe('mime / ext / base64url', () => {
  it('mimeOf', () => {
    expect(mimeOf('a.mkv')).toBe('video/x-matroska');
    expect(mimeOf('a.MP4')).toBe('video/mp4');
    expect(mimeOf('a.srt')).toBe('application/x-subrip');
    expect(mimeOf('a.vtt')).toBe('text/vtt');
  });

  it('extOf', () => {
    expect(extOf('/x/y/z.MKV')).toBe('mkv');
    expect(extOf('sans-extension')).toBe('');
  });

  it('b64u/unb64u roundtrip unicode', () => {
    const s = '/tmp/média/film éàü.mkv';
    expect(unb64u(b64u(s))).toBe(s);
  });
});
