/* ============================================================
   FocusGuard — New Tab Page JavaScript
   Premium UI: Analytics, Study Log, Timer, Todo — Realtime
   ============================================================ */

let currentState = null;
let updateInterval = null;
let logViewDate = null;
let analyticsPeriod = "day"; // "day" | "week" | "month"
let lastStudyLogKey = null;  // Track last rendered study log to avoid flicker

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  greeting: $("#greeting"),
  dateDisplay: $("#dateDisplay"),
  timerTime: $("#timerTime"),
  timerLabel: $("#timerLabel"),
  timerProgress: $("#timerProgress"),
  btnStart: $("#btnStart"),
  btnStartIcon: $("#btnStartIcon"),
  btnReset: $("#btnReset"),
  btnSkip: $("#btnSkip"),
  pomodoroDots: $("#pomodoroDots"),
  pomodoroCount: $("#pomodoroCount"),
  focusMessage: $("#focusMessage"),
  // Analytics
  anFocusTime: $("#anFocusTime"),
  anPomodoros: $("#anPomodoros"),
  anAvgSession: $("#anAvgSession"),
  anBestStreak: $("#anBestStreak"),
  analyticsChart: $("#analyticsChart"),
  analyticsExtra: $("#analyticsExtra"),
  analyticsTabs: $$(".analytics-tab"),
  // Site usage
  siteUsageList: $("#siteUsageList"),
  // Blocked sites (in settings)
  blockedGrid: $("#blockedGrid"),
  blockToggle: $("#blockToggle"),
  blockToggleLabel: $("#blockToggleLabel"),
  addSiteInput: $("#addSiteInput"),
  addSiteCategory: $("#addSiteCategory"),
  btnAddSite: $("#btnAddSite"),
  // Settings
  settingsModal: $("#settingsModal"),
  btnOpenSettings: $("#btnOpenSettings"),
  btnCloseSettings: $("#btnCloseSettings"),
  btnSaveSettings: $("#btnSaveSettings"),
  btnResetData: $("#btnResetData"),
  settingWork: $("#settingWork"),
  settingShortBreak: $("#settingShortBreak"),
  settingLongBreak: $("#settingLongBreak"),
  settingLongBreakInterval: $("#settingLongBreakInterval"),
  settingGoalHours: $("#settingGoalHours"),
  settingGoalMinutes: $("#settingGoalMinutes"),
  settingAutoBreaks: $("#settingAutoBreaks"),
  settingAutoWork: $("#settingAutoWork"),
  settingBlockWork: $("#settingBlockWork"),
  settingBlockBreaks: $("#settingBlockBreaks"),
  settingNotifications: $("#settingNotifications"),
  settingSound: $("#settingSound"),
  modeBtns: $$(".mode-btn"),
  // Study log
  studyLogTimeline: $("#studyLogTimeline"),
  studyLogTotal: $("#studyLogTotal"),
  btnAddLogEntry: $("#btnAddLogEntry"),
  btnLogPrevDay: $("#btnLogPrevDay"),
  btnLogNextDay: $("#btnLogNextDay"),
  logDateLabel: $("#logDateLabel"),
  // Study log modal
  studyLogModal: $("#studyLogModal"),
  studyLogModalTitle: $("#studyLogModalTitle"),
  btnCloseStudyLogModal: $("#btnCloseStudyLogModal"),
  logEntryId: $("#logEntryId"),
  logHours: $("#logHours"),
  logMinutes: $("#logMinutes"),
  logSubject: $("#logSubject"),
  logNote: $("#logNote"),
  logDate: $("#logDate"),
  btnSaveLogEntry: $("#btnSaveLogEntry"),
  btnCancelLogEntry: $("#btnCancelLogEntry"),
  btnDeleteLogEntry: $("#btnDeleteLogEntry"),
  // Todo
  todoList: $("#todoList"),
  todoCount: $("#todoCount"),
  todoInput: $("#todoInput"),
  btnAddTodo: $("#btnAddTodo"),
  btnClearDone: $("#btnClearDone")
};

// ─── Focus Messages ────────────────────────────────────────────
const FOCUS_MESSAGES = {
  idle: [
    "Ready to focus? Hit play to start.",
    "Your next pomodoro is waiting.",
    "Deep work starts with a single click."
  ],
  work: [
    "Stay focused. You're in the zone.",
    "One task at a time. You've got this.",
    "Distractions can wait. Focus can't.",
    "Deep work in progress...",
    "Every minute counts right now."
  ],
  break_running: [
    "Take a breather. You earned it.",
    "Stretch, hydrate, relax.",
    "Rest is part of the process.",
    "Look away from the screen for a moment."
  ],
  paused: [
    "Timer paused. Hit play to resume.",
    "Taking a quick pause? Don't forget to come back."
  ]
};

