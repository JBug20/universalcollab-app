'use strict';
// Free space on this PC (1.2.0): the drive OBS records to (recordings and clips), or the Videos folder when OBS is
// not connected. Shown in the status bar beside "My storage" on the relay.
const fs = require('node:fs'),
  path = require('node:path');

async function measure(dir, statfs = fs.promises.statfs) {
  // The folder may not exist yet (OBS creates it on the first recording): measure the nearest existing parent.
  let at = path.resolve(dir);
  while (!fs.existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const s = await statfs(at);
  const totalBytes = Number(s.blocks) * Number(s.bsize),
    freeBytes = Number(s.bavail) * Number(s.bsize);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw Error('Free space is not available.');
  return { folder: dir, drive: path.parse(at).root, freeBytes, totalBytes };
}

exports.measure = measure;
exports.start = ({ app, ipcMain, guard, getOBS }) => {
  ipcMain.handle('local-storage', async e => {
    guard(e);
    let folder = '';
    try {
      const obs = getOBS();
      if (obs?.ready) folder = (await obs.request('GetRecordDirectory')).recordDirectory || '';
    } catch {}
    try {
      return { ok: true, data: { ...(await measure(folder || app.getPath('videos'))), fromOBS: !!folder } };
    } catch (err) {
      return { ok: false, error: err.message || 'Free space is not available.' };
    }
  });
};
