/* ============================================================
   FocusGuard — Popup JavaScript (Updated for realtime stats)
   ============================================================ */

const modeBadge = document.getElementById("modeBadge");
const popupProgress = document.getElementById("popupProgress");
const popupTime = document.getElementById("popupTime");
const popupStartPause = document.getElementById("popupStartPause");
const popupPlayIcon = document.getElementById("popupPlayIcon");
const popupReset = document.getElementById("popupReset");
const popupSkip = document.getElementById("popupSkip");
const popupPomodoroCount = document.getElementById("popupPomodoroCount");
const popupWorkTime = document.getElementById("popupWorkTime");
const popupStreak = document.getElementById("popupStreak");
const popupDashboard = document.getElementById("popupDashboard");

let currentState = null;
let updateInterval = null;

async function init() {
  await refreshState();
  render();
  updateInterval = setInterval(async () => {
    await refreshState();
    render();
  }, 1000);
  bindEvents();
}

async function refreshState() {
  try {
    const response = await browser.runtime.sendMessage({ action: "getState" });
    if (response.success) currentState = response.data;
  } catch (e) { /* context invalidated */ }
}

function render() {
  if (!currentState) return;
  const { timer, settings, dailyStats } = currentState;
  const today = new Date().toISOString().split("T")[0];

  // Use local date key matching background
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayStats = dailyStats[todayKey] || { totalWork: 0, pomodoros: 0 };

  // Calculate active session elapsed for realtime display
  let activeElapsed = 0;
  if (timer.mode === "work" && timer.isRunning) {
    activeElapsed = timer.totalSeconds - timer.remainingSeconds;
  }
  const totalWorkSeconds = todayStats.totalWork + activeElapsed;

  const isBreak = timer.mode !== "work";
  modeBadge.textContent = isBreak ? "BREAK" : "FOCUS";
  modeBadge.classList.toggle("on-break", isBreak);

  const mins = Math.floor(timer.remainingSeconds / 60);
  const secs = timer.remainingSeconds % 60;
  popupTime.textContent = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  const circumference = 2 * Math.PI * 52;
  const progress = timer.totalSeconds > 0
    ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds
    : 0;
  popupProgress.style.strokeDashoffset = circumference * (1 - progress);
  popupProgress.classList.toggle("on-break", isBreak);

  if (timer.isRunning && !timer.isPaused) {
    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r1.setAttribute('x', '6'); r1.setAttribute('y', '4');
    r1.setAttribute('width', '4'); r1.setAttribute('height', '16');
    r1.setAttribute('rx', '1');
    const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r2.setAttribute('x', '14'); r2.setAttribute('y', '4');
    r2.setAttribute('width', '4'); r2.setAttribute('height', '16');
    r2.setAttribute('rx', '1');
    popupPlayIcon.replaceChildren(r1, r2);
  } else {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    p.setAttribute('points', '6,3 20,12 6,21');
    popupPlayIcon.replaceChildren(p);
  }

  popupStartPause.classList.toggle("on-break", isBreak);

  popupPomodoroCount.textContent = timer.completedPomodoros;

  const workMins = Math.floor(totalWorkSeconds / 60);
  const workHrs = Math.floor(workMins / 60);
  const remMins = workMins % 60;
  popupWorkTime.textContent = workHrs > 0 ? `${workHrs}h${remMins}m` : `${workMins}m`;

  // Show active indicator if session is running
  if (activeElapsed > 0 && timer.isRunning && !timer.isPaused) {
    popupWorkTime.style.color = "#ef4444";
  } else {
    popupWorkTime.style.color = "";
  }

  popupStreak.textContent = timer.currentStreak;
}

function bindEvents() {
  popupStartPause.addEventListener("click", async () => {
    try {
      if (!currentState) return;
      const { timer } = currentState;
      if (timer.isRunning && !timer.isPaused) {
        await browser.runtime.sendMessage({ action: "pauseTimer" });
      } else if (timer.isRunning && timer.isPaused) {
        await browser.runtime.sendMessage({ action: "resumeTimer" });
      } else {
        await browser.runtime.sendMessage({ action: "startTimer" });
      }
      await refreshState(); render();
    } catch (e) { console.error("FocusGuard popup:", e); }
  });

  popupReset.addEventListener("click", async () => {
    try {
      await browser.runtime.sendMessage({ action: "resetTimer" });
      await refreshState(); render();
    } catch (e) { console.error("FocusGuard popup:", e); }
  });

  popupSkip.addEventListener("click", async () => {
    try {
      if (!currentState) return;
      const { timer, settings } = currentState;
      if (timer.mode === "work") {
        const nextMode = (timer.completedPomodoros + 1) % settings.longBreakInterval === 0
          ? "long_break" : "short_break";
        await browser.runtime.sendMessage({ action: "setTimerMode", mode: nextMode });
      } else {
        await browser.runtime.sendMessage({ action: "setTimerMode", mode: "work" });
      }
      await refreshState(); render();
    } catch (e) { console.error("FocusGuard popup:", e); }
  });

  popupDashboard.addEventListener("click", () => {
    try {
      browser.tabs.create({ url: browser.runtime.getURL("newtab/newtab.html") });
      window.close();
    } catch (e) { console.error("FocusGuard popup:", e); }
  });
}

window.addEventListener("unload", () => {
  if (updateInterval) clearInterval(updateInterval);
});

init();
