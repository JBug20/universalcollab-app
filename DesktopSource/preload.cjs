const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('relayDesktop', {
  relayVideo: input => ipcRenderer.invoke('relay-video', input),
  layoutMedia: input => ipcRenderer.invoke('layout-media', input),
  browserSource: input => ipcRenderer.invoke('browser-source', input),
  assist: input => ipcRenderer.invoke('integrated-assist', input),
  // Stream Deck control (remote-control.cjs / remote-control.js).
  remote: input => ipcRenderer.invoke('remote-control', input),
  onRemoteCommand: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('remote-command', fn);
    return () => ipcRenderer.removeListener('remote-command', fn);
  },
  remoteReply: result => ipcRenderer.send('remote-result', result),
  remoteState: state => ipcRenderer.send('remote-state', state),
  // App updates (app-update.cjs / app-update.js).
  appUpdate: input => ipcRenderer.invoke('app-update', input),
  onAppUpdate: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('app-update-state', fn);
    return () => ipcRenderer.removeListener('app-update-state', fn);
  },
  collaboration: input => ipcRenderer.invoke('notify-collaboration', input),
  maintenance: async op => {
    const r = await ipcRenderer.invoke('app-maintenance', op);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  onOBS: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('obs-event', fn);
    return () => ipcRenderer.removeListener('obs-event', fn);
  },
  obs: async (op, input = {}) => {
    const r = await ipcRenderer.invoke('obs-command', op, input);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  backup: async (op, input = {}) => {
    const r = await ipcRenderer.invoke('backup-command', op, input);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  studio: async (op, input = {}) => {
    const r = await ipcRenderer.invoke('studio-command', op, input);
    if (!r.ok) throw Object.assign(Error(r.error), { platform: r.platform, reconnect: r.reconnect });
    return r.data;
  },
  onStudioProgress: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('studio-progress', fn);
    return () => ipcRenderer.removeListener('studio-progress', fn);
  },
  platform: async (op, input = {}) => {
    const r = await ipcRenderer.invoke('platform-command', op, input);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  onPlatforms: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('platform-state', fn);
    return () => ipcRenderer.removeListener('platform-state', fn);
  },
  loadLocalProfile: () => ipcRenderer.invoke('local-profile-load'),
  saveLocalProfile: value => ipcRenderer.invoke('local-profile-save', value),
  loadServers: () => ipcRenderer.invoke('servers-load'),
  saveServers: v => ipcRenderer.invoke('servers-save', v),
  request: async input => {
    const r = await ipcRenderer.invoke('relay-request', input);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  relayUpdate: async input => {
    const r = await ipcRenderer.invoke('relay-update', input);
    if (!r.ok) throw Error(r.error);
    return r.data;
  },
  copy: value => ipcRenderer.invoke('relay-copy', value),
  saveProfile: value => ipcRenderer.invoke('relay-save', value),
  loadProfile: () => ipcRenderer.invoke('relay-load'),
  clearProfile: () => ipcRenderer.invoke('relay-clear')
});
