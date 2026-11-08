'use strict';
// Stream labels (1.2.0), app side: writes one text file per label (stream-labels.js works out the texts) into a
// folder OBS can read, by default Documents\UniversalCollab\Stream Labels, and adds OBS Text sources that read them
// ("Read from file"). Files are only written when their text changed, and replaced in one step so OBS never reads a
// half-written file. Only the known label names can be written, and only inside the chosen folder.
const fs = require('node:fs'),
  path = require('node:path');

const ID = /^[a-z][a-z_]{2,39}$/;
// OBS's text sources, per platform: the kind, and the settings that make it read a file.
const TEXT_KINDS = [
  ['text_gdiplus_v3', f => ({ read_from_file: true, file: f })],
  ['text_gdiplus_v2', f => ({ read_from_file: true, file: f })],
  ['text_gdiplus', f => ({ read_from_file: true, file: f })],
  ['text_ft2_source_v2', f => ({ from_file: true, text_file: f })],
  ['text_ft2_source', f => ({ from_file: true, text_file: f })]
];

function writeIfChanged(file, text) {
  try {
    if (fs.readFileSync(file, 'utf8') === text) return false;
  } catch {}
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // OBS may hold the file open on Windows: write it in place instead.
    fs.writeFileSync(file, text, 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
  return true;
}

// The source name for a label: "Label: Latest follower".
const sourceName = title =>
  'Label: ' +
  String(title || '')
    .replace(/[\r\n]/g, ' ')
    .trim()
    .slice(0, 60);

function create({ userData, documents, ids }) {
  const config = path.join(userData, 'stream-labels.json');
  let folder = '';
  try {
    folder = JSON.parse(fs.readFileSync(config, 'utf8')).folder || '';
  } catch {}
  if (!folder || !path.isAbsolute(folder)) folder = path.join(documents, 'UniversalCollab', 'Stream Labels');
  const known = new Set(ids);
  const fileFor = id => {
    if (!ID.test(id) || !known.has(id)) throw Error('Unknown label.');
    return path.join(folder, id + '.txt');
  };
  return {
    get folder() {
      return folder;
    },
    fileFor,
    setFolder(dir) {
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw Error('Choose a folder.');
      fs.mkdirSync(dir, { recursive: true });
      folder = dir;
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, JSON.stringify({ folder }));
    },
    // labels: { id: text }. Returns how many files changed.
    write(labels) {
      if (!labels || typeof labels !== 'object') throw Error('Nothing to write.');
      fs.mkdirSync(folder, { recursive: true });
      let changed = 0;
      for (const [id, text] of Object.entries(labels).slice(0, 64)) {
        if (!known.has(id)) continue;
        if (writeIfChanged(fileFor(id), typeof text === 'string' ? text.slice(0, 500) : '')) changed++;
      }
      return changed;
    },
    // Adds an OBS Text source that reads the label's file to the current scene. An existing one is added again.
    async addToOBS(request, { id, title }) {
      const file = fileFor(id);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(file, '', 'utf8');
      }
      const { inputKinds } = await request('GetInputKindList', { unversioned: false });
      const found = TEXT_KINDS.find(([k]) => inputKinds.includes(k));
      if (!found) throw Error('This OBS has no Text source.');
      const { currentProgramSceneName: scene } = await request('GetCurrentProgramScene');
      const source = sourceName(title || id);
      try {
        await request('CreateInput', {
          sceneName: scene,
          inputName: source,
          inputKind: found[0],
          inputSettings: found[1](file),
          sceneItemEnabled: true
        });
      } catch (e) {
        if (e.obsCode !== 601) throw e;
        // Already in OBS: point it at this file and put it in the current scene if it is not there.
        await request('SetInputSettings', {
          inputName: source,
          inputSettings: found[1](file),
          overlay: true
        });
        const { sceneItems } = await request('GetSceneItemList', { sceneName: scene });
        if (!sceneItems.some(s => s.sourceName === source))
          await request('CreateSceneItem', { sceneName: scene, sourceName: source, sceneItemEnabled: true });
      }
      return { source, scene, file };
    }
  };
}

exports.create = create;
exports.sourceName = sourceName;
exports.TEXT_KINDS = TEXT_KINDS;
exports.start = ({ app, ipcMain, guard, dialog, shell, getWindow, obsRequest }) => {
  const { IDS } = require('./stream-labels.js');
  const labels = create({ userData: app.getPath('userData'), documents: app.getPath('documents'), ids: IDS });
  const data = () => ({ folder: labels.folder });
  ipcMain.handle('stream-labels', async (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'status') return { ok: true, data: data() };
      if (input.op === 'write') {
        labels.write(input.labels);
        return { ok: true, data: data() };
      }
      if (input.op === 'choose-folder') {
        const r = await dialog.showOpenDialog(getWindow(), {
          title: 'Folder for stream label files',
          defaultPath: labels.folder,
          properties: ['openDirectory', 'createDirectory']
        });
        if (r.canceled || !r.filePaths[0]) return { ok: true, data: null };
        labels.setFolder(r.filePaths[0]);
        return { ok: true, data: data() };
      }
      if (input.op === 'open-folder') {
        fs.mkdirSync(labels.folder, { recursive: true });
        await shell.openPath(labels.folder);
        return { ok: true, data: data() };
      }
      if (input.op === 'add-to-obs') {
        const request = obsRequest();
        if (!request) return { ok: false, error: 'Connect to OBS first (Settings → OBS).' };
        const title = require('./stream-labels.js').LABELS.find(l => l[0] === input.id)?.[2];
        return { ok: true, data: await labels.addToOBS(request, { id: input.id, title }) };
      }
      return { ok: false, error: 'Unknown request.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  return labels;
};
