/* ============================================================
   FocusGuard — Background Service Worker
   Handles: Timer state, site tracking, blocking coordination,
            alarms, notifications, and message passing
   ============================================================ */

// ─── Constants ────────────────────────────────────────────────
const POMODORO_WORK = 25 * 60;        // 25 minutes in seconds
const POMODORO_SHORT_BREAK = 5 * 60;  // 5 minutes
const POMODORO_LONG_BREAK = 15 * 60;  // 15 minutes
const LONG_BREAK_INTERVAL = 4;         // After 4 pomodoros
const ALARM_TIMER = "focusguard-timer";
const ALARM_TRACKING = "focusguard-tracking";
const ALARM_EMERGENCY = "focusguard-emergency";
const STORAGE_KEY = "focusguard_data";

// ─── Default State ────────────────────────────────────────────
const DEFAULT_STATE = {
  // Timer
  timer: {
    isRunning: false,
    isPaused: false,
    mode: "work",           // "work" | "short_break" | "long_break"
    remainingSeconds: POMODORO_WORK,
    totalSeconds: POMODORO_WORK,
    completedPomodoros: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastTick: null,
    sessionStartTimestamp: null  // When the current session started (for realtime tracking & incomplete logging)
  },
  // Settings
  settings: {
    workDuration: POMODORO_WORK,
    shortBreakDuration: POMODORO_SHORT_BREAK,
    longBreakDuration: POMODORO_LONG_BREAK,
    longBreakInterval: LONG_BREAK_INTERVAL,
    autoStartBreaks: true,
    autoStartWork: false,
    notificationsEnabled: true,
    soundEnabled: true,
    blockDuringWork: true,
    blockDuringBreaks: false,
    customDurations: false,
    dailyGoalMinutes: 480  // 8 hours default daily goal
  },
  // Blocked sites
  blockedSites: [
    { domain: "facebook.com", enabled: true, category: "social" },
    { domain: "twitter.com", enabled: true, category: "social" },
    { domain: "x.com", enabled: true, category: "social" },
    { domain: "instagram.com", enabled: true, category: "social" },
    { domain: "reddit.com", enabled: true, category: "social" },
    { domain: "tiktok.com", enabled: true, category: "social" },
    { domain: "youtube.com", enabled: true, category: "entertainment" },
    { domain: "twitch.tv", enabled: true, category: "entertainment" },
    { domain: "netflix.com", enabled: true, category: "entertainment" }
  ],
  // Site usage tracking
  siteUsage: {},
  // Tracking metadata for delta calculation
  lastTrackingTick: null,
  // Whether tabs-based blocking fallback is active
  tabsBlockingEnabled: false,
  // Daily stats
  dailyStats: {},
  // Session log
  sessionLog: [],
  // Manual study log entries
  studyLog: [],
  // Todo list
  todos: []
};

// ─── State Management ─────────────────────────────────────────
let state = null;

async function getState() {
  if (state) return state;
  try {
    const result = await browser.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      state = deepMerge(DEFAULT_STATE, result[STORAGE_KEY]);
    } else {
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  } catch (e) {
    console.error("FocusGuard: Error loading state", e);
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
  return state;
}

async function saveState() {
  if (!state) return;
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: state });
  } catch (e) {
    console.error("FocusGuard: Error saving state", e);
  }
}

