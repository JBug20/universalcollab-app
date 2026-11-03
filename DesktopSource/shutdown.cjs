'use strict';
// Closing and quitting always finish (1.2.0), even after a crash.
// - closeGuard: closing the main window quits the app, even if hidden helper windows are open (vertical clip
//   copies, Notify pop-ups, browser sources); a window that has not closed some seconds after asked (a frozen or
//   crashed page) is destroyed; and `closing()` tells the crash recovery not to reload a window being closed.
// - forceQuit: once quitting has started, the app exits after a deadline whatever happens (a frozen OBS, an error
//   while closing), still installing a downloaded update and reopening when asked.
function closeGuard({ win, app, note = () => {}, wait = 5000 }) {
  let closing = false;
  win.on('close', () => {
    if (closing) return;
    closing = true;
    setTimeout(() => {
      if (!win.isDestroyed()) {
        note('window did not close in ' + wait / 1000 + ' seconds: destroyed');
        win.destroy();
      }
    }, wait);
  });
  win.on('closed', () => app.quit());
  return { closing: () => closing };
}
function forceQuit({ app, before = () => {}, note = () => {}, wait = 20000 }) {
  let timer = null;
  return function soon(ms = wait) {
    if (timer) return;
    timer = setTimeout(() => {
      note('quit took too long: forced');
      try {
        before();
      } catch {}
      app.exit(0);
    }, ms);
    timer.unref?.();
  };
}
module.exports = { closeGuard, forceQuit };
