import { spawn } from "node:child_process";
import readline from "node:readline";

const APP_SERVER_TIMEOUT_MS = 20_000;
const codex = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const lines = readline.createInterface({ input: codex.stdout });
let finished = false;
let stderr = "";

const timer = setTimeout(() => {
  finishWithError("读取超时。请确认 Codex 已登录，并且 `codex app-server` 可以运行。");
}, APP_SERVER_TIMEOUT_MS);

codex.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

codex.on("error", (error) => {
  finishWithError(`无法启动 Codex：${error.message}`);
});

codex.on("exit", (code) => {
  if (!finished) {
    finishWithError(`Codex 提前退出（退出码 ${code}）。${stderr.trim() ? `\n${stderr.trim()}` : ""}`);
  }
});

lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.id === 1) {
    if (message.error) {
      finishWithError(`初始化失败：${message.error.message ?? JSON.stringify(message.error)}`);
      return;
    }

    send({ method: "initialized", params: {} });
    send({ method: "account/rateLimits/read", id: 2, params: {} });
    return;
  }

  if (message.id === 2) {
    if (message.error) {
      finishWithError(`读取额度失败：${message.error.message ?? JSON.stringify(message.error)}`);
      return;
    }

    printRateLimits(message.result);
    finish(0);
  }
});

send({
  method: "initialize",
  id: 1,
  params: {
    clientInfo: {
      name: "codex_balance_widget",
      title: "Codex Balance Widget",
      version: "0.1.0",
    },
  },
});

function send(message) {
  codex.stdin.write(`${JSON.stringify(message)}\n`);
}

function printRateLimits(result) {
  const buckets = result?.rateLimitsByLimitId;
  const entries = buckets && Object.keys(buckets).length
    ? Object.entries(buckets)
    : result?.rateLimits
      ? [[result.rateLimits.limitId ?? "codex", result.rateLimits]]
      : [];

  if (!entries.length) {
    console.log("当前账户没有返回可显示的 Codex 用量窗口。");
    return;
  }

  console.log("Codex 用量窗口：");
  for (const [id, bucket] of entries) {
    for (const [kind, window] of [["主窗口", bucket.primary], ["次窗口", bucket.secondary]]) {
      if (!window || typeof window.usedPercent !== "number") continue;
      const remaining = Math.max(0, 100 - window.usedPercent);
      const duration = formatDuration(window.windowDurationMins);
      const reset = window.resetsAt
        ? new Date(window.resetsAt * 1000).toLocaleString("zh-CN", { hour12: false })
        : "未知";
      console.log(`- ${bucket.limitName ?? id} ${kind}（${duration}）：已用 ${window.usedPercent}%，剩余 ${remaining}%，重置 ${reset}`);
    }
  }
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return "未知周期";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} 周`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function finishWithError(message) {
  console.error(message);
  finish(1);
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  lines.close();
  codex.kill();
  process.exitCode = code;
}
