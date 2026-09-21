import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

const POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class RateLimitClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.command = options.command ?? "codex";
    this.process = null;
    this.reader = null;
    this.nextId = 1;
    this.pendingRefresh = null;
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.stopping = false;
    this.initialized = false;
  }

  start() {
    this.stopping = false;
    this.#spawnServer();
  }

  async refresh() {
    if (!this.process || !this.initialized) {
      throw new Error("Codex 数据服务尚未连接");
    }

    if (this.pendingRefresh) return this.pendingRefresh.promise;

    const id = this.nextId++;
    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timeout = setTimeout(() => {
      if (this.pendingRefresh?.id !== id) return;
      this.pendingRefresh = null;
      rejectRequest(new Error("读取额度超时"));
    }, REQUEST_TIMEOUT_MS);

    this.pendingRefresh = { id, promise, resolveRequest, rejectRequest, timeout };
    this.#send({ method: "account/rateLimits/read", id, params: {} });
    return promise;
  }

  stop() {
    this.stopping = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.reconnectTimer);
    this.#rejectPending(new Error("数据服务已停止"));
    this.reader?.close();
    this.process?.kill();
    this.reader = null;
    this.process = null;
    this.initialized = false;
  }

  #spawnServer() {
    clearTimeout(this.reconnectTimer);
    this.emit("status", { kind: "connecting", message: "正在连接 Codex" });

    const proc = spawn(this.command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = proc;
    this.initialized = false;

    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });

    proc.on("error", (error) => this.#handleDisconnect(error.message));
    proc.on("exit", (code) => {
      if (!this.stopping) {
        const detail = stderr.trim() || `退出码 ${code}`;
        this.#handleDisconnect(`Codex 数据服务已断开：${detail}`);
      }
    });

    this.reader = readline.createInterface({ input: proc.stdout });
    this.reader.on("line", (line) => this.#handleLine(line));

    const initializeId = this.nextId++;
    this.initializeId = initializeId;
    this.#send({
      method: "initialize",
      id: initializeId,
      params: {
        clientInfo: {
          name: "codex_balance_widget",
          title: "Codex Balance Widget",
          version: "0.1.0",
        },
      },
    });
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id === this.initializeId) {
      if (message.error) {
        this.#handleDisconnect(message.error.message ?? "初始化失败");
        return;
      }
      this.#send({ method: "initialized", params: {} });
      this.initialized = true;
      this.emit("status", { kind: "refreshing", message: "正在读取额度" });
      this.refresh().catch((error) => this.#emitError(error));
      clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        this.refresh().catch((error) => this.#emitError(error));
      }, POLL_INTERVAL_MS);
      return;
    }

    if (message.id === this.pendingRefresh?.id) {
      const pending = this.pendingRefresh;
      this.pendingRefresh = null;
      clearTimeout(pending.timeout);
      if (message.error) {
        const error = new Error(message.error.message ?? "读取额度失败");
        pending.rejectRequest(error);
        this.#emitError(error);
        return;
      }

      const normalized = normalizeRateLimits(message.result);
      pending.resolveRequest(normalized);
      this.emit("data", normalized);
      this.emit("status", { kind: "ready", message: "额度已更新" });
      return;
    }

    if (message.method === "account/rateLimits/updated") {
      this.emit("status", { kind: "refreshing", message: "检测到额度变化" });
      this.refresh().catch((error) => this.#emitError(error));
    }
  }

  #send(message) {
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleDisconnect(message) {
    if (this.stopping) return;
    clearInterval(this.pollTimer);
    this.initialized = false;
    this.#rejectPending(new Error(message));
    this.emit("status", { kind: "offline", message: "连接中断，正在重试" });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.#spawnServer(), 5_000);
  }

  #rejectPending(error) {
    if (!this.pendingRefresh) return;
    clearTimeout(this.pendingRefresh.timeout);
    this.pendingRefresh.rejectRequest(error);
    this.pendingRefresh = null;
  }

  #emitError(error) {
    this.emit("status", { kind: "error", message: error.message });
  }
}

function normalizeRateLimits(result) {
  const buckets = result?.rateLimitsByLimitId;
  const entries = buckets && Object.keys(buckets).length
    ? Object.entries(buckets)
    : result?.rateLimits
      ? [[result.rateLimits.limitId ?? "codex", result.rateLimits]]
      : [];

  const windows = [];
  for (const [limitId, bucket] of entries) {
    for (const [kind, window] of [["primary", bucket.primary], ["secondary", bucket.secondary]]) {
      if (!window || typeof window.usedPercent !== "number") continue;
      windows.push({
        limitId,
        limitName: bucket.limitName ?? null,
        kind,
        usedPercent: clamp(window.usedPercent, 0, 100),
        remainingPercent: clamp(100 - window.usedPercent, 0, 100),
        windowDurationMins: window.windowDurationMins ?? null,
        resetsAt: window.resetsAt ?? null,
      });
    }
  }

  windows.sort((a, b) => (a.windowDurationMins ?? Infinity) - (b.windowDurationMins ?? Infinity));
  return {
    windows,
    updatedAt: Date.now(),
    resetCredits: result?.rateLimitResetCredits?.availableCount ?? null,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