function getFocusMessage(state) {
  const { timer } = state;
  if (!timer.isRunning) return randomFrom(FOCUS_MESSAGES.idle);
  if (timer.isPaused) return randomFrom(FOCUS_MESSAGES.paused);
  if (timer.mode === "work") return randomFrom(FOCUS_MESSAGES.work);
  return randomFrom(FOCUS_MESSAGES.break_running);
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Init ──────────────────────────────────────────────────────
async function init() {
  await refreshState();
  renderAll();
  startUpdateLoop();
  bindEvents();
  updateGreeting();
  updateDate();
  setInterval(() => { updateGreeting(); updateDate(); }, 60000);
}

async function refreshState() {
  const response = await browser.runtime.sendMessage({ action: "getState" });
  if (response.success) currentState = response.data;
}

function startUpdateLoop() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async () => {
    await refreshState();
    renderTimer();
    renderAnalytics();
    // Only update the active session indicator, not the full study log
    updateActiveSessionIndicator();
  }, 1000);
}

// ─── Rendering ─────────────────────────────────────────────────
function renderAll() {
  renderTimer();
  renderAnalytics();
  renderSiteUsage();
  renderBlockedSites();
  renderSettings();
  renderStudyLog();
  renderTodos();
}

let lastMode = null;
let lastRunning = null;

function renderTimer() {
  if (!currentState) return;
  const { timer, settings } = currentState;

  const mins = Math.floor(timer.remainingSeconds / 60);
  const secs = timer.remainingSeconds % 60;
  els.timerTime.textContent = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  const labels = { work: "FOCUS TIME", short_break: "SHORT BREAK", long_break: "LONG BREAK" };
  els.timerLabel.textContent = labels[timer.mode] || "FOCUS TIME";

  const circumference = 2 * Math.PI * 125;
  const progress = timer.totalSeconds > 0
    ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds
    : 0;
  const offset = circumference * (1 - progress);
  els.timerProgress.style.strokeDashoffset = offset;

  const modeChanged = lastMode !== timer.mode;
  const runningChanged = lastRunning !== timer.isRunning;

  if (modeChanged) {
    document.body.dataset.mode = timer.mode;
    lastMode = timer.mode;
  }

  if (timer.isPaused) {
    document.body.classList.add("timer-paused");
  } else {
    document.body.classList.remove("timer-paused");
  }

  if (timer.isRunning && !timer.isPaused) {
    els.btnStartIcon.replaceChildren(
      svgEl('rect', { x: '6', y: '4', width: '4', height: '16', rx: '1' }),
      svgEl('rect', { x: '14', y: '4', width: '4', height: '16', rx: '1' })
    );
    els.timerTime.classList.remove("paused");
  } else {
    els.btnStartIcon.replaceChildren(
      svgEl('polygon', { points: '6,3 20,12 6,21' })
    );
    els.timerTime.classList.toggle("paused", timer.isPaused);
  }

  els.modeBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === timer.mode);
  });

  const interval = settings.longBreakInterval;
  const completed = timer.completedPomodoros % interval;
  let dotsHTML = "";
  for (let i = 0; i < interval; i++) {
    dotsHTML += `<div class="pomodoro-dot ${i < completed ? 'filled' : ''}"></div>`;
  }
  setHTML(els.pomodoroDots, dotsHTML);
  els.pomodoroCount.textContent = `${timer.completedPomodoros} / ${interval}`;

  if (modeChanged || runningChanged) {
    els.focusMessage.textContent = getFocusMessage(currentState);
    els.focusMessage.classList.toggle("active", timer.isRunning && !timer.isPaused);
    lastRunning = timer.isRunning;
  }
}

// ─── Helper: Calculate realtime elapsed for active session ────
function getActiveSessionElapsed(timer) {
  if (!timer.isRunning || !timer.sessionStartTimestamp) return 0;
  // Use the timer's own accounting which is accurate
  return timer.totalSeconds - timer.remainingSeconds;
}

// ─── Analytics Rendering ───────────────────────────────────────
function renderAnalytics() {
  if (!currentState) return;
  const { timer, dailyStats } = currentState;

  if (analyticsPeriod === "day") {
    renderDayAnalytics(dailyStats, timer);
  } else if (analyticsPeriod === "week") {
    renderWeekAnalytics(dailyStats, timer);
  } else {
    renderMonthAnalytics(dailyStats, timer);
  }
}

function getDailyGoalMinutes() {
  return (currentState && currentState.settings.dailyGoalMinutes) || 480;
}

