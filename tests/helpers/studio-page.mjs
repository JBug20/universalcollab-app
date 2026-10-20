// Opens DesktopSource/portal.html in headless Chromium with a fake desktop bridge:
// a connected relay, a connected OBS with two audio inputs, and setup already completed.
// window.calls records every bridge call; window.emitOBS(event) sends an OBS event to the page.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
export async function openStudio({ viewport = { width: 1500, height: 1000 } } = {}) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport }),
    errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The app's stylesheets, as main.cjs hands them to theme.js.
  await page.addInitScript(
    styles => (window.fakeThemeStyles = styles),
    ['portal.css', 'studio-ui-v2.css', 'integrated-assist.css'].map(name => ({
      name,
      text: fs.readFileSync(new URL('../../DesktopSource/' + name, import.meta.url), 'utf8')
    }))
  );
  await page.addInitScript(() => {
    localStorage.setItem('uc-ui5-setup', 'true');
    window.calls = [];
    window.live = false;
    window.obsStreaming = false;
    window.settings = { overlays: [], fallback: [], fallbackTimeoutMinutes: 0 };
    let obsListener = null;
    window.emitOBS = e => obsListener?.(e);
    const mixer = [
      { inputName: 'Mic', inputVolumeDb: -6, inputVolumeMul: 0.5, inputMuted: false },
      { inputName: 'Desktop Audio', inputVolumeDb: 0, inputVolumeMul: 1, inputMuted: false }
    ];
    const account = { accounts: {}, configured: {}, auth: {}, chats: {}, messages: [] };
    window.relayDesktop = {
      loadServers: async () => ({
        schemaVersion: 1,
        selectedKey: 'one',
        servers: [
          {
            key: 'one',
            nickname: 'Home',
            id: 'alice',
            token: 'x'.repeat(32),
            address: 'http://127.0.0.1:25560'
          }
        ]
      }),
      saveServers: async () => {},
      loadLocalProfile: async () => ({ displayName: 'Bug' }),
      saveLocalProfile: async () => {},
      copy: async () => {},
      onPlatforms: () => {},
      platform: async (op, input) => {
        calls.push({ op, input });
        // Stream markers and the post-stream report.
        if (op === 'twitch-marker') {
          if (window.twitchMarkerFail) throw Error(window.twitchMarkerFail);
          return { position: 65 };
        }
        if (op === 'live-viewers') return window.fakeViewers || { twitch: null, youtube: null };
        return op === 'categories' || op === 'youtube-categories' || op === 'broadcasts' ? [] : account;
      },
      studio: async (op, input = {}) => {
        calls.push({ op, input });
        return { custom: [], drafts: [] };
      },
      onOBS: fn => {
        obsListener = fn;
        return () => {
          obsListener = null;
        };
      },
      // Stream Deck control: tests drive window.remoteCommand and read window.remoteReplies / remoteStateLast.
      remote: async input => {
        calls.push({ remote: input.op });
        return {
          ok: true,
          enabled: input.op === 'enable',
          port: 18750,
          clients: 0,
          paired: input.op === 'enable'
        };
      },
      onRemoteCommand: callback => {
        window.remoteCommand = callback;
      },
      remoteReply: result => (window.remoteReplies ||= []).push(result),
      remoteState: state => {
        window.remoteStateLast = state;
      },
      themeStyles: () => window.fakeThemeStyles,
      // End credits and alerts overlays: tests read window.overlayUpdates.
      overlays: async input => {
        calls.push({ overlays: input.op, input });
        if (input.op === 'update') (window.overlayUpdates ||= []).push(input);
        return {
          ok: true,
          data: {
            urls: {
              credits: 'http://127.0.0.1:18752/o/t/credits',
              alerts: 'http://127.0.0.1:18752/o/t/alerts'
            }
          }
        };
      },
      // Keyboard shortcuts: tests press keys with window.pressHotkey({ action, name }).
      hotkeys: async input => {
        calls.push({ hotkeys: input.op, input });
        window.hotkeyState ||= {
          enabled: false,
          keys: {
            clip: 'Ctrl+Alt+C',
            record: 'Ctrl+Alt+R',
            afk: 'Ctrl+Alt+A',
            'studio-mode': '',
            transition: 'Ctrl+Alt+T',
            mute: 'Ctrl+Alt+M'
          },
          muteSource: '',
          failed: [],
          actions: ['clip', 'record', 'afk', 'studio-mode', 'transition', 'mute']
        };
        if (input.op === 'set') {
          if ('enabled' in input) window.hotkeyState.enabled = input.enabled;
          if (input.keys) Object.assign(window.hotkeyState.keys, input.keys);
          if ('muteSource' in input) window.hotkeyState.muteSource = input.muteSource;
        }
        return { ok: true, data: window.hotkeyState };
      },
      onHotkey: callback => {
        window.pressHotkey = callback;
      },
      // Free space on this PC: tests set window.fakeDisk.
      diskSpace: async () =>
        window.fakeDisk ? { ok: true, data: window.fakeDisk } : { ok: false, error: 'n/a' },
      // App updates: tests set window.appUpdateState and push changes through window.appUpdatePush.
      appUpdate: async input => {
        calls.push({ appUpdate: input.op, input });
        if (input.op === 'backups')
          return { ok: true, data: window.fakeBackups || { restored: null, backups: [] } };
        if (input.op === 'restore-backup') return { ok: true, data: null };
        window.appUpdateState ||= {
          version: '1.2.0-preview.2',
          repo: 'JBug20/universalcollab-app',
          auto: true,
          signed: true,
          state: 'idle'
        };
        if (input.op === 'set-auto') window.appUpdateState.auto = input.auto;
        return { ok: true, data: window.appUpdateState };
      },
      onAppUpdate: callback => {
        window.appUpdatePush = callback;
      },
      // Vertical clips: tests set window.verticalFail (an error text).
      verticalClip: async input => {
        calls.push({ vertical: input });
        const push = d => window.verticalClipPush?.(d);
        const file = input.file.replace(/\.mp4$/, ' (vertical).mp4');
        push({ state: 'making', file: input.file, waiting: 0 });
        push({ state: 'progress', file: input.file, t: 42, d: 60, waiting: 1 });
        if (window.verticalFail) {
          push({ state: 'failed', file: input.file, error: window.verticalFail, waiting: 0 });
          return { ok: false, error: window.verticalFail };
        }
        if (window.verticalHold) await window.verticalHold;
        push({ state: 'done', file: input.file, out: file, name: file.split(/[\\/]/).pop(), waiting: 0 });
        return { ok: true, data: { file: file.split(/[\\/]/).pop(), path: file } };
      },
      onVerticalClip: fn => {
        window.verticalClipPush = fn;
      },
      // Post-stream reports: kept in window.fakeReports.
      streamReports: async input => {
        calls.push({ reports: input.op, input });
        window.fakeReports ||= [];
        if (input.op === 'save') {
          window.fakeReports.unshift({
            report: input.report,
            text: input.text,
            path: 'D:\\Rec\\Stream report.txt'
          });
          return { ok: true, data: { file: 'Stream report.txt', path: 'D:\\Rec\\Stream report.txt' } };
        }
        if (input.op === 'list')
          return {
            ok: true,
            data: window.fakeReports.map(r => ({
              id: r.report.id,
              title: r.report.title,
              startedAt: r.report.startedAt,
              endedAt: r.report.endedAt
            }))
          };
        const r = window.fakeReports.find(r => r.report.id === input.id);
        if (input.op === 'get')
          return { ok: true, data: { report: r.report, path: r.path, file: 'Stream report.txt' } };
        return { ok: true, data: {} };
      },
      // Go-live announcements: tests set window.fakeDiscord ({ id }) or window.announceFail (an error text).
      announce: async input => {
        calls.push({ announce: input.op, input });
        if (input.op === 'save-discord')
          window.fakeDiscord = { configured: true, id: '123456789', thread: false };
        if (input.op === 'remove-discord') window.fakeDiscord = null;
        if (input.op === 'post' && window.announceFail) return { ok: false, error: window.announceFail };
        return {
          ok: true,
          data: input.op === 'post' ? { posted: true } : { discord: window.fakeDiscord || null }
        };
      },
      obs: async (op, input = {}) => {
        calls.push({ obs: op, input });
        if (op === 'state' || op === 'connect' || op === 'auto-connect') return { connected: true };
        if (op === 'snapshot')
          return {
            connected: true,
            scenes: (window.fakeScenes || ['Main']).map(sceneName => ({ sceneName })),
            current: 'Main',
            sceneName: 'Main',
            items: [],
            inputs: mixer.map(m => ({ inputName: m.inputName })),
            mixer,
            stream: { outputActive: window.obsStreaming },
            record: {
              outputActive: !!window.obsRecording,
              outputPaused: !!window.obsPaused,
              outputDuration: window.obsRecording ? (window.recordMs ?? 90000) : 0,
              programActive: !!window.obsRecording && window.obsRecordingWhat !== 'scene',
              scene:
                window.obsRecording && input.recordScene && window.obsRecordingWhat !== 'program'
                  ? { scene: input.recordScene, active: true, since: Date.now() }
                  : null
            },
            available: []
          };
        if (op === 'start') {
          window.obsStreaming = true;
          return {};
        }
        if (op === 'stream-stop') {
          window.obsStreaming = false;
          return {};
        }
        if (op === 'readiness')
          return (
            window.fakeReadiness || {
              mode: 'Simple',
              encoder: 'x264',
              audioEncoder: '',
              video: { outputWidth: 1920, outputHeight: 1080, fpsNumerator: 60, fpsDenominator: 1 },
              streaming: !!window.obsStreaming,
              recording: !!window.obsRecording,
              replay: { supported: true, enabled: true, active: false },
              recordFolder: { ok: true, folder: 'D:\\Rec' }
            }
          );
        if (op === 'record-start') {
          window.obsRecording = true;
          window.obsRecordingWhat = input.recordScene ? input.recordWhat || 'program' : 'program';
          return {};
        }
        // Recording scene (Source Record): tests set window.fakeSourceRecord.
        if (op === 'scene-record-info')
          return {
            installed: true,
            page: 'https://obsproject.com/forum/resources/source-record.1285/',
            ...(window.fakeSourceRecord || {}),
            ...(input.recordScene ? { scene: input.recordScene, active: !!window.obsRecording } : {})
          };
        if (op === 'record-pause') {
          window.obsPaused = !window.obsPaused;
          return { paused: window.obsPaused };
        }
        if (op === 'record-split') {
          window.splits = (window.splits || 0) + 1;
          if (window.splitFail) throw Error(window.splitFail);
          return { program: true, scene: false };
        }
        // Clip: tests set window.clipPath for a saved clip.
        if (op === 'clip' && window.clipPath)
          return { supported: true, active: true, saved: true, path: window.clipPath };
        if (op === 'record-chapter') return { program: !!window.obsRecording, scene: false };
        if (op === 'record-stop') {
          window.obsRecording = false;
          window.obsPaused = false;
          return {};
        }
        if (op === 'preview') return { image: 'data:image/jpeg;base64,AAAA' };
        // OBS scene editor: tests set window.fakeEditor = { base, items } for the scene being edited.
        const fe = window.fakeEditor;
        const feItem = () => fe?.items.find(i => i.sceneItemId === input.id);
        if (op === 'editor-state')
          return { sceneName: input.sceneName, base: fe.base, items: structuredClone(fe.items) };
        if (op === 'scene-image') return { image: 'data:image/jpeg;base64,AAAA' };
        if (op === 'item-transform') {
          if (feItem().sceneItemLocked) throw Error('This source is locked. Unlock it to move or resize it.');
          Object.assign(feItem().sceneItemTransform, input.transform);
          return {};
        }
        if (fe && op === 'source-lock') feItem().sceneItemLocked = input.locked;
        if (fe && op === 'source-visible') feItem().sceneItemEnabled = input.enabled;
        if (op === 'settings')
          return {
            video: {
              baseWidth: 1920,
              baseHeight: 1080,
              outputWidth: 1920,
              outputHeight: 1080,
              fpsNumerator: 30,
              fpsDenominator: 1
            },
            // Tests set window.fakeRecordDir for OBS's recordings folder.
            record: window.fakeRecordDir ? { recordDirectory: window.fakeRecordDir } : null
          };
        return {};
      },
      request: async q => {
        calls.push(q);
        if (q.route.endsWith('/secrets'))
          return {
            obsServer: 'rtmp://secret/live',
            obsKey: 'SECRET',
            loginToken: 'x'.repeat(32),
            destinationBaseUrl: '',
            destinationStreamKey: ''
          };
        if (q.route.endsWith('/recordings')) return { items: [] };
        // Relay health: tests set window.fakeHealth.
        if (q.route.endsWith('/health') && window.fakeHealth) return window.fakeHealth;
        if (q.route.endsWith('/settings')) settings = { ...settings, ...q.body };
        if (q.route.endsWith('/end')) live = false;
        // Manual fallback ("Show fallback now", AFK).
        if (q.route.endsWith('/force-fallback')) window.forcedFallback = true;
        if (q.route.endsWith('/restore-primary')) window.forcedFallback = false;
        // 1.2.0 media-sources routes: frames for text, picture and browser sources.
        if (q.route.endsWith('/media-frame')) return { ok: true, accepted: (q.body?.frames || []).length };
        return {
          capabilities: {
            production: 1,
            verifiedProduction: 2,
            streamCanvas: 1,
            recording: true,
            multipleDestinations: true,
            pictureInPicture: true,
            chatOverlays: true,
            collaboratorFallback: true,
            manualFallback: true,
            fallbackTimeout: true,
            povLabels: true,
            streamHealth: true,
            // 1.2.0 relay: text, picture and browser sources (media-sources API).
            mediaSourcesApi: 1,
            mediaSources: true
          },
          me: { id: 'alice', settings, destinationConfigured: true },
          status: {
            state: live ? 'live' : 'ready',
            broadcast: live,
            held: false,
            forcedFallback: !!window.forcedFallback,
            source: window.forcedFallback ? 'fallback' : 'primary',
            pictureInPicture: true,
            collabFallback: true,
            width: 1920,
            height: 1080,
            fps: 30
          },
          peers: [
            { id: 'bob', online: true },
            { id: 'cat', online: true },
            { id: 'dan', online: true }
          ],
          requests: [
            { owner: 'alice', peer: 'bob', kind: 'fallback', status: 'approved' },
            // Picture-in-picture approvals, for layout tests.
            ...['bob', 'cat', 'dan'].map(peer => ({
              owner: 'alice',
              peer,
              kind: 'video',
              status: 'approved'
            }))
          ]
        };
      }
    };
  });
  await page.goto('file://' + new URL('../../DesktopSource/portal.html', import.meta.url).pathname);
  return { browser, page, errors };
}
