const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('assist', {
  showChat: fn => ipcRenderer.on('showChat', fn),
  action: (name, data) => ipcRenderer.invoke('action', name, data),
  state: fn => ipcRenderer.on('state', (_, state) => fn(state)),
  sound: fn => ipcRenderer.on('sound', (_, sound) => fn(sound))
});
