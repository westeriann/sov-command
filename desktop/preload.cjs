// The few things the game page may ask of the desktop app: host a multiplayer
// world on this computer, stop it, and go back to single player.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sovDesktop', {
  host: () => ipcRenderer.invoke('host:start'),
  stopHost: () => ipcRenderer.invoke('host:stop'),
  hosting: () => ipcRenderer.invoke('host:status'),
  singlePlayer: () => ipcRenderer.invoke('app:single'),
});