function renderDayAnalytics(dailyStats, timer) {
  const today = getTodayKey();
  const stats = dailyStats[today] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };

  // Add active session elapsed time for realtime display
  const activeElapsed = (timer.mode === "work" && timer.isRunning)
    ? getActiveSessionElapsed(timer) : 0;

  const totalWorkSeconds = stats.totalWork + activeElapsed;
  const workMins = Math.floor(totalWorkSeconds / 60);
  const sessions = stats.pomodoros || 0;
  const activeSessionCount = activeElapsed > 0 ? 1 : 0;
  const totalSessions = sessions + activeSessionCount;
  const avgMins = totalSessions > 0 ? Math.floor(workMins / totalSessions) : 0;

  els.anFocusTime.textContent = formatMins(workMins);
  els.anPomodoros.textContent = totalSessions;
  els.anAvgSession.textContent = formatMins(avgMins);
  els.anBestStreak.textContent = timer.bestStreak || 0;

  // Day chart: progress toward goal
  const goalMins = getDailyGoalMinutes();
  const pct = goalMins > 0 ? Math.min((workMins / goalMins) * 100, 100) : 0;
  const totalHrs = Math.floor(workMins / 60);
  const remMins = workMins % 60;
  setHTML(els.analyticsChart, `
    <div class="chart-bar-container" style="flex:1">
      <div class="chart-bar-value">${totalHrs > 0 ? totalHrs + 'h' : ''}${remMins}m</div>
      <div class="chart-bar today ${activeElapsed > 0 ? 'active-session' : ''}"
           style="height: ${Math.min(Math.max(pct, 4), 100)}%">
        ${activeElapsed > 0 ? '<div class="chart-bar-pulse"></div>' : ''}
      </div>
      <span class="chart-bar-label today">Today</span>
    </div>
    <div class="chart-bar-container" style="flex:1">
      <div class="chart-bar-value">${formatMins(goalMins)}</div>
      <div class="chart-bar goal" style="height: 100%; opacity: 0.15"></div>
      <span class="chart-bar-label">Goal</span>
    </div>
  `);

  const activeLabel = activeElapsed > 0
    ? `<div class="extra-stat accent-red"><strong>${formatDuration(activeElapsed)}</strong> in progress</div>`
    : `<div class="extra-stat accent-muted"><strong>0m</strong> active</div>`;

  setHTML(els.analyticsExtra, `
    ${activeLabel}
    <div class="extra-stat accent-green"><strong>${sessions}</strong> completed</div>
    <div class="extra-stat accent-amber"><strong>${timer.currentStreak || 0}</strong> streak</div>
  `);
}

async function renderWeekAnalytics(dailyStats, timer) {
  const response = await browser.runtime.sendMessage({ action: "getWeeklyStats" });
  if (!response.success) return;
  const weekData = response.data;
  const days = Object.keys(weekData).sort();

  const activeElapsed = (timer.mode === "work" && timer.isRunning)
    ? getActiveSessionElapsed(timer) : 0;
  const todayKey = getTodayKey();

  let totalWork = 0, totalPomodoros = 0, activeDays = 0;
  days.forEach(d => {
    let dayWork = weekData[d].totalWork;
    if (d === todayKey) dayWork += activeElapsed;
    totalWork += dayWork;
    totalPomodoros += weekData[d].pomodoros;
    if (dayWork > 0) activeDays++;
  });

  const totalMins = Math.floor(totalWork / 60);
  const avgMins = activeDays > 0 ? Math.floor(totalMins / activeDays) : 0;

  els.anFocusTime.textContent = formatMins(totalMins);
  els.anPomodoros.textContent = totalPomodoros;
  els.anAvgSession.textContent = formatMins(avgMins) + "/day";
  els.anBestStreak.textContent = timer.bestStreak || 0;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayMinsMap = days.map(d => {
    let dayWork = weekData[d].totalWork;
    if (d === todayKey) dayWork += activeElapsed;
    return Math.floor(dayWork / 60);
  });
  const maxMins = Math.max(...dayMinsMap, 1);

  let chartHTML = "";
  days.forEach((dateKey, idx) => {
    const d = new Date(dateKey + "T12:00:00");
    const dayName = dayNames[d.getDay()];
    const mins = dayMinsMap[idx];
    const heightPct = Math.max(4, (mins / maxMins) * 100);
    const isToday = dateKey === todayKey;
    const isActiveNow = isToday && activeElapsed > 0;

    chartHTML += `
      <div class="chart-bar-container">
        <div class="chart-bar-value">${mins > 0 ? mins + 'm' : ''}</div>
        <div class="chart-bar ${isToday ? 'today' : 'past'} ${mins === 0 ? 'empty' : ''} ${isActiveNow ? 'active-session' : ''}"
             style="height: ${heightPct}%"
             title="${mins} min">
          ${isActiveNow ? '<div class="chart-bar-pulse"></div>' : ''}
        </div>
        <span class="chart-bar-label ${isToday ? 'today' : ''}">${dayName}</span>
      </div>
    `;
  });

  setHTML(els.analyticsChart, chartHTML);
  setHTML(els.analyticsExtra, `
    <div class="extra-stat accent-cyan"><strong>${formatMins(totalMins)}</strong> total</div>
    <div class="extra-stat accent-green"><strong>${activeDays}</strong> active days</div>
    <div class="extra-stat accent-amber"><strong>${formatMins(avgMins)}</strong> avg/day</div>
  `);
}

