const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { uninstallTarget, uninstall } = require('../DesktopSource/maintenance.cjs');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-maintenance-'));
  try {
    const dir = path.join(root, 'share', 'stream-relay');
    fs.mkdirSync(dir, { recursive: true });
    const args = {
      platform: 'linux',
      execPath: path.join(dir, 'stream-relay'),
      home: root,
      dataHome: path.join(root, 'share')
    };
    assert.throws(() => uninstallTarget(args), /older installation/);
    fs.writeFileSync(path.join(dir, '.universalcollab-installed'), '');
    assert.equal(uninstallTarget(args).directory, dir);
    assert.throws(
      () => uninstallTarget({ ...args, execPath: path.join(root, 'portable', 'stream-relay') }),
      /portable/
    );
    const mock = {
      app: {
        getPath: () => root,
        quit: () => {
          throw Error('Must not quit on cancel');
        }
      },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      shell: {},
      ...args
    };
    assert.deepEqual(await uninstall(mock), { cancelled: true });
    assert(fs.existsSync(dir));
    console.log(
      'PASS uninstall target scope, portable-copy rejection, and cancel preserving files. No actual uninstall executed.'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
