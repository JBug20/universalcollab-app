'use strict';
// Free space on this PC (1.2.0): the drive OBS records to (recordings and clips), or the Videos folder when OBS is
// not connected. Shown in the status bar beside "My storage" on the relay, and checked before recording.
//
// A recordings drive can stop answering (a USB drive asleep or failing, a network drive that dropped). Nothing here
// waits on it in the app's main thread: every check is asynchronous, gives up after a few seconds, and while one is
// still waiting on the drive no other is started, so a stuck drive can never freeze UniversalCollab.
const fs = require('node:fs'),
  path = require('node:path');

const TIMEOUT = 4000;
const exists = p =>
  fs.promises.access(p).then(
    () => true,
    () => false
  );

async function measure(dir, options = {}) {
  // measure(dir, statfsFn) is the older way to pass a stand-in for statfs (tests).
  const { statfs = fs.promises.statfs, access = exists } =
    typeof options === 'function' ? { statfs: options } : options;
  // The folder may not exist yet (OBS creates it on the first recording): measure the nearest existing parent.
  let at = path.resolve(dir);
  while (!(await access(at)) && path.dirname(at) !== at) at = path.dirname(at);
  const s = await statfs(at);
  const totalBytes = Number(s.blocks) * Number(s.bsize),
    freeBytes = Number(s.bavail) * Number(s.bsize);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw Error('Free space is not available.');
  return { folder: dir, drive: path.parse(at).root, freeBytes, totalBytes };
}

// measure(), but never longer than `timeout`, and never two at once on a drive that is not answering.
function guarded({ timeout = TIMEOUT, measureFn = measure } = {}) {
  let waiting = null;
  return async dir => {
    if (waiting && waiting.dir === dir)
      throw Error(
        `The drive for ${dir} is not answering. If it is a USB or network drive, check it is connected.`
      );
    const run = measureFn(dir);
    const entry = { dir, run };
    waiting = entry;
    run
      .finally(() => {
        if (waiting === entry) waiting = null;
      })
      .catch(() => {});
    let timer;
    try {
      return await Promise.race([
        run,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error(
                  `The drive for ${dir} is not answering. If it is a USB or network drive, check it is connected.`
                )
              ),
            timeout
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

exports.measure = measure;
exports.guarded = guarded;
exports.start = ({ app, ipcMain, guard, getOBS }) => {
  const check = guarded();
  ipcMain.handle('local-storage', async e => {
    guard(e);
    let folder = '';
    try {
      const obs = getOBS();
      if (obs?.ready) folder = (await obs.request('GetRecordDirectory')).recordDirectory || '';
    } catch {}
    try {
      return { ok: true, data: { ...(await check(folder || app.getPath('videos'))), fromOBS: !!folder } };
    } catch (err) {
      return { ok: false, error: err.message || 'Free space is not available.' };
    }
  });
};
