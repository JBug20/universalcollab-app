// Builds the "UniversalCollab Private Preview (with OBS Studio)" Windows installer from this repo's app code.
//   node build/build-with-obs.mjs --base <folder> --out <folder outside this repo> [--public-key <base64>]
//     [--source-record <zip or folder>]
// --base is the Windows app from an earlier "with OBS" release, provided privately (StreamRelay.exe and the
// Electron runtime, obs-studio, and resources/app). Never download a different Electron or OBS instead.
// The new installer gets: the base's runtime and OBS, this repo's DesktopSource as resources/app, and the base's
// private build files (release-oauth.json with the real client IDs, the relay release, CollabAssistEngine.exe).
// --public-key is the app update key from build/update-keys.mjs; without it the build reuses the base's key, and
// with neither the app can only say that updates exist. --source-record adds the Source Record OBS plugin (exeldro,
// GPL-2.0) to the included OBS, for Settings → OBS → Recording scene: give it the official Windows x64 download
// (zip, or that zip unpacked), never a self-built copy. Needs NSIS (makensis). The installer is handed over as a
// file: never commit or upload it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appFiles } from './make-app-update.mjs';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = name => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = arg('base') && path.resolve(arg('base')),
  out = arg('out') && path.resolve(arg('out'));
const fail = text => {
  console.error(text);
  process.exit(1);
};
if (!base || !out || out === repo || out.startsWith(repo + path.sep))
  fail(
    'Usage: node build/build-with-obs.mjs --base <earlier with-OBS app folder> --out <folder outside this repo> [--public-key <base64>] [--source-record <zip or folder>]'
  );
for (const f of ['StreamRelay.exe', 'obs-studio/bin/64bit/obs64.exe', 'resources/app/package.json'])
  if (!fs.existsSync(path.join(base, f))) fail('The base folder is missing ' + f + '.');

const version = JSON.parse(fs.readFileSync(path.join(repo, 'DesktopSource/package.json'), 'utf8')).version;
const m = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.(\d+))?$/.exec(version);
if (!m) fail('Unexpected version ' + version);
const obsVersion = (() => {
  try {
    return fs.readFileSync(path.join(base, 'obs-studio/OBS-VERSION.txt'), 'utf8').trim().split(/\s+/).pop();
  } catch {
    return '';
  }
})();

const stage = path.join(out, 'stage');
fs.rmSync(stage, { recursive: true, force: true });
// Hard links where possible: the runtime and OBS are large and unchanged.
const link = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.linkSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
  }
};
const walk = (dir, rel = '') =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(d => {
    const name = rel ? rel + '/' + d.name : d.name;
    return d.isDirectory() ? walk(dir, name) : d.isFile() ? [name] : [];
  });
const runtime = walk(base).filter(
  f =>
    !f.startsWith('resources/app/') &&
    !f.startsWith('resources/app-previous/') &&
    !f.startsWith('obs-studio/config/') &&
    f !== 'obs-studio/portable_mode.txt' &&
    !['Uninstall.exe', 'installed-files.txt'].includes(f)
);
for (const f of runtime) link(path.join(base, f), path.join(stage, f));
// Source Record plugin for the included OBS (optional).
const sourceRecord = arg('source-record') && path.resolve(arg('source-record'));
let sourceRecordFiles = 0;
if (sourceRecord) {
  let dir = sourceRecord;
  if (fs.statSync(sourceRecord).isFile()) {
    dir = path.join(out, 'source-record-unpacked');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // unzip on Linux; Windows 10 and newer have tar, which also reads zip files.
    let r = spawnSync('unzip', ['-q', '-o', sourceRecord, '-d', dir], { stdio: 'inherit' });
    if (r.error || r.status !== 0) r = spawnSync('tar', ['-xf', sourceRecord, '-C', dir], { stdio: 'inherit' });
    if (r.error || r.status !== 0) fail('Could not unpack ' + sourceRecord + '.');
  }
  // The download has obs-plugins/64bit/source-record.dll and data/obs-plugins/source-record, sometimes inside a
  // top folder.
  const dll = walk(dir).find(f => /(^|\/)obs-plugins\/64bit\/source-record\.dll$/i.test(f));
  if (!dll)
    fail('No obs-plugins/64bit/source-record.dll in ' + sourceRecord + '. Use the Windows x64 zip of Source Record.');
  const root = path.join(dir, dll.slice(0, -'obs-plugins/64bit/source-record.dll'.length));
  // A 64-bit Windows DLL (PE, machine x64).
  const pe = fs.readFileSync(path.join(root, 'obs-plugins/64bit/source-record.dll'));
  const at = pe.readUInt32LE(0x3c);
  if (pe.toString('latin1', 0, 2) !== 'MZ' || pe.toString('latin1', at, at + 4) !== 'PE\0\0' || pe.readUInt16LE(at + 4) !== 0x8664)
    fail('source-record.dll is not a 64-bit Windows plugin.');
  const plugin = [
    ...walk(path.join(root, 'obs-plugins/64bit'))
      .filter(f => /^source-record\.(dll|pdb)$/i.test(f))
      .map(f => 'obs-plugins/64bit/' + f),
    ...(fs.existsSync(path.join(root, 'data/obs-plugins/source-record'))
      ? walk(path.join(root, 'data/obs-plugins/source-record')).map(f => 'data/obs-plugins/source-record/' + f)
      : [])
  ];
  for (const f of plugin) {
    fs.rmSync(path.join(stage, 'obs-studio', f), { force: true });
    fs.mkdirSync(path.dirname(path.join(stage, 'obs-studio', f)), { recursive: true });
    fs.copyFileSync(path.join(root, f), path.join(stage, 'obs-studio', f));
  }
  sourceRecordFiles = plugin.length;
  // Its licence notice (the staged notice is a hard link to the base's, so it is replaced, not edited).
  const notice = path.join(stage, 'OBS-STUDIO-NOTICE.txt');
  const text = fs.existsSync(notice) ? fs.readFileSync(notice, 'utf8') : '';
  fs.rmSync(notice, { force: true });
  fs.writeFileSync(
    notice,
    text.trimEnd() +
      '\r\n\r\nThe included OBS also has the Source Record plugin by Exeldro (obs-studio\\obs-plugins\\64bit\\source-record.dll),\r\n' +
      'an unmodified copy of its official Windows release, used for Settings > OBS > Recording scene.\r\n' +
      'Source Record is free software licensed under the GNU General Public License, version 2.\r\n' +
      'Licence text: obs-studio/data/obs-studio/license/gplv2.txt\r\n' +
      'Source code: https://github.com/exeldro/obs-source-record\r\n'
  );
}
const app = path.join(stage, 'resources/app'),
  source = path.join(repo, 'DesktopSource');