function deepMerge(target, source) {
  const output = JSON.parse(JSON.stringify(target));
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

// ─── Timer Logic ──────────────────────────────────────────────
async function startTimer() {
  const s = await getState();
  s.timer.isRunning = true;
  s.timer.isPaused = false;
  s.timer.lastTick = Date.now();
  // Record when this session started for realtime tracking & incomplete logging
  s.timer.sessionStartTimestamp = Date.now();
  await saveState();

  // Clear existing alarm and set a new one that fires every second
  await browser.alarms.clear(ALARM_TIMER);
  browser.alarms.create(ALARM_TIMER, { periodInMinutes: 1 / 60 });

  // Update badge
  updateBadge(s.timer.remainingSeconds);

  // Apply blocking rules if needed
  if (s.settings.blockDuringWork && s.timer.mode === "work") {
    await applyBlockingRules(true);
  } else if (s.settings.blockDuringBreaks && s.timer.mode !== "work") {
    await applyBlockingRules(true);
  } else {
    await applyBlockingRules(false);
  }
}

async function pauseTimer() {
  const s = await getState();
  s.timer.isPaused = true;
  s.timer.lastTick = null;
  await saveState();

  await browser.alarms.clear(ALARM_TIMER);
  updateBadge(s.timer.remainingSeconds, true);
}

async function resumeTimer() {
  const s = await getState();
  s.timer.isPaused = false;
  s.timer.lastTick = Date.now();
  await saveState();

  await browser.alarms.clear(ALARM_TIMER);
  browser.alarms.create(ALARM_TIMER, { periodInMinutes: 1 / 60 });
  updateBadge(s.timer.remainingSeconds);
}

async function stopTimer() {
  const s = await getState();
  s.timer.isRunning = false;
  s.timer.isPaused = false;
  s.timer.remainingSeconds = getDurationForMode(s.timer.mode);
  s.timer.totalSeconds = s.timer.remainingSeconds;
  s.timer.lastTick = null;
  s.timer.sessionStartTimestamp = null;
  await saveState();

  await browser.alarms.clear(ALARM_TIMER);
  await applyBlockingRules(false);
  clearBadge();
}

async function resetTimer() {
  const s = await getState();

  // If currently running a work session, log the incomplete time
  if (s.timer.isRunning && s.timer.mode === "work") {
    await logIncompleteSession(s, "reset");
  }

  const duration = getDurationForMode(s.timer.mode);
  s.timer.remainingSeconds = duration;
  s.timer.totalSeconds = duration;
  s.timer.lastTick = s.timer.isRunning ? Date.now() : null;
  // Reset session start for new session
  s.timer.sessionStartTimestamp = s.timer.isRunning ? Date.now() : null;
  await saveState();
  updateBadge(s.timer.remainingSeconds, s.timer.isPaused);
}

async function tickTimer() {
  const s = await getState();
  if (!s.timer.isRunning || s.timer.isPaused) return;

  const now = Date.now();
  const elapsed = s.timer.lastTick ? Math.floor((now - s.timer.lastTick) / 1000) : 1;
  s.timer.lastTick = now;

  s.timer.remainingSeconds = Math.max(0, s.timer.remainingSeconds - elapsed);

  if (s.timer.remainingSeconds <= 0) {
    await onTimerComplete(s);
  } else {
    await saveState();
    updateBadge(s.timer.remainingSeconds);
  }
}

// ─── Log Incomplete Session ───────────────────────────────────
// When a user resets or skips a focus session before completing it,
// we log the elapsed time as an incomplete session
async function logIncompleteSession(s, reason) {
  if (!s.timer.sessionStartTimestamp) return;

  const now = Date.now();
  let elapsedSeconds = Math.floor((now - s.timer.sessionStartTimestamp) / 1000);

  // Subtract any paused time by using the timer's own accounting
  // The timer knows how much time has been consumed: totalSeconds - remainingSeconds
  const consumedSeconds = s.timer.totalSeconds - s.timer.remainingSeconds;

  // Use consumedSeconds as it's more accurate (accounts for pauses)
  if (consumedSeconds <= 0) return;

  // Don't log very short sessions (< 30 seconds)
  if (consumedSeconds < 30) return;

  const dayKey = getTodayKey();

  // Add to study log
  s.studyLog.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: dayKey,
    duration: consumedSeconds,
    subject: reason === "reset" ? "Focus Session (Reset)" : "Focus Session (Skipped)",
    note: `${formatDuration(consumedSeconds)} of ${formatDuration(s.timer.totalSeconds)} completed — ${reason}`,
    timestamp: now,
    source: reason  // "reset" or "skip"
  });

  // Update daily stats
  if (!s.dailyStats[dayKey]) {
    s.dailyStats[dayKey] = { totalWork: 0, totalBreak: 0, pomodoros: 0 };
  }
  s.dailyStats[dayKey].totalWork += consumedSeconds;

  // Log in session log too
  s.sessionLog.push({
    type: "work_incomplete",
    duration: consumedSeconds,
    totalDuration: s.timer.totalSeconds,
    reason: reason,
    timestamp: now,
    date: dayKey
  });
}