function renderMonthAnalytics(dailyStats, timer) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate = now.getDate();

  const activeElapsed = (timer.mode === "work" && timer.isRunning)
    ? getActiveSessionElapsed(timer) : 0;
  const todayKey = getTodayKey();

  let totalWork = 0, totalPomodoros = 0, activeDays = 0;
  const weekTotals = [0, 0, 0, 0, 0];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    let dayWork = (dailyStats[dateKey] && dailyStats[dateKey].totalWork) || 0;
    if (dateKey === todayKey) dayWork += activeElapsed;
    const dayPomodoros = (dailyStats[dateKey] && dailyStats[dateKey].pomodoros) || 0;

    if (dayWork > 0) {
      totalWork += dayWork;
      totalPomodoros += dayPomodoros;
      activeDays++;
      const weekIdx = Math.min(Math.floor((d - 1) / 7), 4);
      weekTotals[weekIdx] += dayWork;
    }
  }

  const totalMins = Math.floor(totalWork / 60);
  const avgMins = activeDays > 0 ? Math.floor(totalMins / activeDays) : 0;

  els.anFocusTime.textContent = formatMins(totalMins);
  els.anPomodoros.textContent = totalPomodoros;
  els.anAvgSession.textContent = formatMins(avgMins) + "/day";
  els.anBestStreak.textContent = timer.bestStreak || 0;

  const maxWeekMins = Math.max(...weekTotals.map(w => Math.floor(w / 60)), 1);
  const weekLabels = ["W1", "W2", "W3", "W4", "W5"];
  const currentWeek = Math.min(Math.floor((todayDate - 1) / 7), 4);

  let chartHTML = "";
  weekTotals.forEach((total, i) => {
    if (i < Math.ceil(todayDate / 7) + 1) {
      const mins = Math.floor(total / 60);
      const heightPct = Math.max(4, (mins / maxWeekMins) * 100);
      const isCurrent = i === currentWeek;
      const isActiveNow = isCurrent && activeElapsed > 0;
      chartHTML += `
        <div class="chart-bar-container">
          <div class="chart-bar-value">${mins > 0 ? mins + 'm' : ''}</div>
          <div class="chart-bar ${isCurrent ? 'today' : 'past'} ${mins === 0 ? 'empty' : ''} ${isActiveNow ? 'active-session' : ''}"
               style="height: ${heightPct}%">
            ${isActiveNow ? '<div class="chart-bar-pulse"></div>' : ''}
          </div>
          <span class="chart-bar-label ${isCurrent ? 'today' : ''}">${weekLabels[i]}</span>
        </div>
      `;
    }
  });

  setHTML(els.analyticsChart, chartHTML);
  setHTML(els.analyticsExtra, `
    <div class="extra-stat accent-cyan"><strong>${formatMins(totalMins)}</strong> total</div>
    <div class="extra-stat accent-green"><strong>${activeDays}/${todayDate}</strong> days</div>
    <div class="extra-stat accent-amber"><strong>${formatMins(avgMins)}</strong> avg/day</div>
  `);
}

// ─── Site Usage ────────────────────────────────────────────────
async function renderSiteUsage() {
  const response = await browser.runtime.sendMessage({ action: "getSiteUsage" });
  if (!response.success || !response.data) return;

  const sites = Object.entries(response.data)
    .sort((a, b) => b[1].totalSeconds - a[1].totalSeconds)
    .slice(0, 6);

  if (sites.length === 0) {
    setHTML(els.siteUsageList, '<div class="empty-state">Start browsing to see data</div>');
    return;
  }

  let html = "";
  sites.forEach(([domain, data]) => {
    const timeStr = formatDuration(data.totalSeconds);
    html += `
      <div class="site-usage-item">
        <div class="site-usage-left">
          <span class="site-favicon-placeholder" data-domain="${escapeHTML(domain)}"></span>
          <span class="site-domain">${escapeHTML(domain)}</span>
        </div>
        <div class="site-usage-right">${timeStr}</div>
      </div>
    `;
  });

  setHTML(els.siteUsageList, html);

  els.siteUsageList.querySelectorAll(".site-favicon-placeholder").forEach(placeholder => {
    const domain = placeholder.dataset.domain;
    const img = document.createElement("img");
    img.className = "site-favicon";
    img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    img.alt = "";
    img.addEventListener("error", () => { img.style.display = "none"; });
    placeholder.replaceWith(img);
  });
}

