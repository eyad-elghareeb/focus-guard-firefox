let currentState = null;
let updateInterval = null;

const clock = document.getElementById("clock");
const dateDisplay = document.getElementById("dateDisplay");
const searchInput = document.getElementById("searchInput");
const searchWrap = document.getElementById("searchWrap");
const searchBtn = document.getElementById("searchBtn");
const statTime = document.getElementById("statTime");
const statPomodoros = document.getElementById("statPomodoros");
const statStreak = document.getElementById("statStreak");
const btnStartFocus = document.getElementById("btnStartFocus");
const timerStatus = document.getElementById("timerStatus");

async function init() {
  updateClock();
  updateDate();
  setInterval(updateClock, 1000);
  setInterval(updateDate, 60000);
  await refreshState();
  renderStats();
  updateTimerStatus();
  updateInterval = setInterval(async () => {
    await refreshState();
    renderStats();
    updateTimerStatus();
  }, 2000);
  bindEvents();
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  clock.textContent = `${h}:${m}`;
}

function updateDate() {
  const now = new Date();
  const options = { weekday: "long", month: "long", day: "numeric" };
  dateDisplay.textContent = now.toLocaleDateString("en-US", options);
}

async function refreshState() {
  try {
    const response = await browser.runtime.sendMessage({ action: "getState" });
    if (response.success) currentState = response.data;
  } catch (e) {
    if (e.message && e.message.includes("Could not establish connection")) return;
    console.warn("FocusGuard: refreshState error", e);
  }
}

function renderStats() {
  if (!currentState) return;
  const { timer, dailyStats } = currentState;
  const todayKey = getTodayKey();
  const stats = dailyStats[todayKey] || { totalWork: 0, pomodoros: 0 };
  let activeElapsed = 0;
  if (timer.mode === "work" && timer.isRunning && !timer.isPaused) {
    activeElapsed = Math.max(0, timer.totalSeconds - timer.remainingSeconds);
  }
  const totalSecs = stats.totalWork + activeElapsed;
  const mins = Math.floor(totalSecs / 60);
  statTime.textContent = formatMins(mins);
  statPomodoros.textContent = stats.pomodoros + (activeElapsed > 0 ? 1 : 0);
  statStreak.textContent = timer.currentStreak || 0;
}

function updateTimerStatus() {
  if (!currentState) {
    timerStatus.textContent = "";
    timerStatus.className = "nt-status";
    return;
  }
  const { timer } = currentState;
  if (timer.isRunning && !timer.isPaused) {
    const mins = Math.floor(timer.remainingSeconds / 60);
    const secs = timer.remainingSeconds % 60;
    const timeStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    if (timer.mode === "work") {
      timerStatus.textContent = `Focus session in progress — ${timeStr} remaining`;
      timerStatus.className = "nt-status active";
    } else {
      timerStatus.textContent = `Break — ${timeStr} remaining`;
      timerStatus.className = "nt-status break-mode";
    }
  } else if (timer.isPaused) {
    timerStatus.textContent = "Timer is paused";
    timerStatus.className = "nt-status";
  } else {
    timerStatus.textContent = "";
    timerStatus.className = "nt-status";
  }
}

function bindEvents() {
  searchInput.addEventListener("input", () => {
    searchWrap.classList.toggle("has-text", searchInput.value.trim().length > 0);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  searchBtn.addEventListener("click", handleSearch);

  btnStartFocus.addEventListener("click", async () => {
    try {
      await browser.runtime.sendMessage({ action: "startTimer" });
      browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html") });
    } catch (e) {
      browser.tabs.create({ url: browser.runtime.getURL("dashboard/dashboard.html") });
    }
  });
}

function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;
  const isUrl = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/.test(query) || query.startsWith("http");
  if (isUrl) {
    const url = query.startsWith("http") ? query : `https://${query}`;
    window.location.href = url;
  } else {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
}

function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMins(mins) {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

window.addEventListener("beforeunload", () => {
  if (updateInterval) clearInterval(updateInterval);
});

init();