function formatDuration(totalSeconds) {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const mins = Math.floor(totalSeconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

async function onTimerComplete(s) {
  const mode = s.timer.mode;

  if (mode === "work") {
    // Completed a pomodoro
    s.timer.completedPomodoros++;
    s.timer.currentStreak++;
    if (s.timer.currentStreak > s.timer.bestStreak) {
      s.timer.bestStreak = s.timer.currentStreak;
    }

    // Log session
    const session = {
      type: "work",
      duration: s.timer.totalSeconds,
      timestamp: Date.now(),
      date: getTodayKey()
    };
    s.sessionLog.push(session);

    // Also add to study log so it appears in the timeline
    s.studyLog.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: getTodayKey(),
      duration: s.timer.totalSeconds,
      subject: "Pomodoro Session",
      note: `Pomodoro #${s.timer.completedPomodoros}`,
      timestamp: Date.now(),
      source: "timer"
    });

    // Update daily stats
    const dayKey = getTodayKey();
    if (!s.dailyStats[dayKey]) {
      s.dailyStats[dayKey] = { totalWork: 0, totalBreak: 0, pomodoros: 0 };
    }
    s.dailyStats[dayKey].totalWork += s.timer.totalSeconds;
    s.dailyStats[dayKey].pomodoros++;

    // Determine next mode
    if (s.timer.completedPomodoros % s.settings.longBreakInterval === 0) {
      s.timer.mode = "long_break";
      s.timer.remainingSeconds = s.settings.longBreakDuration;
      s.timer.totalSeconds = s.settings.longBreakDuration;
    } else {
      s.timer.mode = "short_break";
      s.timer.remainingSeconds = s.settings.shortBreakDuration;
      s.timer.totalSeconds = s.settings.shortBreakDuration;
    }

    // Notification
    if (s.settings.notificationsEnabled) {
      browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-128.png"),
        title: "FocusGuard",
        message: `Pomodoro #${s.timer.completedPomodoros} complete! Time for a ${s.timer.mode === "long_break" ? "long" : "short"} break.`
      });
    }

    // Auto-start break
    if (s.settings.autoStartBreaks) {
      s.timer.lastTick = Date.now();
      s.timer.sessionStartTimestamp = Date.now();
    } else {
      s.timer.isRunning = false;
      s.timer.isPaused = false;
      s.timer.sessionStartTimestamp = null;
      await browser.alarms.clear(ALARM_TIMER);
    }

    // Update blocking
    if (s.settings.blockDuringWork) {
      await applyBlockingRules(s.settings.blockDuringBreaks);
    }

  } else {
    // Break completed — save break info BEFORE switching mode
    const breakMode = s.timer.mode;  // "short_break" or "long_break"
    const breakDuration = s.timer.totalSeconds;

    // Log break session
    const breakSession = {
      type: breakMode,
      duration: breakDuration,
      timestamp: Date.now(),
      date: getTodayKey()
    };
    s.sessionLog.push(breakSession);

    // Update daily stats
    const dayKey = getTodayKey();
    if (!s.dailyStats[dayKey]) {
      s.dailyStats[dayKey] = { totalWork: 0, totalBreak: 0, pomodoros: 0 };
    }
    s.dailyStats[dayKey].totalBreak += breakDuration;

    // Now switch to work mode
    s.timer.mode = "work";
    s.timer.remainingSeconds = s.settings.workDuration;
    s.timer.totalSeconds = s.settings.workDuration;

    // Notification
    if (s.settings.notificationsEnabled) {
      browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-128.png"),
        title: "FocusGuard",
        message: "Break is over! Time to focus."
      });
    }

    // Auto-start work
    if (s.settings.autoStartWork) {
      s.timer.lastTick = Date.now();
      s.timer.sessionStartTimestamp = Date.now();
    } else {
      s.timer.isRunning = false;
      s.timer.isPaused = false;
      s.timer.sessionStartTimestamp = null;
      await browser.alarms.clear(ALARM_TIMER);
    }

    // Apply blocking for work mode
    if (s.settings.blockDuringWork) {
      await applyBlockingRules(true);
    }
  }

  await saveState();
  updateBadge(s.timer.remainingSeconds);
}

