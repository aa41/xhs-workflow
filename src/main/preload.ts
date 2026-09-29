import { contextBridge, ipcRenderer } from "electron";
import type { ServiceNotification, WorkbenchBridge } from "../shared/contracts.js";

const bridge: WorkbenchBridge = {
  call: (method, payload) => ipcRenderer.invoke("workbench:call", method, payload),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, notification: ServiceNotification) => callback(notification);
    ipcRenderer.on("workbench:event", listener);
    return () => ipcRenderer.removeListener("workbench:event", listener);
  },
};

contextBridge.exposeInMainWorld("workbench", bridge);