// ─── Blocked Sites (in Settings) ──────────────────────────────
function renderBlockedSites() {
  if (!currentState) return;
  const { blockedSites, timer, settings } = currentState;

  const isBlocking = timer.isRunning && !timer.isPaused &&
    ((timer.mode === "work" && settings.blockDuringWork) ||
     (timer.mode !== "work" && settings.blockDuringBreaks));
  els.blockToggle.checked = isBlocking;
  els.blockToggleLabel.textContent = isBlocking ? "Active" : "Off";
  els.blockToggleLabel.classList.toggle("active", isBlocking);

  let html = "";
  blockedSites.forEach(site => {
    html += `
      <div class="blocked-chip ${site.enabled ? 'enabled' : ''}"
           data-domain="${escapeHTML(site.domain)}"
           title="${site.enabled ? 'Click to disable' : 'Click to enable'}">
        <span class="chip-icon">${getCategoryEmoji(site.category)}</span>
        ${escapeHTML(site.domain)}
        <button class="chip-remove" data-domain="${escapeHTML(site.domain)}" title="Remove">&times;</button>
      </div>
    `;
  });

  setHTML(els.blockedGrid, html);

  els.blockedGrid.querySelectorAll(".blocked-chip").forEach(chip => {
    chip.addEventListener("click", async (e) => {
      if (e.target.classList.contains("chip-remove")) return;
      const domain = chip.dataset.domain;
      await browser.runtime.sendMessage({ action: "toggleBlockedSite", domain });
      await refreshState();
      renderBlockedSites();
    });
  });

  els.blockedGrid.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      await browser.runtime.sendMessage({ action: "removeBlockedSite", domain });
      await refreshState();
      renderBlockedSites();
    });
  });
}

function renderSettings() {
  if (!currentState) return;
  const s = currentState.settings;
  els.settingWork.value = Math.floor(s.workDuration / 60);
  els.settingShortBreak.value = Math.floor(s.shortBreakDuration / 60);
  els.settingLongBreak.value = Math.floor(s.longBreakDuration / 60);
  els.settingLongBreakInterval.value = s.longBreakInterval;
  const goalMins = s.dailyGoalMinutes || 480;
  els.settingGoalHours.value = Math.floor(goalMins / 60);
  els.settingGoalMinutes.value = goalMins % 60;
  els.settingAutoBreaks.checked = s.autoStartBreaks;
  els.settingAutoWork.checked = s.autoStartWork;
  els.settingBlockWork.checked = s.blockDuringWork;
  els.settingBlockBreaks.checked = s.blockDuringBreaks;
  els.settingNotifications.checked = s.notificationsEnabled;
  els.settingSound.checked = s.soundEnabled;
}