function getDurationForMode(mode) {
  const s = state || DEFAULT_STATE;
  switch (mode) {
    case "work": return s.settings.workDuration;
    case "short_break": return s.settings.shortBreakDuration;
    case "long_break": return s.settings.longBreakDuration;
    default: return POMODORO_WORK;
  }
}

// ─── Badge Updates ────────────────────────────────────────────
function updateBadge(seconds, isPaused = false) {
  const mins = Math.ceil(seconds / 60);
  const text = mins > 0 ? `${mins}m` : "0m";
  const color = isPaused ? "#F59E0B" :
    state.timer.mode === "work" ? "#EF4444" : "#10B981";

  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
}

function clearBadge() {
  browser.action.setBadgeText({ text: "" });
}

// ─── Site Tracking ────────────────────────────────────────────
async function trackSiteVisit(tabId, url) {
  if (!url || url.startsWith("about:") || url.startsWith("moz-extension:") ||
      url.startsWith("chrome:") || url.startsWith("data:")) return;

  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (!hostname) return;

    const s = await getState();
    const today = getTodayKey();

    if (!s.siteUsage[today]) {
      s.siteUsage[today] = {};
    }
    if (!s.siteUsage[today][hostname]) {
      s.siteUsage[today][hostname] = { visits: 0, totalSeconds: 0, lastVisit: null };
    }

    s.siteUsage[today][hostname].visits++;
    s.siteUsage[today][hostname].lastVisit = Date.now();

    // Clean up old data (keep last 30 days)
    const keys = Object.keys(s.siteUsage).sort();
    while (keys.length > 30) {
      delete s.siteUsage[keys.shift()];
    }

    await saveState();
  } catch (e) {
    // Ignore invalid URLs
  }
}

async function updateSiteActiveTime() {
  const s = await getState();
  const today = getTodayKey();

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0 && tabs[0].url) {
      const url = tabs[0].url;
      if (url.startsWith("about:") || url.startsWith("moz-extension:") ||
          url.startsWith("chrome:") || url.startsWith("data:")) return;

      const hostname = new URL(url).hostname.replace(/^www\./, "");
      if (!hostname) return;

      // Use delta-based timing for accuracy
      const now = Date.now();
      const deltaSeconds = s.lastTrackingTick
        ? Math.min(Math.floor((now - s.lastTrackingTick) / 1000), 30)  // Cap at 30s
        : 5;
      s.lastTrackingTick = now;

      if (!s.siteUsage[today]) s.siteUsage[today] = {};
      if (!s.siteUsage[today][hostname]) {
        s.siteUsage[today][hostname] = { visits: 0, totalSeconds: 0, lastVisit: null };
      }

      s.siteUsage[today][hostname].totalSeconds += deltaSeconds;
      s.siteUsage[today][hostname].lastVisit = Date.now();
      await saveState();
    }
  } catch (e) {
    // Ignore errors
  }
}

// ─── Blocking Logic ───────────────────────────────────────────
async function applyBlockingRules(shouldBlock) {
  const s = await getState();
  const enabledSites = shouldBlock
    ? s.blockedSites.filter(site => site.enabled).map(site => site.domain)
    : [];

  // Generate declarativeNetRequest rules — two rules per domain
  // (one for subdomain pattern, one for bare domain)
  const rules = [];
  let ruleId = 1;
  for (const domain of enabledSites) {
    const redirectPath = `/blocked/blocked.html?domain=${encodeURIComponent(domain)}`;
    // Rule for bare domain: *://domain/*
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: redirectPath }
      },
      condition: {
        urlFilter: `*://${domain}/*`,
        resourceTypes: ["main_frame"]
      }
    });
    // Rule for subdomain: *://*.domain/*
    rules.push({
      id: ruleId++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: redirectPath }
      },
      condition: {
        urlFilter: `*://*.${domain}/*`,
        resourceTypes: ["main_frame"]
      }
    });
  }

  // Write rules to block_rules.json path dynamically
  // Since declarativeNetRequest rules can't be dynamic in MV3 easily,
  // we'll use a different approach: dynamically update rules
  try {
    // Use updateDynamicRules to atomically add and remove rules
    const existingRules = await browser.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules.map(r => r.id);

    const addRules = shouldBlock ? rules.slice(0, 5000) : [];  // Browser limit: 5000 rules

    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeRuleIds,
      addRules: addRules
    });
  } catch (e) {
    console.error("FocusGuard: DNR error, falling back to tabs blocking", e);
    // Fallback: use tabs approach
    s.tabsBlockingEnabled = shouldBlock;
    await saveState();
  }
}

