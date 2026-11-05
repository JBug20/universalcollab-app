'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { currentPresence } = require('./notify-presence.cjs');
exports.validateReminder = input => {
  if (
    typeof input.text !== 'string' ||
    input.text.length > 500 ||
    !Number.isFinite(input.due) ||
    (input.text.trim() && input.due <= Date.now())
  )
    throw Error('Enter a reminder and a future date.');
  return { text: input.text.trim(), due: input.text.trim() ? input.due : 0, notified: false };
};
exports.start = ({ app, ipcMain, guard, servers }) => {
  const file =
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Notify', 'collab-presence.json')
      : null;
  const directory = path.join(app.getPath('userData'), 'collaboration-reminders');
  ipcMain.handle('notify-collaboration', (event, input = {}) => {
    guard(event);
    try {
      const saved = servers.load(),
        server = saved.servers.find(s => s.key === saved.selectedKey);
      if (!server) return { ok: true, connected: false, account: '', reminder: null };
      const account = crypto
          .createHash('sha256')
          .update(server.address + '\n' + server.id)
          .digest('hex'),
        target = path.join(directory, account + '.json');
      const write = value => {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(target + '.tmp', JSON.stringify(value), { mode: 0o600 });
        fs.renameSync(target + '.tmp', target);
      };
      let value = null,
        presence = null;
      try {
        if (file && fs.statSync(file).size <= 8192) {
          value = JSON.parse(fs.readFileSync(file, 'utf8'));
          presence = currentPresence(value, server);
        }
      } catch {}
      let reminder = null;
      if (fs.existsSync(target)) reminder = JSON.parse(fs.readFileSync(target, 'utf8'));
      else if (presence && typeof value.reminder === 'string') {
        reminder = {
          text: value.reminder.slice(0, 500),
          due: Number.isFinite(value.due) ? value.due : 0,
          notified: !!value.notified
        };
        write(reminder);
      }
      if (input.op === 'save') {
        if (input.account !== account) throw Error();
        reminder = exports.validateReminder(input);
        write(reminder);
      } else if (input.op === 'ack' && input.account === account && reminder && reminder.due === input.due) {
        reminder.notified = true;
        write(reminder);
      } else if (input.op && input.op !== 'snapshot' && input.op !== 'ack') throw Error('Unknown action.');
      return {
        ok: true,
        account,
        connected: !!presence?.connected,
        session: presence?.session || '',
        reminder
      };
    } catch {
      return {
        ok: false,
        error: 'Could not load or save collaboration settings. Check the reminder date and try again.'
      };
    }
  });
};
