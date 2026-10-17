'use strict';
// Post-stream reports (1.2.0), main side. stream-report.js makes the report when a relay broadcast ends; this saves
// it twice: as a text file next to the recordings ("Stream report 2026-10-17 19-02.txt"), and in the app's data
// folder for Tools → Stream reports (the last 50).
const fs = require('node:fs'),
  path = require('node:path');

const KEEP = 50;
const ID = /^\d{8}T\d{6}$/;
const pad = n => String(n).padStart(2, '0');
function fileName(startedAt) {
  const d = new Date(startedAt);
  return `Stream report ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(
    d.getMinutes()
  )}.txt`;
}
function check(report, text) {
  if (!report || typeof report !== 'object' || !ID.test(report.id)) throw Error('Invalid report.');
  if (!Number.isFinite(report.startedAt) || !Number.isFinite(report.endedAt)) throw Error('Invalid report.');
  if (JSON.stringify(report).length > 500000 || typeof text !== 'string' || text.length > 200000)
    throw Error('The report is too large.');
}
exports.fileName = fileName;
exports.start = ({ app, ipcMain, guard, shell, recordingsFolder }) => {
  const dir = path.join(app.getPath('userData'), 'stream-reports');
  const read = id => JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'));
  const ids = () => {
    try {
      return fs
        .readdirSync(dir)
        .filter(f => /^\d{8}T\d{6}\.json$/.test(f))
        .map(f => f.slice(0, -5))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };
  ipcMain.handle('stream-reports', async (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'save') {
        check(input.report, input.text);
        // The text file goes where the recordings are (OBS's recordings folder), else Videos/UniversalCollab.
        let folder = '';
        try {
          folder = (await recordingsFolder()) || '';
        } catch {}
        if (!folder || !fs.existsSync(folder)) folder = path.join(app.getPath('videos'), 'UniversalCollab');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, fileName(input.report.startedAt));
        fs.writeFileSync(file, input.text.replace(/\n/g, process.platform === 'win32' ? '\r\n' : '\n'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, input.report.id + '.json'),
          JSON.stringify({ report: input.report, path: file })
        );
        for (const old of ids().slice(KEEP)) fs.rmSync(path.join(dir, old + '.json'), { force: true });
        return { ok: true, data: { file: path.basename(file), path: file } };
      }
      if (input.op === 'list')
        return {
          ok: true,
          data: ids().flatMap(id => {
            try {
              const { report } = read(id);
              return [
                { id, title: report.title || '', startedAt: report.startedAt, endedAt: report.endedAt }
              ];
            } catch {
              return [];
            }
          })
        };
      if (!ID.test(String(input.id || ''))) throw Error('That report does not exist.');
      if (input.op === 'get') {
        const r = read(input.id);
        return { ok: true, data: { report: r.report, path: r.path, file: path.basename(r.path || '') } };
      }
      if (input.op === 'show') {
        const r = read(input.id);
        if (!r.path || !fs.existsSync(r.path)) throw Error('The report file has been moved or deleted.');
        shell.showItemInFolder(r.path);
        return { ok: true, data: {} };
      }
      return { ok: false, error: 'Unknown request.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
};