// Fallback blocking using tabs.onUpdated — state is persisted in storage

async function checkAndBlockTab(tabId, url) {
  if (!state || !state.tabsBlockingEnabled) return;
  if (!url || url.startsWith("about:") || url.startsWith("moz-extension:") ||
      url.startsWith("chrome:") || url.startsWith("data:")) return;

  try {
    const s = await getState();
    const hostname = new URL(url).hostname.replace(/^www\./, "");

    // Find the matching blocked site to get the canonical domain
    const matchedSite = s.blockedSites.find(
      site => site.enabled && (hostname === site.domain || hostname.endsWith(`.${site.domain}`))
    );

    if (matchedSite) {
      // Use matchedSite.domain (not hostname) to ensure emergency toggle works
      // Pass the original URL so emergency access can navigate back to it
      const blockedUrl = browser.runtime.getURL(
        `/blocked/blocked.html?domain=${encodeURIComponent(matchedSite.domain)}&url=${encodeURIComponent(url)}`
      );
      browser.tabs.update(tabId, { url: blockedUrl });
    }
  } catch (e) {
    // Ignore
  }
}

// ─── Utility Functions ────────────────────────────────────────
function getTodayKey() {
  // Use local time, not UTC — toISOString() returns UTC which causes date mismatch
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ─── Alarm Handler ────────────────────────────────────────────
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_TIMER) {
    await tickTimer();
  } else if (alarm.name === ALARM_TRACKING) {
    await updateSiteActiveTime();
  } else if (alarm.name === ALARM_EMERGENCY) {
    // Re-enable the blocked domain after emergency access expires
    const result = await browser.storage.local.get("emergencyDomain");
    if (result.emergencyDomain) {
      const s = await getState();
      const site = s.blockedSites.find(bs => bs.domain === result.emergencyDomain);
      if (site) {
        site.enabled = true;
        await saveState();
        // Re-apply blocking
        const shouldBlock = s.timer.isRunning && !s.timer.isPaused &&
          ((s.timer.mode === "work" && s.settings.blockDuringWork) ||
           (s.timer.mode !== "work" && s.settings.blockDuringBreaks));
        if (shouldBlock) {
          await applyBlockingRules(true);
        }
      }
      await browser.storage.local.remove("emergencyDomain");
    }
  }
});

// ─── Capture original URL before DNR redirects ──────────────
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = details.url;
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (!hostname) return;
    const s = await getState();
    const matchedSite = s.blockedSites.find(
      site => site.enabled && (hostname === site.domain || hostname.endsWith(`.${site.domain}`))
    );
    if (matchedSite) {
      await browser.storage.session.set({ [`emergency_orig_${details.tabId}`]: url });
    }
  } catch (e) { /* ignore */ }
});

// ─── Tabs Event Handlers ──────────────────────────────────────
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await trackSiteVisit(tabId, changeInfo.url);
    await checkAndBlockTab(tabId, changeInfo.url);
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await browser.tabs.get(activeInfo.tabId);
    if (tab.url) {
      await trackSiteVisit(activeInfo.tabId, tab.url);
    }
  } catch (e) {
    // Tab may not exist
  }
});

