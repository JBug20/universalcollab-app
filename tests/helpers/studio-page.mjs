// Opens DesktopSource/portal.html in headless Chromium with a fake desktop bridge:
// a connected relay, a connected OBS with two audio inputs, and setup already completed.
// window.calls records every bridge call; window.emitOBS(event) sends an OBS event to the page.
import { createRequire } from 'node:module';
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
      // App updates: tests set window.appUpdateState and push changes through window.appUpdatePush.
      appUpdate: async input => {
        calls.push({ appUpdate: input.op, input });
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
      obs: async (op, input = {}) => {
        calls.push({ obs: op, input });
        if (op === 'state' || op === 'connect' || op === 'auto-connect') return { connected: true };
        if (op === 'snapshot')
          return {
            connected: true,
            scenes: [{ sceneName: 'Main' }],
            current: 'Main',
            sceneName: 'Main',
            items: [],
            inputs: mixer.map(m => ({ inputName: m.inputName })),
            mixer,
            stream: { outputActive: window.obsStreaming },
            record: { outputActive: false },
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
        if (op === 'preview') return { image: 'data:image/jpeg;base64,AAAA' };
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
            record: null
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
        if (q.route.endsWith('/settings')) settings = { ...settings, ...q.body };
        if (q.route.endsWith('/end')) live = false;
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
            streamHealth: true
          },
          me: { id: 'alice', settings, destinationConfigured: true },
          status: {
            state: live ? 'live' : 'ready',
            broadcast: live,
            held: false,
            pictureInPicture: true,
            collabFallback: true,
            width: 1920,
            height: 1080,
            fps: 30
          },
          peers: [{ id: 'bob', online: true }],
          requests: [{ owner: 'alice', peer: 'bob', kind: 'fallback', status: 'approved' }]
        };
      }
    };
  });
  await page.goto('file://' + new URL('../../DesktopSource/portal.html', import.meta.url).pathname);
  return { browser, page, errors };
}
