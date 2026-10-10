// Builds the "UniversalCollab Private Preview (with OBS Studio)" Windows installer from this repo's app code.
//   node build/build-with-obs.mjs --base <folder> --out <folder outside this repo> [--public-key <base64>]
// --base is the Windows app from an earlier "with OBS" release, provided privately (StreamRelay.exe and the
// Electron runtime, obs-studio, and resources/app). Never download a different Electron or OBS instead.
// The new installer gets: the base's runtime and OBS, this repo's DesktopSource as resources/app, and the base's
// private build files (release-oauth.json with the real client IDs, the relay release, CollabAssistEngine.exe).
// --public-key is the app update key from build/update-keys.mjs; without it the build reuses the base's key, and
// with neither the app can only say that updates exist. Needs NSIS (makensis). The installer is handed over as a
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
  fail('Usage: node build/build-with-obs.mjs --base <earlier with-OBS app folder> --out <folder outside this repo> [--public-key <base64>]');
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