// ─── Study Log Rendering ──────────────────────────────────────
// Full render (only on explicit data change, not every tick)
async function renderStudyLog() {
  const dateKey = logViewDate || getTodayKey();
  const response = await browser.runtime.sendMessage({ action: "getStudyLog", date: dateKey });
  if (!response.success) return;

  const entries = response.data;
  updateLogDateLabel(dateKey);

  const totalSeconds = entries.reduce((sum, e) => sum + e.duration, 0);
  els.studyLogTotal.textContent = formatDuration(totalSeconds);

  // Build a fingerprint to avoid unnecessary DOM replacement
  const newKey = entries.map(e => e.id + ':' + e.duration).join(',') + '|' + dateKey;
  if (newKey === lastStudyLogKey) {
    // Data unchanged, just update the active session indicator
    updateActiveSessionIndicator();
    return;
  }
  lastStudyLogKey = newKey;

  if (entries.length === 0) {
    setHTML(els.studyLogTimeline, '<div class="empty-state">No study sessions logged for this day</div>');
    // Still show active session indicator
    updateActiveSessionIndicator();
    return;
  }

  let html = "";

  // Active session placeholder (updated by updateActiveSessionIndicator)
  html += '<div class="active-session-slot" id="activeSessionSlot"></div>';

  entries.forEach(entry => {
    const timeStr = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const subjectDisplay = entry.subject || "Untitled Session";
    const subjectClass = entry.subject ? "" : "empty-subject";
    const sourceInfo = getSourceInfo(entry.source);

    html += `
      <div class="log-entry ${sourceInfo.entryClass}" data-id="${entry.id}">
        <div class="log-entry-dot ${sourceInfo.dotClass}"></div>
        <div class="log-entry-body">
          <div class="log-entry-top">
            <span class="log-entry-subject ${subjectClass}">${escapeHTML(subjectDisplay)}</span>
            <span class="log-entry-duration ${sourceInfo.durationClass}">${formatDuration(entry.duration)}</span>
          </div>
          ${entry.note ? `<div class="log-entry-note">${escapeHTML(entry.note)}</div>` : ""}
          <div class="log-entry-meta">
            <span>${timeStr}</span>
            <span class="log-entry-source ${sourceInfo.sourceClass}">${sourceInfo.label}</span>
          </div>
        </div>
        <div class="log-entry-actions">
          <button class="log-action-btn edit" data-id="${entry.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="log-action-btn delete" data-id="${entry.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  setHTML(els.studyLogTimeline, html);
  bindStudyLogActions(entries);
  updateActiveSessionIndicator();
}

// Lightweight update: only update the active session indicator, not the whole log
function updateActiveSessionIndicator() {
  const slot = document.getElementById("activeSessionSlot");
  if (!slot) return;

  const isViewingToday = !logViewDate || logViewDate === getTodayKey();
  const activeElapsed = (currentState && currentState.timer.mode === "work" && currentState.timer.isRunning)
    ? getActiveSessionElapsed(currentState.timer) : 0;

  if (!isViewingToday || activeElapsed <= 0) {
    slot.textContent = "";
    slot.style.display = "none";
    return;
  }

  slot.style.display = "";
  setHTML(slot, `
    <div class="log-entry log-entry-active">
      <div class="log-entry-dot active-dot"></div>
      <div class="log-entry-body">
        <div class="log-entry-top">
          <span class="log-entry-subject">Focus Session</span>
          <span class="log-entry-duration active-duration">${formatDuration(activeElapsed)}</span>
        </div>
        <div class="log-entry-note">Currently in progress...</div>
        <div class="log-entry-meta">
          <span class="live-indicator">
            <span class="live-dot"></span>
            Live
          </span>
          <span class="log-entry-source active">Active</span>
        </div>
      </div>
    </div>
  `);
}

// Bind edit/delete actions on study log entries (called once per full render)
function bindStudyLogActions(entries) {
  els.studyLogTimeline.querySelectorAll(".log-action-btn.edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditLogEntry(btn.dataset.id, entries);
    });
  });

  els.studyLogTimeline.querySelectorAll(".log-action-btn.delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm("Delete this study session?")) {
        await browser.runtime.sendMessage({ action: "deleteStudyLogEntry", id: btn.dataset.id });
        lastStudyLogKey = null; // Force re-render
        await refreshState();
        renderStudyLog();
        renderAnalytics();
      }
    });
  });
}

// Source info helper for study log entries
function getSourceInfo(source) {
  switch (source) {
    case "timer":
      return {
        label: "Completed",
        sourceClass: "timer",
        dotClass: "dot-timer",
        durationClass: "",
        entryClass: ""
      };
    case "reset":
      return {
        label: "Reset",
        sourceClass: "incomplete",
        dotClass: "dot-incomplete",
        durationClass: "duration-incomplete",
        entryClass: "entry-incomplete"
      };
    case "skip":
      return {
        label: "Skipped",
        sourceClass: "incomplete",
        dotClass: "dot-incomplete",
        durationClass: "duration-incomplete",
        entryClass: "entry-incomplete"
      };
    case "manual":
    default:
      return {
        label: "Manual",
        sourceClass: "manual",
        dotClass: "dot-manual",
        durationClass: "",
        entryClass: ""
      };
  }
}

function updateLogDateLabel(dateKey) {
  const today = getTodayKey();
  const yesterday = makeDateKey(new Date(Date.now() - 86400000));

  if (dateKey === today) {
    els.logDateLabel.textContent = "Today";
  } else if (dateKey === yesterday) {
    els.logDateLabel.textContent = "Yesterday";
  } else {
    const d = new Date(dateKey + "T12:00:00");
    els.logDateLabel.textContent = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

// ─── Todo List Rendering ───────────────────────────────────────
async function renderTodos() {
  const response = await browser.runtime.sendMessage({ action: "getTodos" });
  if (!response.success) return;
  const todos = response.data;
  const undone = todos.filter(t => !t.done).length;
  els.todoCount.textContent = undone;

  if (todos.length === 0) {
    setHTML(els.todoList, '<div class="empty-state">No tasks yet</div>');
    return;
  }

  let html = "";
  todos.forEach(todo => {
    html += `
      <div class="todo-item ${todo.done ? 'done' : ''}" data-id="${todo.id}">
        <button class="todo-check" data-id="${todo.id}" title="${todo.done ? 'Uncheck' : 'Check'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${todo.done
              ? '<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" stroke="currentColor"/><path d="M9 11l3 3L22 4" stroke="white" stroke-width="2.5" fill="none"/>'
              : '<rect x="3" y="3" width="18" height="18" rx="4"/>'
            }
          </svg>
        </button>
        <span class="todo-text">${escapeHTML(todo.text)}</span>
        <button class="todo-delete" data-id="${todo.id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  });

  setHTML(els.todoList, html);

  els.todoList.querySelectorAll(".todo-check").forEach(btn => {
    btn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "toggleTodo", id: btn.dataset.id });
      renderTodos();
    });
  });

  els.todoList.querySelectorAll(".todo-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "deleteTodo", id: btn.dataset.id });
      renderTodos();
    });
  });
}

function openAddLogEntry() {
  els.logEntryId.value = "";
  els.logHours.value = 0;
  els.logMinutes.value = 30;
  els.logSubject.value = "";
  els.logNote.value = "";
  els.logDate.value = logViewDate || getTodayKey();
  els.btnDeleteLogEntry.style.display = "none";
  setHTML(els.studyLogModalTitle, `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    Log Study Time`);
  els.studyLogModal.classList.add("open");
  els.logHours.focus();
}

function openEditLogEntry(id, entries) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  els.logEntryId.value = entry.id;
  const hrs = Math.floor(entry.duration / 3600);
  const mins = Math.floor((entry.duration % 3600) / 60);
  els.logHours.value = hrs;
  els.logMinutes.value = mins;
  els.logSubject.value = entry.subject || "";
  els.logNote.value = entry.note || "";
  els.logDate.value = entry.date;
  els.btnDeleteLogEntry.style.display = "inline-flex";
  setHTML(els.studyLogModalTitle, `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
    Edit Session`);
  els.studyLogModal.classList.add("open");
}

