'use strict';
// Recordings folder (1.2.0): where OBS saves recordings and clips. Before OBS is told to use a folder, it is created
// if needed and checked to be a folder this user can write to, so recordings never fail later without a word.
// OBS always runs on this PC (the app connects to it on 127.0.0.1), so the check is done here.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');

function check(dir) {
  const text = typeof dir === 'string' ? dir.trim() : '';
  if (!text) throw Error('Choose a folder for recordings.');
  if (text.length > 512 || /[\0<>"|?*]/.test(text.replace(/^[A-Za-z]:/, '')))
    throw Error('That is not a valid folder name.');
  if (!path.isAbsolute(text)) throw Error('Use a full folder path, for example D:\\Recordings.');
  const folder = path.resolve(text);
  try {
    fs.mkdirSync(folder, { recursive: true });
    if (!fs.statSync(folder).isDirectory()) throw Error('not a folder');
    const probe = path.join(folder, '.uc-write-test-' + crypto.randomBytes(4).toString('hex'));
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    throw Error(
      'Recordings cannot be saved in ' +
        folder +
        ' (' +
        (e.code === 'EACCES' || e.code === 'EPERM'
          ? 'no permission to write there'
          : e.code === 'ENOENT'
            ? 'the drive is not available'
            : e.code === 'EROFS'
              ? 'the drive is read-only'
              : e.message) +
        '). Choose another folder.'
    );
  }
  return folder;
}

exports.check = check;
