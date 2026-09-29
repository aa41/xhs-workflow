import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BackendStatus, ServiceNotification, ServiceRequest, ServiceResponse } from "../shared/contracts.js";

const directory = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let child: ChildProcess | null = null;
let status: BackendStatus = { state: "stopped" };
let nextId = 1;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
let starting: Promise<BackendStatus> | null = null;
let quitting = false;

const dataDir = () => join(app.getPath("userData"), "backend");
const marker = () => join(dataDir(), "deployed.json");
const broadcast = (event: string, data: unknown) => {
  if (window && !window.isDestroyed()) window.webContents.send("workbench:event", { event, data } satisfies ServiceNotification);
};

async function deploy(): Promise<BackendStatus> {
  if (status.state === "running") return status;
  if (starting) return starting;
  starting = new Promise<BackendStatus>((resolve, reject) => {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    status = { state: "starting", dataDir: dataDir() };
    broadcast("backend.status", status);
    const script = join(directory, "service.mjs");
    const processHandle = fork(script, [dataDir()], {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child = processHandle;
    processHandle.stdout?.resume();
    processHandle.stderr?.resume();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      processHandle.kill();
      status = { state: "error", error: "后端启动超时", dataDir: dataDir() };
      reject(new Error(status.error));
      starting = null;
      broadcast("backend.status", status);
    }, 45_000);
    processHandle.on("message", (message: ServiceResponse | ServiceNotification) => {
      if ("event" in message) {
        if (message.event === "backend.ready" && !settled) {
          settled = true;
          clearTimeout(timer);
          status = { state: "running", pid: processHandle.pid, dataDir: dataDir() };
          writeFileSync(marker(), JSON.stringify({ version: app.getVersion() }), { mode: 0o600 });
          starting = null;
          resolve(status);
          broadcast("backend.status", status);
        } else broadcast(message.event, message.data);
      } else {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.result);
      }
    });
    processHandle.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      starting = null;
      status = { state: "error", error: error.message, dataDir: dataDir() };
      reject(error);
      broadcast("backend.status", status);
    });
    processHandle.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        starting = null;
        reject(new Error(`后端退出：${code ?? "unknown"}`));
      }
      if (child === processHandle) {
        child = null;
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("后端已停止"));
        }
        pending.clear();
        status = { state: quitting ? "stopped" : "error", error: quitting ? undefined : `后端退出：${code ?? "unknown"}`, dataDir: dataDir() };
        broadcast("backend.status", status);
      }
    });
  });
  return starting;
}

async function stop(): Promise<void> {
  const processHandle = child;
  if (!processHandle) return;
  child = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("后端正在重启"));
  }
  pending.clear();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => { processHandle.kill("SIGKILL"); resolve(); }, 3000);
    processHandle.once("exit", () => { clearTimeout(timeout); resolve(); });
    processHandle.disconnect();
  });
  status = { state: "stopped", dataDir: dataDir() };
  broadcast("backend.status", status);
}

function request(method: string, payload: unknown): Promise<unknown> {
  if (!child || status.state !== "running") throw new Error("后端未部署，请先点击一键部署");
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeoutMs = method === "images.generate" || method === "images.responses" ? 200_000 : 90_000;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("后端响应超时")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child!.send({ id, method, payload } satisfies ServiceRequest, (error) => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    title: "IndieOps Workbench",
    backgroundColor: "#f5f4f0",
    webPreferences: { preload: join(directory, "preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ipcMain.handle("workbench:call", async (_event, method: unknown, payload: unknown) => {
    if (typeof method !== "string" || method.length > 100) throw new Error("无效操作");
    if (method === "backend.status") return status;
    if (method === "backend.deploy") return deploy();
    if (method === "backend.restart") { await stop(); return deploy(); }
    if (method === "clipboard.writeText") {
      if (typeof payload !== "string" || !payload.trim() || payload.length > 20_000) throw new Error("复制内容无效");
      clipboard.writeText(payload);
      return true;
    }
    if (method === "images.reveal" || method === "images.revealGenerated") {
      const path = await request(method, payload);
      if (typeof path !== "string") throw new Error("图片位置无效");
      shell.showItemInFolder(path);
      return true;
    }
    if (method === "images.projectFolder") {
      const path = await request(method, payload);
      if (typeof path !== "string") throw new Error("图片目录无效");
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
      return true;
    }
    if (method === "dialog.pickRepository" || method === "dialog.pickSkill" || method === "dialog.pickImage") {
      const choice = await dialog.showOpenDialog(window!, {
        properties: method === "dialog.pickRepository" ? ["openDirectory"] : method === "dialog.pickImage" ? ["openFile"] : ["openFile", "openDirectory"],
        ...(method === "dialog.pickImage" ? { filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] } : {}),
      });
      return choice.canceled ? null : choice.filePaths[0];
    }
    return request(method, payload);
  });
  await window.loadFile(join(directory, "renderer", "index.html"));
  if (existsSync(marker())) void deploy().catch(() => {});
});

app.on("before-quit", () => { quitting = true; if (child) child.disconnect(); });
app.on("window-all-closed", () => { app.quit(); });
