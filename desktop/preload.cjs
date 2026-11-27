// The few things the game page may ask of the desktop app: host a multiplayer
// world on this computer, stop it, and go back to single player.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sovDesktop', {
  host: (game) => ipcRenderer.invoke('host:start', game), // game: the create-game screen's choices for a new world
  stopHost: () => ipcRenderer.invoke('host:stop'),
  hosting: () => ipcRenderer.invoke('host:status'),
  lastHosted: () => ipcRenderer.invoke('host:last'),
  singlePlayer: () => ipcRenderer.invoke('app:single'),
});
