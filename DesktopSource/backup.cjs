'use strict';
const crypto = require('node:crypto');
const MAX = 8 * 1024 * 1024;
const password = p => {
  if (typeof p !== 'string' || p.length < 12 || p.length > 1024)
    throw Error('Use a backup password of at least 12 characters.');
};
exports.seal = (value, p) => {
  password(p);
  const plain = Buffer.from(JSON.stringify(value));
  if (plain.length > MAX) throw Error('Backup is too large.');
  const salt = crypto.randomBytes(16),
    iv = crypto.randomBytes(12),
    key = crypto.scryptSync(p, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('UniversalCollab backup v1'));
    return JSON.stringify({
      format: 'UniversalCollab',
      version: 1,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: (() => {
        const data = Buffer.concat([cipher.update(plain), cipher.final()]);
        value = data.toString('base64');
        return cipher.getAuthTag().toString('base64');
      })(),
      data: value
    });
  } finally {
    key.fill(0);
    plain.fill(0);
  }
};
exports.open = (text, p) => {
  password(p);
  if (typeof text !== 'string' || text.length > MAX * 2) throw Error('Invalid backup.');
  try {
    const v = JSON.parse(text);
    if (v.format !== 'UniversalCollab' || v.version !== 1) throw Error();
    const salt = Buffer.from(v.salt, 'base64'),
      iv = Buffer.from(v.iv, 'base64'),
      tag = Buffer.from(v.tag, 'base64'),
      data = Buffer.from(v.data, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || data.length > MAX) throw Error();
    const key = crypto.scryptSync(p, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from('UniversalCollab backup v1'));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]);
      try {
        return JSON.parse(plain.toString());
      } finally {
        plain.fill(0);
      }
    } finally {
      key.fill(0);
    }
  } catch {
    throw Error('Wrong password, damaged backup, or unsupported backup format.');
  }
};
exports.workspaceKeys = [
  'universalcollab-stream-profiles-v2',
  'uc-collaboration-placement-v1',
  'uc-ui8-workspace',
  'uc-ui8-dock-sizes',
  'uc-ui8-panel-weights',
  'uc-ui7-workspace',
  'uc-ui7-dock-sizes',
  'uc-ui7-obs-retry',
  'uc-ui7-obs-paired',
  'uc-ui6-preview',
  'uc-ui5-setup',
  'uc-ui5-scenes',
  'uc-ui5-workspace',
  'uc-ui5-workspace-presets',
  'uc-ui5-obs-mode',
  'uc-ui5-collab-explained',
  'universalcollab-panel-groups-v2',
  'universalcollab-workspace-v1',
  'universalcollab-app-presets-v1',
  'universalcollab-stream-presets-v1',
  'universalcollab-chat-ui-v1',
  'universalcollab-tools-v1',
  'universalcollab-offline-layout-v1'
];
exports.workspace = v => {
  const result = {};
  for (const k of exports.workspaceKeys)
    if (v?.[k] !== undefined) {
      if (typeof v[k] !== 'string' || v[k].length > 500000) throw Error('Invalid workspace settings.');
      JSON.parse(v[k]);
      result[k] = v[k];
    }
  return result;
};
exports.validatePlatforms = v => {
  if (!v || v.version !== 1 || !v.clients || !v.accounts || JSON.stringify(v).length > 3000000)
    throw Error('Invalid platform backup.');
  for (const [p, c] of Object.entries(v.clients)) {
    if (
      !['twitch', 'youtube'].includes(p) ||
      typeof c.clientId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,256}$/.test(c.clientId) ||
      (c.clientSecret !== undefined && (typeof c.clientSecret !== 'string' || c.clientSecret.length > 256))
    )
      throw Error('Invalid platform settings.');
  }
  for (const [p, a] of Object.entries(v.accounts))
    if (
      !['twitch', 'youtube'].includes(p) ||
      !v.clients[p] ||
      typeof a.id !== 'string' ||
      typeof a.accessToken !== 'string' ||
      (a.refreshToken !== undefined && typeof a.refreshToken !== 'string')
    )
      throw Error('Invalid platform login.');
  return v;
};
