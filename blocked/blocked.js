/* ============================================================
   FocusGuard — Blocked Page JavaScript
   ============================================================ */

// Motivational quotes
const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Productivity is never an accident. It is always the result of commitment to excellence.", author: "Paul J. Meyer" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" }
];

// ─── DOM Elements ──────────────────────────────────────────────
const domainEl = document.getElementById("blockedDomain");
const timerEl = document.getElementById("blockedTimerTime");
const btnBack = document.getElementById("btnBack");
const btnEmergency = document.getElementById("btnEmergency");
const quoteText = document.getElementById("quoteText");
const quoteAuthor = document.getElementById("quoteAuthor");

// ─── Get domain from URL ───────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const blockedDomain = params.get("domain") || "this site";
domainEl.textContent = blockedDomain;

// ─── Random quote ──────────────────────────────────────────────
const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
quoteText.textContent = `\u201C${quote.text}\u201D`;
quoteAuthor.textContent = `\u2014 ${quote.author}`;

// ─── Timer display ─────────────────────────────────────────────
async function updateTimerDisplay() {
  try {
    const response = await browser.runtime.sendMessage({ action: "getState" });
    if (response.success) {
      const { timer } = response.data;
      const mins = Math.floor(timer.remainingSeconds / 60);
      const secs = timer.remainingSeconds % 60;
      timerEl.textContent = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
  } catch (e) {
    // Extension context may be invalidated
  }
}

updateTimerDisplay();
setInterval(updateTimerDisplay, 1000);

// ─── Return to Dashboard ──────────────────────────────────────
btnBack.addEventListener("click", () => {
  browser.tabs.getCurrent().then(tab => {
    browser.tabs.update(tab.id, { url: browser.runtime.getURL("newtab/newtab.html") });
  });
});

// ─── Emergency Access ──────────────────────────────────────────
// Uses background alarm to safely re-enable blocking after 5 minutes,
// even after this page context is destroyed by navigation.
let emergencyUsed = false;

btnEmergency.addEventListener("click", async () => {
  if (emergencyUsed) return;

  if (!confirm(`Allow access to ${blockedDomain} for 5 minutes? This will break your streak.`)) {
    return;
  }

  emergencyUsed = true;
  btnEmergency.disabled = true;
  btnEmergency.textContent = "Access granted (5 min)";

  try {
    // Tell background to temporarily unblock and set a 5-minute alarm
    await browser.runtime.sendMessage({
      action: "emergencyAccess",
      domain: blockedDomain
    });

    // Navigate to the original site
    browser.tabs.getCurrent().then(tab => {
      browser.tabs.update(tab.id, { url: `https://${blockedDomain}` });
    });
  } catch (e) {
    console.error("Emergency access failed:", e);
  }
});
