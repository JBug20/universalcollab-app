'use strict';
// New OBS sources from UniversalCollab (1.2.0): webcam, screen, window, game capture, microphone, desktop audio,
// image, media file, text and browser source. OBS names its source kinds per platform (and version), so each type
// lists the kinds to try; the first one this OBS has is used. After creating, the source's own list of devices
// (cameras, screens, windows, microphones) is offered so the right one can be picked without opening OBS.
const fs = require('node:fs'),
  path = require('node:path');

const TYPES = {
  webcam: {
    label: 'Webcam or capture card',
    kinds: ['dshow_input', 'v4l2_input', 'av_capture_input_v2', 'av_capture_input', 'macos-avcapture'],
    choose: ['video_device_id', 'device_id', 'device']
  },
  display: {
    label: 'Screen (display capture)',
    kinds: [
      'monitor_capture',
      'pipewire-screen-capture-source',
      'xshm_input_v2',
      'xshm_input',
      'screen_capture',
      'display_capture'
    ],
    choose: ['monitor_id', 'monitor', 'screen', 'display']
  },
  window: {
    label: 'Window capture',
    kinds: ['window_capture', 'pipewire-window-capture-source', 'xcomposite_input'],
    choose: ['window', 'capture_window']
  },
  game: {
    label: 'Game capture (any full-screen game)',
    kinds: ['game_capture'],
    settings: () => ({ capture_mode: 'any_fullscreen' }),
    choose: []
  },
  mic: {
    label: 'Microphone',
    kinds: ['wasapi_input_capture', 'pulse_input_capture', 'coreaudio_input_capture'],
    choose: ['device_id']
  },
  desktop: {
    label: 'Desktop audio',
    kinds: ['wasapi_output_capture', 'pulse_output_capture', 'coreaudio_output_capture'],
    choose: ['device_id']
  },
  image: {
    label: 'Image',
    kinds: ['image_source'],
    file: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tga'],
    settings: i => ({ file: i.file }),
    choose: []
  },
  media: {
    label: 'Video or audio file',
    kinds: ['ffmpeg_source'],
    file: ['mp4', 'mkv', 'mov', 'webm', 'flv', 'ts', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
    settings: i => ({ local_file: i.file, looping: true, restart_on_activate: true }),
    choose: []
  },
  text: {
    label: 'Text',
    kinds: ['text_gdiplus_v3', 'text_gdiplus_v2', 'text_gdiplus', 'text_ft2_source_v2', 'text_ft2_source'],
    settings: i => ({ text: text(i.text, 2000) || 'Text' }),
    choose: []
  },
  browser: {
    label: 'Browser source (web page)',
    kinds: ['browser_source'],
    settings: i => ({
      url: url(i.url),
      width: int(i.width, 1920, 1, 7680),
      height: int(i.height, 1080, 1, 4320)
    }),
    choose: []
  }
};
// Every property a device can be chosen with: nothing else can be set through source-choose.
const CHOOSABLE = new Set(Object.values(TYPES).flatMap(t => t.choose));

function text(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function int(v, fallback, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function url(v) {
  let u;
  try {
    u = new URL(String(v || '').trim());
  } catch {
    throw Error('Enter the web address of the page, for example https://…');
  }
  if (!['http:', 'https:'].includes(u.protocol))
    throw Error('Browser sources need an http or https address.');
  return u.href;
}
function sourceName(v) {
  const n = typeof v === 'string' ? v.trim() : '';
  if (!n || n.length > 256) throw Error('Give the new source a name.');
  return n;
}
// A file for an image or media source: it must exist and have the right kind of extension.
function file(type, v) {
  const t = TYPES[type];
  const f = typeof v === 'string' ? v : '';
  if (!f || !path.isAbsolute(f) || !fs.existsSync(f) || !fs.statSync(f).isFile())
    throw Error('Choose the file for this source.');
  if (!t.file.includes(path.extname(f).slice(1).toLowerCase()))
    throw Error('That kind of file cannot be used for this source.');
  return f;
}

// Which types this OBS can make: [{ type, label, kind }].
function available(inputKinds) {
  const have = new Set(inputKinds || []);
  return Object.entries(TYPES)
    .map(([type, t]) => ({ type, label: t.label, kind: t.kinds.find(k => have.has(k)) }))
    .filter(t => t.kind);
}

module.exports = {
  TYPES,
  CHOOSABLE,
  available,
  file,
  sourceName,
  settingsFor: (type, i) => TYPES[type].settings?.(i) || {}
};
