/* ============================================================
   FocusGuard — Desktop Sync Bridge (browser side)  v1.7.4
   ------------------------------------------------------------
   Talks to the FocusGuard Desktop app's HTTP broker on
   localhost:9472 (see src-tauri/src/sync_server.rs).

   Loaded BEFORE background.js in both Firefox (background.scripts)
   and Chrome (service_worker importScripts). Attaches helpers to
   `globalThis.FocusGuardSync` so background.js can call them.

   Broker protocol (v1.7.4):
     GET  /health            → { ok, version, desktop }
     GET  /state             → merged view (see pullStateFromDesktop)
     POST /state             → extension pushes its full blob
     POST /desktop-state     → desktop frontend pushes its full blob
     GET  /desktop-app-usage → per-date native app usage

   Dedup: the broker canonicalizes incoming POST bodies and skips the
   store + emit when the payload is byte-identical to the last one. We
   mirror that on the client: pushStateToDesktop skips the POST when
   the canonical JSON equals what we last pushed, so a per-second timer
   tick that produced the same blob never hits the network.

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
  /** Canonical JSON of the last successful push — used to skip no-op pushes. */
  let lastPushedJson = "";

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

    /**
     * Push the full state blob to the desktop broker.
     *
     * Two layers of dedup protect against feedback loops:
     *   1. throttle: never more than once per PUSH_THROTTLE_MS,
     *   2. content: skip the POST when the canonical JSON equals the last
     *      push (mirrors the broker's own dedup, but saves the network hop).
     */
    async pushStateToDesktop(state) {
      if (!desktopConnected) return;
      const now = Date.now();
      if (now - lastPushedAt < PUSH_THROTTLE_MS) return;

      const json = canonicalJson(state);
      if (json === lastPushedJson) return; // nothing changed

      lastPushedAt = now;
      const ok = await this.syncFetch("/state", {
        method: "POST",
        body: state,
        timeoutMs: 4000,
      });
      if (ok) lastPushedJson = json;
    },

    /**
     * Pull the broker's merged view. Shape (v1.7.4):
     *   {
     *     extension, extensionUpdatedAt, extensionConnected,
     *     desktop,   desktopUpdatedAt,
     *     mergedTimer   // convenience: the timer with the newer lastTick
     *   }
     * Callers merge `desktop` (NOT `extension` — that's our own echo) to
     * pick up changes made on the desktop app. Returns null if disconnected.
     */
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

    /** Reset dedup state (used when the desktop reconnects after a gap). */
    resetPushCache() {
      lastPushedJson = "";
      lastPushedAt = 0;
    },
  };

  /**
   * Stable string form of a payload so two blobs with the same content but
   * different key ordering compare equal. JSON.stringify with a replacer
   * that re-inserts object keys in sorted order gives us a canonical form
   * without pulling a dependency.
   */
  function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
  }

  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
      return out;
    }
    return value;
  }

  globalThis.FocusGuardSync = Sync;
})();