function closeStudyLogModal() {
  els.studyLogModal.classList.remove("open");
}

async function handleSaveLogEntry() {
  const hrs = parseInt(els.logHours.value) || 0;
  const mins = parseInt(els.logMinutes.value) || 0;
  const totalSeconds = (hrs * 3600) + (mins * 60);

  if (totalSeconds <= 0) {
    els.logHours.parentElement.style.borderColor = "var(--red)";
    els.logMinutes.parentElement.style.borderColor = "var(--red)";
    setTimeout(() => {
      els.logHours.parentElement.style.borderColor = "";
      els.logMinutes.parentElement.style.borderColor = "";
    }, 1500);
    return;
  }

  const editId = els.logEntryId.value;

  if (editId) {
    const updates = {
      duration: totalSeconds,
      subject: els.logSubject.value,
      note: els.logNote.value,
      date: els.logDate.value
    };
    await browser.runtime.sendMessage({ action: "editStudyLogEntry", id: editId, updates });
  } else {
    const entry = {
      duration: totalSeconds,
      subject: els.logSubject.value,
      note: els.logNote.value,
      date: els.logDate.value
    };
    await browser.runtime.sendMessage({ action: "addStudyLogEntry", entry });
  }

  closeStudyLogModal();
  lastStudyLogKey = null; // Force re-render
  await refreshState();
  renderStudyLog();
  renderAnalytics();
}

async function handleDeleteLogEntry() {
  const editId = els.logEntryId.value;
  if (!editId) return;
  if (confirm("Delete this study session?")) {
    await browser.runtime.sendMessage({ action: "deleteStudyLogEntry", id: editId });
    closeStudyLogModal();
    lastStudyLogKey = null; // Force re-render
    await refreshState();
    renderStudyLog();
    renderAnalytics();
  }
}

function handleLogPrevDay() {
  const currentDate = logViewDate || getTodayKey();
  const d = parseDateKey(currentDate);
  d.setDate(d.getDate() - 1);
  logViewDate = makeDateKey(d);
  lastStudyLogKey = null; // Force re-render
  renderStudyLog();
}

function handleLogNextDay() {
  const currentDate = logViewDate || getTodayKey();
  const d = parseDateKey(currentDate);
  d.setDate(d.getDate() + 1);
  if (makeDateKey(d) > getTodayKey()) {
    logViewDate = null;
  } else {
    logViewDate = makeDateKey(d);
  }
  lastStudyLogKey = null; // Force re-render
  renderStudyLog();
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function setHTML(el, html) {
  el.textContent = '';
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.append(...doc.body.childNodes);
  }
}

// ─── Events ────────────────────────────────────────────────────
function bindEvents() {
  els.btnStart.addEventListener("click", handleStartPause);
  els.btnReset.addEventListener("click", handleReset);
  els.btnSkip.addEventListener("click", handleSkip);

  els.modeBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "setTimerMode", mode: btn.dataset.mode });
      await refreshState();
      renderTimer();
      renderAnalytics();
      lastStudyLogKey = null;
      renderStudyLog();
    });
  });

  // Analytics tabs
  els.analyticsTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      els.analyticsTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      analyticsPeriod = tab.dataset.period;
      renderAnalytics();
    });
  });

  // Blocked sites (in settings)
  els.btnAddSite.addEventListener("click", handleAddSite);
  els.addSiteInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleAddSite();
  });

  // Study log
  els.btnAddLogEntry.addEventListener("click", openAddLogEntry);
  els.btnLogPrevDay.addEventListener("click", handleLogPrevDay);
  els.btnLogNextDay.addEventListener("click", handleLogNextDay);
  els.btnCloseStudyLogModal.addEventListener("click", closeStudyLogModal);
  els.btnCancelLogEntry.addEventListener("click", closeStudyLogModal);
  els.btnSaveLogEntry.addEventListener("click", handleSaveLogEntry);
  els.btnDeleteLogEntry.addEventListener("click", handleDeleteLogEntry);
  els.studyLogModal.addEventListener("click", (e) => {
    if (e.target === els.studyLogModal) closeStudyLogModal();
  });

  // Todo
  els.btnAddTodo.addEventListener("click", handleAddTodo);
  els.todoInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleAddTodo();
  });
  els.btnClearDone.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "clearDoneTodos" });
    renderTodos();
  });

  // Settings
  els.btnOpenSettings.addEventListener("click", () => {
    renderSettings();
    renderBlockedSites();
    els.settingsModal.classList.add("open");
  });

  els.btnCloseSettings.addEventListener("click", () => {
    els.settingsModal.classList.remove("open");
  });

  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) els.settingsModal.classList.remove("open");
  });

  els.btnSaveSettings.addEventListener("click", handleSaveSettings);
  els.btnResetData.addEventListener("click", handleResetData);
}

