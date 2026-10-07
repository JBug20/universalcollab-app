const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('relayDesktop', {
  layoutMedia: input => ipcRenderer.invoke('layout-media', input),
  browserSource: input => ipcRenderer.invoke('browser-source', input),
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
  copy: value => ipcRenderer.invoke('relay-copy', value),
  saveProfile: value => ipcRenderer.invoke('relay-save', value),
  loadProfile: () => ipcRenderer.invoke('relay-load'),
  clearProfile: () => ipcRenderer.invoke('relay-clear')
});
