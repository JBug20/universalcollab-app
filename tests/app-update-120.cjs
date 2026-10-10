// App updates from GitHub Releases (1.2.0): signed manifest, checked download, install on close, roll back a
// broken update, private build files never replaced, and the full installer when the update needs a new Electron.
const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  up = require('../DesktopSource/app-update.cjs');
(async () => {
  const { makeUpdate, zip } = await import('../build/make-app-update.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-app-update-'));
  try {
    assert.equal(up.compareVersions('1.2.0-preview.2', '1.2.0-preview.1'), 1);
    assert.equal(up.compareVersions('1.2.0-preview.10', '1.2.0-preview.9'), 1);
    assert.equal(up.compareVersions('1.2.0', '1.2.0-preview.9'), 1);
    assert.equal(up.compareVersions('1.1.9', '1.2.0-preview.1'), -1);
    assert.equal(up.compareVersions('1.2.0', '1.2.0'), 0);

    const flip = buf => {
      const b = Buffer.from(buf);
      b[40] ^= 1;
      return b;
    };
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });

    // The new version's app folder (what the release carries).
    const next = path.join(dir, 'next');
    fs.mkdirSync(path.join(next, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(next, 'relay-release'));
    fs.writeFileSync(path.join(next, 'package.json'), JSON.stringify({ version: '1.2.0-preview.2' }));
    fs.writeFileSync(path.join(next, 'main.cjs'), 'new main');
    fs.writeFileSync(path.join(next, 'sub', 'added.js'), 'added');
    fs.writeFileSync(path.join(next, 'release-oauth.json'), '{"twitch":{"clientId":""}}');
    fs.writeFileSync(path.join(next, 'release-update.json'), '{}');
    fs.writeFileSync(path.join(next, 'relay-release', 'index.mjs'), 'private relay');
    fs.writeFileSync(path.join(next, 'Engine.exe'), 'binary');
    const rel = makeUpdate({ app: next, key: pem, notes: 'Fixes', electron: 44 });
    assert.equal(rel.file, 'UniversalCollab-app-1.2.0-preview.2.zip');
    const names = up.readZip(rel.zip).map(f => f.name);
    assert.deepEqual(names, ['main.cjs', 'package.json', 'sub/added.js'], 'private build files are left out');

    // A zip that tries to escape the app folder or carry private files is refused.
    assert.throws(() => up.readZip(zip([{ name: '../evil.js', data: Buffer.from('x') }])), /Unsafe path/);
    assert.throws(() => up.readZip(zip([{ name: 'C:/evil.js', data: Buffer.from('x') }])), /Unsafe path/);
    assert.throws(() => up.readZip(zip([{ name: 'release-oauth.json', data: Buffer.from('x') }])), /may not/);
    assert.throws(
      () => up.readZip(zip([{ name: 'relay-release/a.mjs', data: Buffer.from('x') }])),
      /may not/
    );

    // The installed app.
    const install = path.join(dir, 'install', 'resources', 'app'),
      userData = path.join(dir, 'userData');
    fs.mkdirSync(path.join(install, 'relay-release'), { recursive: true });
    fs.writeFileSync(path.join(install, 'main.cjs'), 'old main');
    fs.writeFileSync(path.join(install, 'package.json'), JSON.stringify({ version: '1.2.0-preview.1' }));
    fs.writeFileSync(path.join(install, 'release-oauth.json'), '{"twitch":{"clientId":"real"}}');
    fs.writeFileSync(path.join(install, 'relay-release', 'index.mjs'), 'installed relay');
    const config = key =>
      fs.writeFileSync(
        path.join(install, 'release-update.json'),
        JSON.stringify({ repo: 'JBug20/universalcollab-app', channel: 'preview', publicKey: key })
      );
    config(pub);

    // Fake GitHub: a stable release, a newer preview with the app update, a draft that is newer still.
    const files = {
      'update-manifest.json': rel.manifest,
      'update-manifest.json.sig': Buffer.from(rel.signature),
      [rel.file]: rel.zip
    };
    const asset = name => ({
      name,
      browser_download_url:
        'https://github.com/JBug20/universalcollab-app/releases/download/1.2.0-preview.2/' + name
    });
    let releases;
    const reset = () =>
      (releases = [
        {
          tag_name: '1.1.0',
          prerelease: false,
          assets: [],
          html_url: 'https://github.com/x/y/releases/1.1.0'
        },
        {
          tag_name: '1.2.0-preview.2',
          prerelease: true,
          body: 'Automatic updates',
          html_url: 'https://github.com/JBug20/universalcollab-app/releases/tag/1.2.0-preview.2',
          assets: Object.keys(files).map(asset)
        },
        { tag_name: '9.0.0', draft: true, assets: [] }
      ]);
    reset();
    const asked = [];
    const fetch = async url => {
      asked.push(url);
      let body;
      if (url.startsWith('https://api.github.com/repos/JBug20/universalcollab-app/releases'))
        body = Buffer.from(JSON.stringify(releases));
      else body = files[url.split('/').pop()];
      return body
        ? { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => body }
        : { ok: false, status: 404, headers: new Map() };
    };
    const notes = [];
    const make = (opts = {}) =>
      up.create({
        appDir: install,
        userData,
        currentVersion: '1.2.0-preview.1',
        electronVersion: '44.5.1',
        fetch,
        notify: s => notes.push(s.state),
        ...opts
      });

    let u = make();
    assert.equal(u.status().auto, true, 'automatic checks are on by default');
    let s = await u.check();
    assert.equal(s.state, 'ready');
    assert.equal(s.latest.version, '1.2.0-preview.2');
    assert.equal(s.latest.notes, 'Automatic updates');
    assert.ok(notes.includes('downloading'));
    assert.equal(
      fs.readFileSync(path.join(install, 'main.cjs'), 'utf8'),
      'old main',
      'nothing changes until close'
    );
    // Still ready after a restart; installing on close.
    u = make();
    assert.equal(u.status().state, 'ready');
    assert.equal(u.apply(), '1.2.0-preview.2');
    assert.equal(fs.readFileSync(path.join(install, 'main.cjs'), 'utf8'), 'new main');
    assert.equal(fs.readFileSync(path.join(install, 'sub', 'added.js'), 'utf8'), 'added');
    assert.match(
      fs.readFileSync(path.join(install, 'release-oauth.json'), 'utf8'),
      /real/,
      'client IDs kept'
    );
    assert.equal(
      fs.readFileSync(path.join(install, 'relay-release', 'index.mjs'), 'utf8'),
      'installed relay'
    );
    assert.ok(
      fs.readFileSync(path.join(install, 'release-update.json'), 'utf8').includes(pub),
      'update key kept'
    );
    assert.equal(make().apply(), null, 'installed once');
    // A broken update is rolled back to the previous files.
    assert.equal(up.rollback(install), true);
    assert.equal(fs.readFileSync(path.join(install, 'main.cjs'), 'utf8'), 'old main');
    assert.equal(fs.existsSync(path.join(install, 'sub', 'added.js')), false);
    assert.equal(up.rollback(install), false, 'nothing left to roll back');

    // Up to date.
    s = await make({ currentVersion: '1.2.0-preview.2' }).check();
    assert.equal(s.state, 'latest');
    // The stable channel ignores previews.
    config(pub);
    fs.writeFileSync(
      path.join(install, 'release-update.json'),
      JSON.stringify({ repo: 'JBug20/universalcollab-app', channel: 'stable', publicKey: pub })
    );
    assert.equal((await make({ currentVersion: '1.0.0' }).check()).latest.version, '1.1.0');
    config(pub);

    // Signed by another key: refused, nothing staged.
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
    config(other.toString('base64'));
    s = await make().check();
    assert.equal(s.state, 'error');
    assert.match(s.error, /not signed/);
    assert.equal(fs.existsSync(path.join(userData, 'app-update')), false);
    config(pub);
    // A damaged download: refused.
    files[rel.file] = flip(rel.zip);
    s = await make().check();
    assert.equal(s.state, 'error');
    assert.match(s.error, /damaged/);
    files[rel.file] = rel.zip;
    // A staged update that was changed on disk is not installed.
    assert.equal((await make().check()).state, 'ready');
    const staged = path.join(userData, 'app-update', 'update.zip');
    fs.writeFileSync(staged, flip(rel.zip));
    assert.throws(() => make().apply(), /damaged/);
    assert.equal(fs.readFileSync(path.join(install, 'main.cjs'), 'utf8'), 'old main');

    // Needs a newer Electron: the full installer, with the release page.
    const newer = makeUpdate({ app: next, key: pem, electron: 45 });
    files['update-manifest.json'] = newer.manifest;
    files['update-manifest.json.sig'] = Buffer.from(newer.signature);
    s = await make().check();
    assert.equal(s.state, 'installer');
    assert.match(s.latest.page, /^https:\/\/github\.com\//);
    files['update-manifest.json'] = rel.manifest;
    files['update-manifest.json.sig'] = Buffer.from(rel.signature);
    // A release without an app update (e.g. a new OBS): the full installer.
    releases[1].assets = [];
    assert.equal((await make().check()).state, 'installer');
    reset();
    // A build without an update key only says that a new version exists.
    config('');
    s = await make().check();
    assert.equal(s.state, 'available');
    assert.equal(s.signed, false);
    // A build without a repository does not check.
    fs.writeFileSync(path.join(install, 'release-update.json'), '{ "repo": "", "publicKey": "" }');
    asked.length = 0;
    s = await make().check();
    assert.equal(s.state, 'error');
    assert.equal(asked.length, 0);
    // Downloads only from github.com.
    config(pub);
    releases[1].assets = Object.keys(files).map(n => ({
      name: n,
      browser_download_url: 'https://evil.example/' + n
    }));
    s = await make().check();
    assert.equal(s.state, 'error');
    assert.match(s.error, /Unexpected download address/);
    reset();
    // The automatic check setting is remembered.
    u = make();
    assert.throws(() => u.setAuto('no'), /Invalid/);
    assert.equal(u.setAuto(false).auto, false);
    assert.equal(make().status().auto, false);
    // The repo's own copy has no key and names the GitHub repository.
    const shipped = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../DesktopSource/release-update.json'), 'utf8')
    );
    assert.equal(shipped.publicKey, '');
    assert.equal(shipped.repo, 'JBug20/universalcollab-app');
    console.log(
      'PASS app updates: signed manifest, checked download, installed on close, rolled back, private files kept.'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
