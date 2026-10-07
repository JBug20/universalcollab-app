// Status bar (relay health, OBS timers) and destination health icons, against both a relay that reports
// health (1.2.0) and one that does not (rc.8, the relay published on GitHub).
import assert from 'node:assert/strict';
import { openStudio } from './helpers/studio-page.mjs';

const healthReport = {
  cpu: { percent: 34, average10s: 34, cores: 4, source: 'container' },
  memory: { usedBytes: 2.1e9, limitBytes: 8e9, percent: 26 },
  network: { txMbps: 12.3, rxMbps: 1.1 },
  storage: { limitBytes: 5e9, freeBytes: 4.2e9, usedBytes: 0.8e9 },
  warnings: [{ level: 'warning', text: 'Twitch is reconnecting.' }],
  sessions: [
    {
      id: 'alice',
      state: 'live',
      width: 1920,
      height: 1080,
      fps: 59.8,
      targetFps: 60,
      outputs: [{ name: 'YouTube', state: 'sending', bitrateKbps: 6020, quality: 'source' }]
    }
  ],
  otherBroadcasts: 0
};
const outputs = [
  { id: 'youtube', name: 'YouTube', state: 'sending', bitrateKbps: 6020, fps: 60, reconnects: 0 },
  { id: 'twitch', name: 'Twitch', state: 'reconnecting', bitrateKbps: 0, fps: 0, reconnects: 2 }
];
// Runs in the page before the app starts. A 1.2.0 relay reports health and per-destination numbers.
const setup = ({ modern, outputs, healthReport }) => {
  window.live = true;
  window.statusExtra = modern ? { outputs, health: { uptimeSeconds: 754, outputFps: 59.8 } } : {};
  window.obsStreaming = true;
  window.obsStreamExtra = { outputDuration: 125000 };
  window.relayHook = async q => {
    if (q.route !== '/api/v3/health') return undefined;
    if (!modern) throw new Error('Server could not complete the request.');
    return { ...healthReport, at: Date.now() };
  };
};

async function open(modern) {
  const studio = await openStudio({ initScript: setup, initArg: { modern, outputs, healthReport } });
  await studio.page.evaluate(() => document.getElementById('serverConnect').click());
  await studio.page.waitForFunction(() => document.querySelector('#statusBar .status-seg.relay.ok'));
  return studio;
}

// Relay that reports health.
{
  const { browser, page, errors } = await open(true);
  try {
    await page.waitForFunction(() => /Relay CPU\s*34%/.test(document.getElementById('statusBar').innerText));
    const bar = await page.evaluate(() =>
      document.getElementById('statusBar').innerText.replace(/\s+/g, ' ')
    );
    for (const part of [
      'Relay connected',
      'LIVE',
      '59.8 fps',
      'Relay CPU 34%',
      'Upload 12.3 Mb/s',
      'My storage 3.9 GB free',
      '⚠ 1'
    ])
      assert(bar.includes(part), `status bar is missing "${part}": ${bar}`);
    assert(/STREAM 00:02:0\d/.test(bar), 'OBS stream timer missing: ' + bar);

    // The app messages live inside the bar rather than floating over the window.
    assert.equal(await page.evaluate(() => document.getElementById('notice').parentElement.id), 'statusBar');

    // Clicking the bar opens the details, with the warning.
    await page.locator('#statusBar .status-segments').click();
    await page.waitForFunction(() => document.getElementById('statusDetails').open);
    const details = await page.locator('#statusDetails').innerText();
    assert(details.includes('Twitch is reconnecting.') && details.includes('Your broadcast'), details);

    // Destination health icons: green, yellow and grey are really applied under the page's CSP.
    const colours = await page.evaluate(() =>
      [...document.querySelectorAll('#destinationHealthCard .destination-icons button svg')].map(
        svg => getComputedStyle(svg).fill
      )
    );
    assert.deepEqual(colours, ['rgb(62, 207, 110)', 'rgb(242, 194, 48)', 'rgb(125, 120, 137)']);

    // Losing OBS clears its timer.
    await page.evaluate(() => {
      window.obsDown = true;
      emitOBS({ type: 'connection', connected: false });
    });
    await page.waitForFunction(() => !/STREAM/.test(document.getElementById('statusBar').innerText), null, {
      timeout: 8000
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

// Relay that predates the health report: the app says so and keeps working.
{
  const { browser, page, errors } = await open(false);
  try {
    await page.waitForFunction(() =>
      /Update the relay for health/.test(document.getElementById('statusBar').innerText)
    );
    const bar = await page.evaluate(() => document.getElementById('statusBar').innerText);
    assert(!/Relay CPU/.test(bar), bar);
    await page.locator('#statusBar .status-segments').click();
    await page.waitForFunction(() => document.getElementById('statusDetails').open);
    assert((await page.locator('#statusDetails').innerText()).includes('does not report its health yet'));
    const colours = await page.evaluate(() =>
      [...document.querySelectorAll('#destinationHealthCard .destination-icons button svg')].map(
        svg => getComputedStyle(svg).fill
      )
    );
    assert.deepEqual(colours, ['rgb(125, 120, 137)', 'rgb(125, 120, 137)', 'rgb(125, 120, 137)']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
console.log(
  'PASS status bar and destination health with a 1.2.0 relay and with a relay that has no health report.'
);
