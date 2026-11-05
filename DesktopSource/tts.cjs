'use strict';
// Chat voice (1.2.0), main process. Turns chat messages into speech files for the "everyone hears" setting:
// the computer's own voice (Windows speech, macOS "say", Linux espeak-ng) writes a small WAV file that the
// OBS browser source (overlays.cjs, /voice) plays, so OBS carries it into the stream with its own volume.
// "Streamer hears" needs none of this: the window speaks with the system voice directly (chat-voice.js).
// The message text goes to the voice program through its input or an environment variable, never in the command
// line, and is cut to 300 characters.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { execFile } = require('node:child_process');

const MAX_TEXT = 300,
  KEEP = 30,
  TIMEOUT = 20000;

// The command for this system. `input` is what is fed to the program's standard input, `env` extra variables.
function plan(platform, text, out) {
  if (platform === 'win32')
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
          '$s.SetOutputToWaveFile($env:UC_TTS_OUT); $s.Speak($env:UC_TTS_TEXT); $s.Dispose()'
      ],
      env: { UC_TTS_OUT: out, UC_TTS_TEXT: text }
    };
  if (platform === 'darwin')
    return {
      command: 'say',
      args: ['-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', '-'],
      input: text
    };
  return {
    commands: ['espeak-ng', 'espeak'],
    args: ['-w', out, '--stdin'],
    input: text
  };
}

// Plain text for speaking: links become "link", control characters go, spaces are tidied.
function speakable(text) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/gi, ' link ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function run(file, args, { input, env }) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: TIMEOUT, windowsHide: true, env: { ...process.env, ...env } },
      (error, _out, errText) => (error ? reject(Object.assign(error, { stderr: errText })) : resolve())
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}

function create({ dir, platform = process.platform, exec = run }) {
  const items = []; // { id, seq, volume, file }
  let seq = 0,
    chain = Promise.resolve();
  const find = id => items.find(i => i.id === id);

  async function synthesize(text, out) {
    const p = plan(platform, text, out);
    if (p.commands) {
      let last;
      for (const command of p.commands) {
        try {
          return await exec(command, p.args, p);
        } catch (e) {
          last = e;
          if (e.code !== 'ENOENT') throw e;
        }
      }
      throw Object.assign(Error('No text-to-speech voice found. On Linux, install espeak-ng.'), {
        cause: last
      });
    }
    return exec(p.command, p.args, p);
  }
  function prune() {
    while (items.length > KEEP) {
      const old = items.shift();
      fs.rm(old.file, { force: true }, () => {});
    }
  }
  // One message at a time, so speech files appear in the order the messages came.
  function speak(text, volume) {
    const clean = speakable(text);
    if (!clean) return Promise.resolve({ queued: false });
    const run1 = async () => {
      fs.mkdirSync(dir, { recursive: true });
      const id = crypto.randomBytes(9).toString('base64url'),
        file = path.join(dir, id + '.wav');
      try {
        await synthesize(clean, file);
      } catch (e) {
        fs.rmSync(file, { force: true });
        throw Object.assign(
          Error(
            e.message && /text-to-speech/i.test(e.message)
              ? e.message
              : 'The computer’s voice could not make that speech.'
          ),
          { cause: e }
        );
      }
      if (!fs.existsSync(file)) throw Error('The computer’s voice made no sound file.');
      items.push({
        id,
        seq: ++seq,
        volume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1)),
        file
      });
      prune();
      return { queued: true };
    };
    const result = chain.then(run1, run1);
    chain = result.catch(() => {});
    return result;
  }
  return {
    speak,
    // What the OBS page sees: ids, order and volume only.
    queue: () => items.map(({ id, seq: n, volume }) => ({ id, seq: n, volume })),
    audio: id => {
      const item = /^[A-Za-z0-9_-]{6,24}$/.test(id || '') ? find(id) : null;
      try {
        return item ? fs.readFileSync(item.file) : null;
      } catch {
        return null;
      }
    },
    clear: () => {
      for (const i of items.splice(0)) fs.rm(i.file, { force: true }, () => {});
    }
  };
}

exports.plan = plan;
exports.speakable = speakable;
exports.create = create;
exports.MAX_TEXT = MAX_TEXT;
exports.start = ({ app, ipcMain, guard }) => {
  const voice = create({ dir: path.join(app.getPath('temp'), 'universalcollab-chat-voice') });
  ipcMain.handle('chat-voice', async (e, input = {}) => {
    guard(e);
    try {
      if (input.op === 'speak')
        return { ok: true, data: await voice.speak(input.text, Number(input.volume)) };
      if (input.op === 'clear') {
        voice.clear();
        return { ok: true, data: {} };
      }
      return { ok: false, error: 'Unknown request.' };
    } catch (error) {
      return { ok: false, error: error.message || 'Chat voice failed.' };
    }
  });
  app.on('will-quit', () => voice.clear());
  return voice;
};
