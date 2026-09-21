const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexWidget", {
  refresh: () => ipcRenderer.invoke("quota:refresh"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setScale: (scale) => ipcRenderer.invoke("settings:setScale", scale),
  close: () => ipcRenderer.send("window:close"),
  onData: (callback) => ipcRenderer.on("quota:data", (_event, value) => callback(value)),
  onStatus: (callback) => ipcRenderer.on("quota:status", (_event, value) => callback(value)),
});