for (const f of appFiles(source)) link(path.join(source, f), path.join(app, f));
// Private build files from the base release.
const baseApp = path.join(base, 'resources/app');
const privateFiles = walk(baseApp).filter(
  f => f === 'release-oauth.json' || f.startsWith('relay-release/') || /\.exe$/i.test(f)
);
for (const f of privateFiles) {
  fs.rmSync(path.join(app, f), { force: true });
  link(path.join(baseApp, f), path.join(app, f));
}
const update = JSON.parse(fs.readFileSync(path.join(source, 'release-update.json'), 'utf8'));
let baseKey = '';
try {
  baseKey = JSON.parse(fs.readFileSync(path.join(baseApp, 'release-update.json'), 'utf8')).publicKey || '';
} catch {}
update.publicKey = arg('public-key') || baseKey;
fs.rmSync(path.join(app, 'release-update.json'), { force: true });
fs.writeFileSync(path.join(app, 'release-update.json'), JSON.stringify(update) + '\n');
if (!JSON.parse(fs.readFileSync(path.join(app, 'release-oauth.json'), 'utf8')).twitch?.clientId)
  console.warn('Warning: release-oauth.json has no Twitch client ID; Twitch sign-in will not work in this build.');

// Uninstall list: every installed file, then folders deepest first (RMDir only removes empty ones).
const files = walk(stage);
const dirs = [...new Set(files.flatMap(f => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))]
  .sort((a, b) => b.split('/').length - a.split('/').length);
const win = f => f.replace(/\//g, '\\');
const list = path.join(out, 'uninstall-list.nsh');
fs.writeFileSync(
  list,
  '﻿' +
    files.map(f => `  Delete "$INSTDIR\\${win(f)}"`).join('\r\n') +
    '\r\n' +
    dirs.map(d => `  RMDir "$INSTDIR\\${win(d)}"`).join('\r\n') +
    '\r\n'
);
const outFile = path.join(out, `UniversalCollab-Private-Setup-${version}-with-OBS.exe`);
const r = spawnSync(
  process.env.MAKENSIS || 'makensis',
  [
    '-V2',
    `-DSTAGE=${stage}`,
    `-DVERSION=${version}`,
    `-DVIVERSION=${m[1]}.${m[2]}.${m[3]}.${m[4] || 0}`,
    `-DOUTFILE=${outFile}`,
    `-DOBSVERSION=${obsVersion || 'Studio'}`,
    `-DUNINSTALL_LIST=${list}`,
    path.join(repo, 'build/installer-with-obs.nsi')
  ],
  { stdio: 'inherit' }
);
if (r.status !== 0) fail('makensis failed.');
console.log(`Built ${outFile}`);
console.log(`App ${version}, ${files.length} files, update key ${update.publicKey ? 'set' : 'NOT set (updates are notify-only)'}.`);
console.log(sourceRecord ? `Source Record added to the included OBS (${sourceRecordFiles} files).` : 'Source Record not included (no --source-record).');
