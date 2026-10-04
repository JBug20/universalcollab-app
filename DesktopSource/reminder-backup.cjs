const fs = require('node:fs'),
  path = require('node:path');
exports.validate = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100)
    throw Error('Invalid reminders');
  const result = {};
  for (const [key, v] of Object.entries(value)) {
    if (
      !/^[a-f0-9]{64}\.json$/.test(key) ||
      !v ||
      typeof v.text !== 'string' ||
      v.text.length > 500 ||
      !Number.isFinite(v.due) ||
      typeof v.notified !== 'boolean'
    )
      throw Error('Invalid reminder');
    result[key] = { text: v.text, due: v.due, notified: v.notified };
  }
  return result;
};
exports.read = directory => {
  if (!fs.existsSync(directory)) return {};
  const result = {};
  for (const name of fs.readdirSync(directory)) {
    if (/^[a-f0-9]{64}\.json$/.test(name)) {
      const file = path.join(directory, name);
      if (fs.statSync(file).size > 8192) throw Error('Invalid reminder');
      result[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  return exports.validate(result);
};
exports.write = (directory, value) => {
  const safe = exports.validate(value);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, v] of Object.entries(safe)) {
    const file = path.join(directory, name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(v));
    fs.renameSync(file + '.tmp', file);
  }
  for (const name of fs.readdirSync(directory))
    if (/^[a-f0-9]{64}\.json$/.test(name) && !Object.hasOwn(safe, name))
      fs.unlinkSync(path.join(directory, name));
};
