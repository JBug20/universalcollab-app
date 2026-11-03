// Closing and quitting always finish (1.2.0): closing the main window quits the app even with hidden helper windows
// open; a window that does not close (frozen or crashed page) is destroyed; crash recovery knows it is closing;
// quitting is forced after its deadline, still installing an update and reopening when asked.
const assert = require('node:assert/strict'),
  { EventEmitter } = require('node:events');
const { closeGuard, forceQuit } = require('../DesktopSource/shutdown.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
function fakeWindow({ closes = true } = {}) {
  const w = new EventEmitter();
  w.destroyed = false;
  w.isDestroyed = () => w.destroyed;
  w.destroy = () => {
    if (w.destroyed) return;
    w.destroyed = true;
    w.emit('closed');
  };
  // A healthy page lets the window close; a frozen one never does.
  w.close = () => {
    w.emit('close');
    if (closes) w.destroy();
  };
  return w;
}
(async () => {
  // Closing quits the app (helper windows do not keep it running).
  let app = {
    quits: 0,
    quit() {
      this.quits++;
    }
  };
  let w = fakeWindow();
  let g = closeGuard({ win: w, app, wait: 50 });
  assert.equal(g.closing(), false);
  w.close();
  assert.equal(app.quits, 1);
  assert.equal(g.closing(), true);

  // A frozen page: the window is destroyed after the wait, then the app quits.
  app = {
    quits: 0,
    quit() {
      this.quits++;
    }
  };
  const notes = [];
  w = fakeWindow({ closes: false });
  g = closeGuard({ win: w, app, wait: 50, note: t => notes.push(t) });
  w.close();
  assert.equal(w.destroyed, false);
  assert.equal(g.closing(), true, 'crash recovery must not reload it now');
  await wait(80);
  assert.equal(w.destroyed, true);
  assert.equal(app.quits, 1);
  assert.match(notes[0], /did not close/);
  // Closing twice starts one timer only.
  w = fakeWindow({ closes: false });
  closeGuard({ win: w, app: { quit() {} }, wait: 50 });
  w.emit('close');
  w.emit('close');
  assert.equal(w.listenerCount('close'), 1);

  // Quitting is forced after its deadline: the update is installed / reopen asked first; only one timer.
  const done = [];
  app = { exit: code => done.push('exit ' + code) };
  const soon = forceQuit({ app, wait: 50, before: () => done.push('update'), note: t => done.push(t) });
  soon();
  soon();
  await wait(80);
  assert.deepEqual(done, ['quit took too long: forced', 'update', 'exit 0']);
  // An error while installing the update does not stop the exit.
  const done2 = [];
  forceQuit({
    app: { exit: () => done2.push('exit') },
    wait: 10,
    before: () => {
      throw Error('x');
    }
  })();
  await wait(40);
  assert.deepEqual(done2, ['exit']);
  console.log(
    'PASS shutdown: closing quits, frozen window destroyed, no reload while closing, forced quit after deadline.'
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
