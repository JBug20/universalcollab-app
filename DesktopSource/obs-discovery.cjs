'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
exports.discover = ({ home = os.homedir(), env = process.env, platform = process.platform } = {}) => {
  const roots =
    platform === 'win32'
      ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obs-studio')]
      : platform === 'darwin'
        ? [path.join(home, 'Library/Application Support/obs-studio')]
        : [
            path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'obs-studio'),
            path.join(home, '.var/app/com.obsproject.Studio/config/obs-studio')
          ];
  for (const root of roots) {
    const file = path.join(root, 'plugin_config/obs-websocket/config.json');
    try {
      if (fs.statSync(file).size > 65536) continue;
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (c.server_enabled === false) continue;
      const port = c.server_port ?? 4455,
        password = c.auth_required === false ? '' : c.server_password;
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65535 &&
        typeof password === 'string' &&
        password.length <= 512
      )
        return { port, password };
    } catch {}
  }
  return null;
};
