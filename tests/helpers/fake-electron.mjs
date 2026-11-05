// Wraps a test's fake Electron so the parts a test does not care about (single-instance lock, version, tray,
// global shortcuts, power monitor, ...) exist as harmless do-nothing functions. main.cjs asks Electron for many
// more things than each test needs; only the members a test lists are real.
const nothing = () =>
  new Proxy(function () {}, {
    get: (_t, key) => (typeof key === 'symbol' || key === 'then' ? undefined : nothing()),
    apply: () => undefined,
    construct: () => ({})
  });
const lenient = object =>
  new Proxy(object, {
    get: (target, key) =>
      key in target ? target[key] : typeof key === 'symbol' || key === 'then' ? undefined : nothing()
  });
export const lenientElectron = electron =>
  lenient({
    ...electron,
    app: lenient(electron.app || {}),
    ipcMain: lenient(electron.ipcMain || {}),
    session: lenient(electron.session || {}),
    protocol: lenient(electron.protocol || {})
  });