// ─── Message Handler ──────────────────────────────────────────
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(e => {
    console.error("FocusGuard: Message handler error", e);
    sendResponse({ error: e.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  const s = await getState();

  switch (message.action) {
    case "getState":
      return { success: true, data: s };

    case "startTimer":
      await startTimer();
      return { success: true };

    case "pauseTimer":
      await pauseTimer();
      return { success: true };

    case "resumeTimer":
      await resumeTimer();
      return { success: true };

    case "stopTimer":
      await stopTimer();
      return { success: true };

    case "resetTimer":
      await resetTimer();
      return { success: true };

    case "setTimerMode": {
      // If switching away from an active/paused work session, log incomplete time
      if (s.timer.mode === "work" && s.timer.isRunning) {
        await logIncompleteSession(s, "skip");
      }

      s.timer.mode = message.mode;
      const duration = message.mode === "work" ? s.settings.workDuration :
                        message.mode === "short_break" ? s.settings.shortBreakDuration :
                        s.settings.longBreakDuration;
      s.timer.remainingSeconds = duration;
      s.timer.totalSeconds = duration;
      s.timer.isRunning = false;
      s.timer.isPaused = false;
      s.timer.lastTick = null;
      s.timer.sessionStartTimestamp = null;

      // If skipping from work to break, reset the streak since it's incomplete
      if (message.mode !== "work" && s.timer.currentStreak > 0) {
        // Don't reset streak on skip — they still did some work
        // s.timer.currentStreak = 0;
      }

      await saveState();
      await browser.alarms.clear(ALARM_TIMER);
      clearBadge();
      return { success: true };
    }

    case "updateSettings": {
      Object.assign(s.settings, message.settings);
      // If timer isn't running, update remaining seconds to match new durations
      if (!s.timer.isRunning) {
        const duration = s.timer.mode === "work" ? s.settings.workDuration :
                          s.timer.mode === "short_break" ? s.settings.shortBreakDuration :
                          s.settings.longBreakDuration;
        s.timer.remainingSeconds = duration;
        s.timer.totalSeconds = duration;
      }
      await saveState();
      return { success: true };
    }

    case "addBlockedSite": {
      if (message.site && message.site.domain) {
        const domain = message.site.domain.toLowerCase().trim();
        // Validate domain: must contain at least one dot and valid chars
        if (!/^[a-z0-9]+([\-\.][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
          return { success: false, error: "Invalid domain format" };
        }
        const exists = s.blockedSites.some(bs => bs.domain === domain);
        if (!exists) {
          s.blockedSites.push({
            domain: domain,
            enabled: true,
            category: message.site.category || "custom"
          });
          await saveState();
          // Re-apply blocking if timer is running in work mode
          if (s.timer.isRunning && !s.timer.isPaused &&
              ((s.timer.mode === "work" && s.settings.blockDuringWork) ||
               (s.timer.mode !== "work" && s.settings.blockDuringBreaks))) {
            await applyBlockingRules(true);
          }
        }
      }
      return { success: true };
    }

    case "removeBlockedSite": {
      s.blockedSites = s.blockedSites.filter(bs => bs.domain !== message.domain);
      await saveState();
      // Re-apply blocking
      if (s.timer.isRunning && !s.timer.isPaused) {
        const shouldBlock = (s.timer.mode === "work" && s.settings.blockDuringWork) ||
                            (s.timer.mode !== "work" && s.settings.blockDuringBreaks);
        await applyBlockingRules(shouldBlock);
      }
      return { success: true };
    }

    case "toggleBlockedSite": {
      const site = s.blockedSites.find(bs => bs.domain === message.domain);
      if (site) {
        site.enabled = !site.enabled;
        await saveState();
        if (s.timer.isRunning && !s.timer.isPaused) {
          const shouldBlock = (s.timer.mode === "work" && s.settings.blockDuringWork) ||
                              (s.timer.mode !== "work" && s.settings.blockDuringBreaks);
          await applyBlockingRules(shouldBlock);
        }
      }
      return { success: true };
    }

    case "getBlockStatus":
      return {
        success: true,
        isBlocking: s.timer.isRunning && !s.timer.isPaused &&
                    ((s.timer.mode === "work" && s.settings.blockDuringWork) ||
                     (s.timer.mode !== "work" && s.settings.blockDuringBreaks))
      };

    case "getDailyStats":
      return {
        success: true,
        data: s.dailyStats[message.date || getTodayKey()] || { totalWork: 0, totalBreak: 0, pomodoros: 0 }
      };

    case "getSiteUsage":
      return {
        success: true,
        data: s.siteUsage[message.date || getTodayKey()] || {}
      };

    case "getWeeklyStats": {
      const weekData = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const key = `${y}-${m}-${day}`;
        weekData[key] = s.dailyStats[key] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
      }
      return { success: true, data: weekData };
    }

    case "getMonthlyStats": {
      const now = new Date();
      const year = message.year || now.getFullYear();
      const month = message.month !== undefined ? message.month : now.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const monthData = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        monthData[key] = s.dailyStats[key] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
      }
      return { success: true, data: monthData };
    }

    case "clearAllData": {
      state = JSON.parse(JSON.stringify(DEFAULT_STATE));
      await saveState();
      await applyBlockingRules(false);
      return { success: true };
    }

    // ─── Study Log Actions ──────────────────────────────────────
    case "addStudyLogEntry": {
      const entry = message.entry;
      if (!entry || !entry.duration || entry.duration <= 0) {
        return { success: false, error: "Duration is required and must be positive" };
      }
      const newEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        date: entry.date || getTodayKey(),
        duration: Math.round(entry.duration),  // seconds
        subject: (entry.subject || "").trim().slice(0, 60),
        note: (entry.note || "").trim().slice(0, 200),
        timestamp: Date.now(),
        source: "manual"
      };
      s.studyLog.push(newEntry);

      // Also add to daily stats so it reflects in weekly chart & progress
      const logDayKey = newEntry.date;
      if (!s.dailyStats[logDayKey]) {
        s.dailyStats[logDayKey] = { totalWork: 0, totalBreak: 0, pomodoros: 0 };
      }
      s.dailyStats[logDayKey].totalWork += newEntry.duration;

      await saveState();
      return { success: true, data: newEntry };
    }

    case "editStudyLogEntry": {
      const editId = message.id;
      const updates = message.updates || {};
      const entryIndex = s.studyLog.findIndex(e => e.id === editId);
      if (entryIndex === -1) {
        return { success: false, error: "Entry not found" };
      }
      const oldEntry = s.studyLog[entryIndex];

      // If duration or date changed, recalculate daily stats
      const durationDiff = (updates.duration || oldEntry.duration) - oldEntry.duration;
      const dateChanged = updates.date && updates.date !== oldEntry.date;

      if (durationDiff !== 0 || dateChanged) {
        // Remove old contribution from daily stats
        const oldDayKey = oldEntry.date;
        if (s.dailyStats[oldDayKey]) {
          s.dailyStats[oldDayKey].totalWork = Math.max(0, s.dailyStats[oldDayKey].totalWork - oldEntry.duration);
        }
      }

      // Apply updates
      if (updates.duration && updates.duration > 0) {
        s.studyLog[entryIndex].duration = Math.round(updates.duration);
      }
      if (updates.subject !== undefined) {
        s.studyLog[entryIndex].subject = updates.subject.trim().slice(0, 60);
      }
      if (updates.note !== undefined) {
        s.studyLog[entryIndex].note = updates.note.trim().slice(0, 200);
      }
      if (updates.date) {
        s.studyLog[entryIndex].date = updates.date;
      }

      // Re-add contribution to (possibly new) daily stats
      if (durationDiff !== 0 || dateChanged) {
        const newDayKey = s.studyLog[entryIndex].date;
        if (!s.dailyStats[newDayKey]) {
          s.dailyStats[newDayKey] = { totalWork: 0, totalBreak: 0, pomodoros: 0 };
        }
        s.dailyStats[newDayKey].totalWork += s.studyLog[entryIndex].duration;
      }

      await saveState();
      return { success: true, data: s.studyLog[entryIndex] };
    }

    case "deleteStudyLogEntry": {
      const deleteId = message.id;
      const deleteIndex = s.studyLog.findIndex(e => e.id === deleteId);
      if (deleteIndex === -1) {
        return { success: false, error: "Entry not found" };
      }
      const deletedEntry = s.studyLog[deleteIndex];

      // Remove contribution from daily stats
      const delDayKey = deletedEntry.date;
      if (s.dailyStats[delDayKey]) {
        s.dailyStats[delDayKey].totalWork = Math.max(0, s.dailyStats[delDayKey].totalWork - deletedEntry.duration);
      }

      s.studyLog.splice(deleteIndex, 1);
      await saveState();
      return { success: true };
    }

    case "getStudyLog": {
      const filterDate = message.date;  // optional: filter by date
      let entries = s.studyLog;
      if (filterDate) {
        entries = entries.filter(e => e.date === filterDate);
      }
      // Sort newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);
      // Limit to last 200 entries
      return { success: true, data: entries.slice(0, 200) };
    }

    case "emergencyAccess": {
      // Temporarily unblock a domain for 5 minutes via alarm
      const emergencyDomain = message.domain;
      const site = s.blockedSites.find(bs => bs.domain === emergencyDomain);
      if (site) {
        site.enabled = false;
        await saveState();
        // Re-apply blocking without this domain
        const shouldBlock = (s.timer.mode === "work" && s.settings.blockDuringWork) ||
                            (s.timer.mode !== "work" && s.settings.blockDuringBreaks);
        if (s.timer.isRunning && shouldBlock) {
          await applyBlockingRules(true);
        }
        // Set alarm to re-enable blocking after 5 minutes
        await browser.alarms.clear(ALARM_EMERGENCY);
        browser.alarms.create(ALARM_EMERGENCY, { delayInMinutes: 5 });
        // Store which domain to re-enable
        await browser.storage.local.set({ emergencyDomain: emergencyDomain });
      }
      return { success: true };
    }

    // ─── Todo List Actions ───────────────────────────────────────
    case "addTodo": {
      const text = (message.text || "").trim();
      if (!text) return { success: false, error: "Text is required" };
      const todo = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        text: text.slice(0, 200),
        done: false,
        createdAt: Date.now()
      };
      s.todos.push(todo);
      await saveState();
      return { success: true, data: todo };
    }

    case "toggleTodo": {
      const todoId = message.id;
      const todo = s.todos.find(t => t.id === todoId);
      if (!todo) return { success: false, error: "Todo not found" };
      todo.done = !todo.done;
      if (todo.done) {
        todo.doneAt = Date.now();
      } else {
        delete todo.doneAt;
      }
      await saveState();
      return { success: true, data: todo };
    }

    case "deleteTodo": {
      const delTodoId = message.id;
      const delIdx = s.todos.findIndex(t => t.id === delTodoId);
      if (delIdx === -1) return { success: false, error: "Todo not found" };
      s.todos.splice(delIdx, 1);
      await saveState();
      return { success: true };
    }

    case "editTodo": {
      const editTodoId = message.id;
      const editTodo = s.todos.find(t => t.id === editTodoId);
      if (!editTodo) return { success: false, error: "Todo not found" };
      if (message.text !== undefined) {
        editTodo.text = message.text.trim().slice(0, 200);
      }
      await saveState();
      return { success: true, data: editTodo };
    }

    case "getTodos": {
      // Sort: undone first (by creation desc), then done (by doneAt desc)
      const sorted = [...s.todos].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const aTime = a.done ? (a.doneAt || 0) : a.createdAt;
        const bTime = b.done ? (b.doneAt || 0) : b.createdAt;
        return bTime - aTime;
      });
      return { success: true, data: sorted };
    }

    case "clearDoneTodos": {
      s.todos = s.todos.filter(t => !t.done);
      await saveState();
      return { success: true };
    }

    default:
      return { error: "Unknown action" };
  }
}

