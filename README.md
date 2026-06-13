# FocusGuard — Study Timer & Site Blocker

A Firefox extension that replaces your new tab page with a Pomodoro study dashboard, tracks website usage, and blocks distracting sites during focus sessions.

## Features

- **New Tab Dashboard** — Beautiful dark study dashboard replaces your home/new tab page
- **Pomodoro Timer** — 25/5/15 min sessions (customizable), auto-start breaks
- **Site Blocking** — Auto-blocks distracting sites during focus sessions using declarativeNetRequest
- **Usage Tracking** — Tracks which sites you visit and time spent on each
- **Weekly Stats** — Visual bar chart of your focus time over the past 7 days
- **Streak Tracking** — Current and best pomodoro streaks
- **Emergency Access** — 5-minute unblock with auto-re-enable via background alarm
- **Quick Popup** — Timer controls from the toolbar badge
- **Keyboard Shortcuts** — Space (start/pause), R (reset), S (skip)
- **All Local** — No cloud, no accounts, all data stays in your browser

## Installation (Firefox)

### Temporary Install (Development)

1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"** in the sidebar
3. Click **"Load Temporary Add-on..."**
4. Select any file inside the `focus-guard` folder (e.g., `manifest.json`)
5. The extension is now active! Open a new tab to see the dashboard.

> Note: Temporary extensions are removed when Firefox closes.

### Permanent Install (Signed)

1. Zip the `focus-guard` folder contents
2. Submit to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
3. Get it signed, then install the .xpi

## File Structure

```
focus-guard/
├── manifest.json              # Extension manifest (MV3)
├── background/
│   ├── background.js          # Service worker: timer, tracking, blocking
│   └── block_rules.json       # Static DNR rules (placeholder)
├── newtab/
│   ├── newtab.html            # Dashboard page
│   ├── newtab.css             # Dashboard styles
│   └── newtab.js              # Dashboard logic
├── blocked/
│   ├── blocked.html           # Blocked site page
│   ├── blocked.css            # Blocked page styles
│   └── blocked.js             # Blocked page logic
├── popup/
│   ├── popup.html             # Toolbar popup
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
└── icons/
    ├── icon-16.png
    ├── icon-32.png
    ├── icon-48.png
    └── icon-128.png
```

## Default Blocked Sites

| Category     | Sites                                    |
|-------------|------------------------------------------|
| Social       | facebook.com, twitter.com, x.com, instagram.com, reddit.com, tiktok.com |
| Entertainment| youtube.com, twitch.tv, netflix.com      |

You can add/remove sites from the dashboard or settings.

## Permissions Explained

| Permission            | Why                                     |
|----------------------|------------------------------------------|
| `storage`            | Save settings, stats, blocked sites      |
| `tabs`               | Track active site for usage stats         |
| `webNavigation`      | Detect page loads for tracking            |
| `alarms`             | Timer ticks, emergency access timeout     |
| `notifications`      | Pomodoro completion alerts                |
| `declarativeNetRequest` | Block sites during focus sessions      |
| `<all_urls>` host    | Required for site blocking to work        |

## Tech

- **Manifest V3** (Firefox 113+)
- **declarativeNetRequest** for efficient site blocking
- **Tabs-based fallback** if DNR is unavailable
- **Delta-based timing** for accurate tracking
- **Zero dependencies** — pure vanilla JS/CSS/HTML

## License

MIT
