'use strict';
const fs = require('node:fs'),
  path = require('node:path');
exports.uninstallTarget = ({ platform, execPath, home, dataHome, appImage = process.env.APPIMAGE }) => {
  const directory = path.dirname(execPath);
  if (platform === 'win32') {
    const executable = path.join(directory, 'Uninstall.exe');
    if (!fs.existsSync(executable))
      throw Error(
        'This is a portable copy. Close the app and delete its extracted folder to remove it. Saved settings are separate.'
      );
    return { kind: 'windows', executable };
  }
  if (platform === 'linux') {
    if (appImage)
      throw Error(
        'This is the AppImage version. Close the app and delete ' +
          path.basename(appImage) +
          ' to remove it (and its menu entry if you added one). Saved accounts and settings are kept separately.'
      );
    const base = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, '.local', 'share');
    const expected = path.join(base, 'stream-relay');
    if (
      directory !== expected ||
      fs.lstatSync(expected).isSymbolicLink() ||
      fs.realpathSync(expected) !== expected ||
      !fs.existsSync(path.join(expected, '.universalcollab-installed'))
    )
      throw Error(
        'This is a portable or older installation. Close the app and remove its extracted folder, or rerun this version’s install.sh to enable in-app uninstall.'
      );
    return {
      kind: 'linux',
      directory: expected,
      shortcut: path.join(base, 'applications', 'stream-relay.desktop')
    };
  }
  throw Error('Use your operating system to uninstall this app.');
};
exports.uninstall = async ({
  app,
  win,
  dialog,
  shell,
  platform = process.platform,
  execPath = process.execPath,
  dataHome = process.env.XDG_DATA_HOME
}) => {
  const target = exports.uninstallTarget({ platform, execPath, home: app.getPath('home'), dataHome });
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', 'Uninstall UniversalCollab'],
    defaultId: 0,
    cancelId: 0,
    message: 'Uninstall UniversalCollab?',
    detail:
      'The desktop app and its shortcuts will be removed and this window will close. Saved accounts and preferences are kept for reinstallation. OBS and your relay server, broadcasts and recordings are not removed.'
  });
  if (result.response !== 1) return { cancelled: true };
  if (target.kind === 'windows') {
    const error = await shell.openPath(target.executable);
    if (error) throw Error('The Windows uninstaller could not start. Use Windows Installed apps.');
  } else {
    fs.rmSync(target.directory, { recursive: true });
    fs.rmSync(target.shortcut, { force: true });
  }
  app.quit();
  return { uninstalling: true };
};
