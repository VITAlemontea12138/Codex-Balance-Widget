const meters = document.querySelector("#meters");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const updatedText = document.querySelector("#updatedText");
const refreshButton = document.querySelector("#refreshButton");
const settingsButton = document.querySelector("#settingsButton");
const closeButton = document.querySelector("#closeButton");
const characterButton = document.querySelector("#characterButton");
const character = document.querySelector("#character");
const toast = document.querySelector("#toast");
const quotaCard = document.querySelector(".quota-card");
const settingsPanel = document.querySelector("#settingsPanel");
const scaleValue = document.querySelector("#scaleValue");
const sizeDownButton = document.querySelector("#sizeDownButton");
const sizeUpButton = document.querySelector("#sizeUpButton");
const resetScaleButton = document.querySelector("#resetScaleButton");

let latestData = null;
let currentStatus = { kind: "connecting", message: "正在连接 Codex" };
let currentScale = 1;
let toastTimer = null;
let poseTimer = null;
let idleTimer = null;

[
  "../../assets/character-leaning-v1.png",
  "../../assets/character-happy-v1.png",
  "../../assets/character-curious-v1.png",
  "../../assets/character-sleepy-v1.png",
].forEach((source) => {
  const image = new Image();
  image.src = source;
});

window.codexWidget.onData((data) => {
  latestData = data;
  renderMeters();
  chooseCharacter();
});

window.codexWidget.onStatus((status) => {
  currentStatus = status;
  renderStatus();
  chooseCharacter();
});

refreshButton.addEventListener("click", refresh);
characterButton.addEventListener("click", refresh);
closeButton.addEventListener("click", () => window.codexWidget.close());
settingsButton.addEventListener("click", () => {
  const opening = settingsPanel.hidden;
  settingsPanel.hidden = !opening;
  quotaCard.classList.toggle("settings-open", opening);
});
sizeDownButton.addEventListener("click", () => setScale(currentScale - 0.1));
sizeUpButton.addEventListener("click", () => setScale(currentScale + 0.1));
resetScaleButton.addEventListener("click", () => {
  setScale(1);
});

window.codexWidget.onScaleChanged(({ scale }) => applyScale(scale));

setInterval(() => {
  if (latestData) renderMeters();
}, 1_000);

async function refresh() {
  if (currentStatus.kind === "refreshing") return;
  try {
    setCharacterState("thinking");
    await window.codexWidget.refresh();
    setCharacterState("smile");
    showToast("额度已更新");
    setTimeout(chooseCharacter, 1_200);
  } catch (error) {
    showToast(error?.message ?? "刷新失败");
  }
}

function renderStatus() {
  statusText.textContent = currentStatus.message;
  const busy = ["connecting", "refreshing"].includes(currentStatus.kind);
  refreshButton.classList.toggle("refreshing", busy);
  statusDot.className = "status-dot";
  if (busy) statusDot.classList.add("connecting");
  if (["error", "offline"].includes(currentStatus.kind)) statusDot.classList.add("error");

  if (latestData?.updatedAt) {
    updatedText.textContent = `更新于 ${formatClock(latestData.updatedAt)}`;
  } else if (["error", "offline"].includes(currentStatus.kind)) {
    updatedText.textContent = "暂时无法取得数据";
  }
}

function renderMeters() {
  if (!latestData?.windows?.length) {
    meters.innerHTML = '<div class="meter"><div class="meter-name">当前账户未返回额度窗口</div></div>';
    updatedText.textContent = latestData?.updatedAt ? `检查于 ${formatClock(latestData.updatedAt)}` : "等待首次数据";
    return;
  }

  const visible = latestData.windows.slice(0, 2);
  meters.innerHTML = visible.map((windowInfo) => {
    const level = windowInfo.remainingPercent <= 20 ? "danger" : windowInfo.remainingPercent <= 40 ? "warn" : "";
    return `
      <div class="meter ${level}">
        <div class="meter-top">
          <span class="meter-name">${escapeHtml(windowLabel(windowInfo.windowDurationMins))}</span>
          <span class="meter-value">剩余 ${roundPercent(windowInfo.remainingPercent)}%</span>
        </div>
        <div class="bar"><span style="width:${windowInfo.remainingPercent}%"></span></div>
        <div class="meter-reset">${escapeHtml(resetLabel(windowInfo.resetsAt))}</div>
      </div>`;
  }).join("");
  updatedText.textContent = `更新于 ${formatClock(latestData.updatedAt)}`;
}

function chooseCharacter() {
  let state = "default";
  if (["error", "offline"].includes(currentStatus.kind)) state = "anxious";
  else if (["connecting", "refreshing"].includes(currentStatus.kind)) state = "thinking";
  else if (latestData?.windows?.length) {
    const lowest = Math.min(...latestData.windows.map((item) => item.remainingPercent));
    if (lowest <= 10) state = "low";
    else if (lowest <= 20) state = "tired";
    else if (lowest >= 80) state = "idea";
  }
  setCharacterState(state);
}

function setCharacterState(state) {
  if (character.dataset.state === state) return;
  character.dataset.state = state;
  character.className = `character state-${state} pose-changing`;
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => character.classList.remove("pose-changing"), 360);
}

function scheduleIdlePose() {
  clearTimeout(idleTimer);
  const delay = 14_000 + Math.random() * 10_000;
  idleTimer = setTimeout(() => {
    const lowest = latestData?.windows?.length
      ? Math.min(...latestData.windows.map((item) => item.remainingPercent))
      : 0;

    if (currentStatus.kind === "ready" && lowest > 20 && settingsPanel.hidden) {
      setCharacterState(Math.random() > 0.45 ? "smile" : "thinking");
      setTimeout(chooseCharacter, 2_800);
    }
    scheduleIdlePose();
  }, delay);
}

function windowLabel(minutes) {
  if (!Number.isFinite(minutes)) return "用量窗口";
  if (minutes === 300) return "5 小时额度";
  if (minutes === 10_080) return "每周额度";
  if (minutes % 10_080 === 0) return `${minutes / 10_080} 周额度`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}

function resetLabel(timestamp) {
  if (!timestamp) return "重置时间未知";
  const remaining = timestamp * 1_000 - Date.now();
  if (remaining <= 0) return "额度即将重置";
  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const compact = days > 0 ? `${days}天 ${hours}小时` : hours > 0 ? `${hours}小时 ${minutes}分` : `${minutes}分钟`;
  return `${compact}后重置 · ${new Date(timestamp * 1_000).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function roundPercent(value) {
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1_800);
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function applyScale(scale) {
  const safeScale = Math.min(1.4, Math.max(0.7, Number(scale) || 1));
  currentScale = safeScale;
  document.documentElement.style.setProperty("--widget-scale", safeScale);
  const percent = Math.round(safeScale * 100);
  scaleValue.textContent = `${percent}%`;
  sizeDownButton.disabled = percent <= 70;
  sizeUpButton.disabled = percent >= 140;
}

async function setScale(scale) {
  const safeScale = Math.min(1.4, Math.max(0.7, Math.round(scale * 10) / 10));
  applyScale(safeScale);
  try {
    const settings = await window.codexWidget.setScale(safeScale);
    applyScale(settings.scale);
  } catch {
    showToast("调整大小失败");
  }
}

window.codexWidget.getSettings()
  .then((settings) => applyScale(settings.scale))
  .catch(() => applyScale(1));

renderStatus();
chooseCharacter();
scheduleIdlePose();