// ─── Initialize ───────────────────────────────────────────────
async function initialize() {
  await getState();

  // Start tracking alarm (every 5 seconds to measure active time)
  const existingAlarms = await browser.alarms.get(ALARM_TRACKING);
  if (!existingAlarms) {
    browser.alarms.create(ALARM_TRACKING, { periodInMinutes: 1 / 12 }); // Every 5 seconds
  }

  // If timer was running before browser close, recalculate
  if (state.timer.isRunning && !state.timer.isPaused && state.timer.lastTick) {
    const now = Date.now();
    const elapsed = Math.floor((now - state.timer.lastTick) / 1000);
    state.timer.remainingSeconds = Math.max(0, state.timer.remainingSeconds - elapsed);
    state.timer.lastTick = now;

    if (state.timer.remainingSeconds <= 0) {
      await onTimerComplete(state);
    } else {
      browser.alarms.create(ALARM_TIMER, { periodInMinutes: 1 / 60 });
      updateBadge(state.timer.remainingSeconds);
    }
    await saveState();
  }

  // Apply blocking if timer is active
  if (state.timer.isRunning && !state.timer.isPaused) {
    const shouldBlock = (state.timer.mode === "work" && state.settings.blockDuringWork) ||
                        (state.timer.mode !== "work" && state.settings.blockDuringBreaks);
    await applyBlockingRules(shouldBlock);
  }

  console.log("FocusGuard: Background initialized");
}

initialize();
