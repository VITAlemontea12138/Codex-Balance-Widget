import { app, BrowserWindow, ipcMain } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RateLimitClient } from "./rate-limit-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_WIDTH = 340;
const BASE_HEIGHT = 400;

let widgetWindow = null;
let latestData = null;
let latestStatus = { kind: "connecting", message: "正在启动" };
let lastCodexBounds = null;
let rightGap = 16;
let bottomGap = 26;
let movingProgrammatically = false;
let followBusy = false;
let followTimer = null;
let widgetScale = 1;

const rateClient = new RateLimitClient({ command: resolveCodexExecutable() });

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!widgetWindow) return;
    widgetWindow.showInactive();
    widgetWindow.moveTop();
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("io.github.VITAlemontea12138.codex-balance-widget");
  widgetScale = loadWidgetSettings().scale;
  createWindow();
  wireRateClient();
  rateClient.start();
  startFollowingCodex();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  clearInterval(followTimer);
  rateClient.stop();
});

ipcMain.handle("quota:refresh", async () => {
  latestStatus = { kind: "refreshing", message: "正在刷新" };
  sendToRenderer("quota:status", latestStatus);
  return rateClient.refresh();
});

ipcMain.handle("settings:get", () => ({ scale: widgetScale }));
ipcMain.handle("settings:setScale", (_event, value) => {
  const nextScale = clamp(Number(value), 0.7, 1.4);
  widgetScale = nextScale;
  resizeWidget(nextScale);
  saveWidgetSettings({ scale: nextScale });
  return { scale: nextScale };
});

ipcMain.on("window:close", () => app.quit());

function createWindow() {
  const size = scaledWindowSize();
  widgetWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  widgetWindow.setAlwaysOnTop(true, "floating");
  widgetWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  widgetWindow.once("ready-to-show", () => widgetWindow?.showInactive());

  widgetWindow.webContents.on("did-finish-load", () => {
    sendToRenderer("quota:status", latestStatus);
    if (latestData) sendToRenderer("quota:data", latestData);
  });

  widgetWindow.on("move", () => {
    if (movingProgrammatically || !lastCodexBounds || !widgetWindow) return;
    const bounds = widgetWindow.getBounds();
    rightGap = lastCodexBounds.right - (bounds.x + bounds.width);
    bottomGap = lastCodexBounds.bottom - (bounds.y + bounds.height);
  });
}

function wireRateClient() {
  rateClient.on("data", (data) => {
    latestData = data;
    sendToRenderer("quota:data", data);
  });
  rateClient.on("status", (status) => {
    latestStatus = status;
    sendToRenderer("quota:status", status);
  });
}

function sendToRenderer(channel, value) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  widgetWindow.webContents.send(channel, value);
}

function startFollowingCodex() {
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, "scripts", "get-codex-window.ps1")
    : path.join(__dirname, "..", "scripts", "get-codex-window.ps1");
  const check = () => {
    if (followBusy || !widgetWindow || widgetWindow.isDestroyed()) return;
    followBusy = true;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true, timeout: 3_000 },
      (error, stdout) => {
        followBusy = false;
        if (error || !stdout.trim()) {
          widgetWindow?.hide();
          return;
        }

        let target;
        try {
          target = JSON.parse(stdout.trim());
        } catch {
          return;
        }

        if (!target.visible || target.minimized) {
          widgetWindow?.hide();
          return;
        }

        lastCodexBounds = target;
        const size = scaledWindowSize();
        const x = Math.round(target.right - size.width - rightGap);
        const y = Math.round(target.bottom - size.height - bottomGap);
        const current = widgetWindow.getBounds();
        if (current.x !== x || current.y !== y) {
          movingProgrammatically = true;
          widgetWindow.setPosition(x, y, false);
          setTimeout(() => { movingProgrammatically = false; }, 50);
        }
        if (!widgetWindow.isVisible()) widgetWindow.showInactive();
      },
    );
  };

  check();
  followTimer = setInterval(check, 800);
}

function scaledWindowSize(scale = widgetScale) {
  return {
    width: Math.round(BASE_WIDTH * scale),
    height: Math.round(BASE_HEIGHT * scale),
  };
}

function resizeWidget(scale) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const current = widgetWindow.getBounds();
  const size = scaledWindowSize(scale);
  movingProgrammatically = true;
  widgetWindow.setBounds({
    x: current.x + current.width - size.width,
    y: current.y + current.height - size.height,
    width: size.width,
    height: size.height,
  }, false);
  setTimeout(() => { movingProgrammatically = false; }, 80);
}

function settingsPath() {
  return path.join(app.getPath("userData"), "widget-settings.json");
}

function loadWidgetSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { scale: clamp(Number(parsed.scale), 0.7, 1.4) };
  } catch {
    return { scale: 1 };
  }
}

function saveWidgetSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // A settings write failure must not stop the live quota widget.
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, value));
}

function resolveCodexExecutable() {
  if (process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)) {
    return process.env.CODEX_CLI_PATH;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    try {
      const candidates = fs.readdirSync(binRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binRoot, entry.name, "codex.exe"))
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => ({ candidate, modified: fs.statSync(candidate).mtimeMs }))
        .sort((a, b) => b.modified - a.modified);
      if (candidates.length) return candidates[0].candidate;
    } catch {
      // Fall through to PATH for CLI-only installations.
    }
  }

  return "codex";
}
