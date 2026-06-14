/* ============================================================
   FocusGuard — Desktop Sync Bridge (browser side)
   ------------------------------------------------------------
   Talks to the FocusGuard Desktop app's HTTP broker on
   localhost:9472 (see src-tauri/src/sync_server.rs).

   Loaded BEFORE background.js in both Firefox (background.scripts)
   and Chrome (service_worker importScripts). Attaches helpers to
   `globalThis.FocusGuardSync` so background.js can call them.

   No new permissions are needed — `<all_urls>` host permission
   already covers http://localhost:9472.
   ============================================================ */

(function () {
  const SYNC_BASE = "http://localhost:9472";
  const SYNC_HEALTH_INTERVAL_MS = 5000;
  const SYNC_PULL_INTERVAL_MS = 10000;
  const PUSH_THROTTLE_MS = 500;

  let desktopConnected = false;
  let lastPushedAt = 0;

  const Sync = {
    isDesktopConnected: () => desktopConnected,

    async syncFetch(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3000);
      try {
        const response = await fetch(`${SYNC_BASE}${path}`, {
          method: options.method || "GET",
          headers: options.body ? { "Content-Type": "application/json" } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },

    async checkHealth() {
      const result = await this.syncFetch("/health", { timeoutMs: 2500 });
      const ok = !!(result && result.ok && result.desktop);
      const changed = desktopConnected !== ok;
      desktopConnected = ok;
      if (changed && globalThis.bgOnDesktopConnectionChange) {
        globalThis.bgOnDesktopConnectionChange(ok);
      }
      return ok;
    },

    /** Push the full state blob to the desktop broker. */
    async pushStateToDesktop(state) {
      if (!desktopConnected) return;
      const now = Date.now();
      if (now - lastPushedAt < PUSH_THROTTLE_MS) return;
      lastPushedAt = now;
      await this.syncFetch("/state", {
        method: "POST",
        body: state,
        timeoutMs: 4000,
      });
    },

    /** Pull desktop's current extension payload. Returns null if disconnected. */
    async pullStateFromDesktop() {
      if (!desktopConnected) return null;
      return await this.syncFetch("/state");
    },

    /** Fetch desktop-only app usage (extensions can't see native apps). */
    async fetchDesktopAppUsage() {
      if (!desktopConnected) return null;
      return await this.syncFetch("/desktop-app-usage");
    },

    /** Start polling loops. Call once from background.js initialize(). */
    startDesktopSync() {
      this.checkHealth();
      setInterval(() => this.checkHealth(), SYNC_HEALTH_INTERVAL_MS);
      setInterval(async () => {
        if (!desktopConnected) return;
        if (globalThis.bgPullDesktopState) {
          await globalThis.bgPullDesktopState();
        }
      }, SYNC_PULL_INTERVAL_MS);
    },
  };

  globalThis.FocusGuardSync = Sync;
})();