// ─── Handlers ──────────────────────────────────────────────────
async function handleStartPause() {
  if (!currentState) return;
  const { timer } = currentState;

  if (timer.isRunning && !timer.isPaused) {
    await browser.runtime.sendMessage({ action: "pauseTimer" });
  } else if (timer.isRunning && timer.isPaused) {
    await browser.runtime.sendMessage({ action: "resumeTimer" });
  } else {
    await browser.runtime.sendMessage({ action: "startTimer" });
  }

  await refreshState();
  renderTimer();
  renderAnalytics();
  lastStudyLogKey = null;
  renderStudyLog();
}

async function handleReset() {
  await browser.runtime.sendMessage({ action: "resetTimer" });
  await refreshState();
  renderTimer();
  renderAnalytics();
  lastStudyLogKey = null;
  renderStudyLog();
}

async function handleSkip() {
  if (!currentState) return;
  const { timer, settings } = currentState;
  if (timer.mode === "work") {
    const nextMode = (timer.completedPomodoros + 1) % settings.longBreakInterval === 0
      ? "long_break" : "short_break";
    await browser.runtime.sendMessage({ action: "setTimerMode", mode: nextMode });
  } else {
    await browser.runtime.sendMessage({ action: "setTimerMode", mode: "work" });
  }
  await refreshState();
  renderTimer();
  renderAnalytics();
  lastStudyLogKey = null;
  renderStudyLog();
}

async function handleAddTodo() {
  const text = els.todoInput.value.trim();
  if (!text) {
    els.todoInput.style.borderColor = "var(--red)";
    setTimeout(() => els.todoInput.style.borderColor = "", 1500);
    return;
  }
  await browser.runtime.sendMessage({ action: "addTodo", text });
  els.todoInput.value = "";
  renderTodos();
}

async function handleAddSite() {
  const domain = els.addSiteInput.value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

  if (!domain || !domain.includes(".")) {
    els.addSiteInput.parentElement.style.borderColor = "var(--red)";
    setTimeout(() => els.addSiteInput.parentElement.style.borderColor = "", 1500);
    return;
  }

  await browser.runtime.sendMessage({
    action: "addBlockedSite",
    site: { domain, category: els.addSiteCategory.value }
  });

  els.addSiteInput.value = "";
  await refreshState();
  renderBlockedSites();
}

async function handleSaveSettings() {
  const goalHours = parseInt(els.settingGoalHours.value) || 0;
  const goalMins = parseInt(els.settingGoalMinutes.value) || 0;
  const totalGoalMins = Math.max(goalHours * 60 + goalMins, 1); // Min 1 minute

  const settings = {
    workDuration: parseInt(els.settingWork.value) * 60,
    shortBreakDuration: parseInt(els.settingShortBreak.value) * 60,
    longBreakDuration: parseInt(els.settingLongBreak.value) * 60,
    longBreakInterval: parseInt(els.settingLongBreakInterval.value),
    autoStartBreaks: els.settingAutoBreaks.checked,
    autoStartWork: els.settingAutoWork.checked,
    blockDuringWork: els.settingBlockWork.checked,
    blockDuringBreaks: els.settingBlockBreaks.checked,
    notificationsEnabled: els.settingNotifications.checked,
    soundEnabled: els.settingSound.checked,
    dailyGoalMinutes: totalGoalMins
  };

  await browser.runtime.sendMessage({ action: "updateSettings", settings });
  await refreshState();
  renderAll();
  els.settingsModal.classList.remove("open");
}

async function handleResetData() {
  if (confirm("This will erase ALL your data. Continue?")) {
    await browser.runtime.sendMessage({ action: "clearAllData" });
    await refreshState();
    lastStudyLogKey = null;
    renderAll();
    els.settingsModal.classList.remove("open");
  }
}

// ─── Utilities ─────────────────────────────────────────────────
function getTodayKey() {
  return makeDateKey(new Date());
}

function makeDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const mins = Math.floor(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function formatMins(mins) {
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function updateGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 6) greeting = "Good night";
  else if (hour < 12) greeting = "Good morning";
  else if (hour < 17) greeting = "Good afternoon";
  else if (hour < 21) greeting = "Good evening";
  else greeting = "Good night";
  els.greeting.textContent = greeting;
}

function updateDate() {
  const now = new Date();
  const options = { weekday: "long", month: "long", day: "numeric" };
  els.dateDisplay.textContent = now.toLocaleDateString("en-US", options);
}

function getCategoryEmoji(category) {
  const emojis = {
    social: "\u{1F4AC}", entertainment: "\u{1F3AC}", news: "\u{1F4F0}",
    shopping: "\u{1F6D2}", gaming: "\u{1F3AE}", custom: "\u{1F527}"
  };
  return emojis[category] || emojis.custom;
}

// ─── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); handleStartPause(); }
  if (e.code === "KeyR") handleReset();
  if (e.code === "KeyS") handleSkip();
  if (e.code === "Escape") {
    els.settingsModal.classList.remove("open");
    closeStudyLogModal();
  }
});

// ─── Start ─────────────────────────────────────────────────────
init();
