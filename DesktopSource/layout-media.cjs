'use strict';
// Pictures used by stream-layout sources. Stored once per content hash in the
// user's profile folder, never in localStorage (which is small and copied into
// every saved scene). The relay only ever receives rendered frames.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const MAX_BYTES = 8 * 1024 * 1024;
function sniff(b) {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  return '';
}
function createLayoutMedia(directory) {
  const file = (hash, ext) => path.join(directory, hash + '.' + ext);
  const find = hash => {
    if (!/^[a-f0-9]{64}$/.test(hash || '')) return null;
    for (const ext of Object.keys(TYPES)) {
      const f = file(hash, ext);
      if (fs.existsSync(f)) return { file: f, ext };
    }
    return null;
  };
  return {
    put(dataUrl) {
      const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw Error('Choose a PNG, JPEG or WebP picture.');
      const bytes = Buffer.from(m[2], 'base64');
      const ext = sniff(bytes);
      if (!ext || bytes.length > MAX_BYTES) throw Error('Choose a PNG, JPEG or WebP picture up to 8 MB.');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (!find(hash)) {
        fs.mkdirSync(directory, { recursive: true });
        const target = file(hash, ext);
        fs.writeFileSync(target + '.tmp', bytes, { mode: 0o600 });
        fs.renameSync(target + '.tmp', target);
      }
      return { hash };
    },
    get(hash) {
      const f = find(hash);
      if (!f) return null;
      return 'data:' + TYPES[f.ext] + ';base64,' + fs.readFileSync(f.file).toString('base64');
    },
    // Backup helpers: export only referenced pictures, bounded in size.
    read(hashes, limit = 3 * 1024 * 1024) {
      const out = {};
      let total = 0,
        skipped = 0;
      for (const h of new Set(hashes)) {
        const f = find(h);
        if (!f) continue;
        const b = fs.readFileSync(f.file);
        if (total + b.length > limit) {
          skipped++;
          continue;
        }
        total += b.length;
        out[h] = f.ext + ':' + b.toString('base64');
      }
      return { media: out, skipped };
    },
    validate(value) {
      if (value === undefined) return {};
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200)
        throw Error('Invalid layout pictures.');
      for (const [h, v] of Object.entries(value)) {
        const m = /^(png|jpeg|webp):([A-Za-z0-9+/=]+)$/.exec(v);
        if (!/^[a-f0-9]{64}$/.test(h) || !m) throw Error('Invalid layout picture.');
        const b = Buffer.from(m[2], 'base64');
        if (sniff(b) !== m[1] || crypto.createHash('sha256').update(b).digest('hex') !== h)
          throw Error('Invalid layout picture.');
      }
      return value;
    },
    write(value) {
      for (const [h, v] of Object.entries(value || {})) {
        const [ext, data] = v.split(':');
        if (find(h)) continue;
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(file(h, ext), Buffer.from(data, 'base64'), { mode: 0o600 });
      }
    }
  };
}
exports.createLayoutMedia = createLayoutMedia;
exports.start = ({ app, ipcMain, guard }) => {
  const media = createLayoutMedia(path.join(app.getPath('userData'), 'layout-media'));
  ipcMain.handle('layout-media', (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'put') return { ok: true, ...media.put(input.dataUrl) };
      if (input.op === 'get') {
        const dataUrl = media.get(input.hash);
        return dataUrl ? { ok: true, dataUrl } : { ok: false, error: 'Picture not found on this computer.' };
      }
      return { ok: false, error: 'Unknown picture action.' };
    } catch (error) {
      return { ok: false, error: error.message || 'Picture could not be saved.' };
    }
  });
  return media;
};
