'use strict';
// Electron entry point. On Linux the same executable also runs the integrated Stream Assist
// engine (assist-linux/, started by assist-engine.cjs with --uc-assist-engine); otherwise this
// loads the UniversalCollab app (main.cjs).
if (process.platform === 'linux' && process.argv.includes('--uc-assist-engine'))
  require('./assist-linux/main.cjs');
else require('./main.cjs');
