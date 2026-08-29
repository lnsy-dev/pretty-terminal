/**
 * Preload Script
 *
 * Exposes a small, explicit IPC bridge to the renderer so the terminal
 * can talk to the node-pty process running in the main process. The
 * renderer itself still has no direct Node or Electron access.
 *
 * The bridge is now tab-aware: every terminal pane owns its own PTY
 * session identified by a tab id supplied by the renderer. IPC payloads
 * include the tab id so the renderer can route output to the right pane.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalPty', {
  /**
   * Spawn a shell in the main process for a specific tab.
   *
   * @param {string|number} tabId - Identifier for the tab's PTY session.
   * @param {string} [shell] - Shell command to run. Defaults to the user's
   *   login shell on macOS/Linux or PowerShell on Windows.
   * @param {number} [cols] - Initial terminal width in columns.
   * @param {number} [rows] - Initial terminal height in rows.
   */
  createTerminal: (tabId, shell, cols, rows) => ipcRenderer.send('terminal-create', { tabId, shell, cols, rows }),

  /**
   * Send keystrokes / input to the shell for a specific tab.
   *
   * @param {string|number} tabId - Tab identifier.
   * @param {string} data
   */
  write: (tabId, data) => ipcRenderer.send('terminal-input', { tabId, data }),

  /**
   * Resize the pseudo-terminal for a specific tab.
   *
   * @param {string|number} tabId - Tab identifier.
   * @param {number} cols
   * @param {number} rows
   */
  resize: (tabId, cols, rows) => ipcRenderer.send('terminal-resize', { tabId, cols, rows }),

  /**
   * Kill the shell process for a specific tab.
   *
   * @param {string|number} tabId - Tab identifier.
   */
  kill: (tabId) => ipcRenderer.send('terminal-kill', { tabId }),

  /**
   * Register a callback for shell output.
   *
   * The callback receives an object `{ tabId, data }` so the renderer can
   * route output to the correct tab.
   *
   * @param {({ tabId: string|number, data: string }) => void} callback
   */
  onData: (callback) => ipcRenderer.on('terminal-output', (_event, { tabId, data }) => callback({ tabId, data })),

  /**
   * Register a callback for when a shell exits.
   *
   * The callback receives an object `{ tabId, exitCode }`.
   *
   * @param {({ tabId: string|number, exitCode: number }) => void} callback
   */
  onExit: (callback) => ipcRenderer.on('terminal-exit', (_event, { tabId, exitCode }) => callback({ tabId, exitCode })),
});

contextBridge.exposeInMainWorld('electronProfiler', {
  /**
   * Register a callback invoked when the main process enables the profiler.
   *
   * @param {() => void} callback
   */
  onEnabled: (callback) => ipcRenderer.on('profiler-enabled', () => callback()),

  /**
   * Register a callback invoked on each metrics tick from the main process.
   *
   * @param {(metrics: object) => void} callback
   */
  onMetrics: (callback) => ipcRenderer.on('profiler-metrics', (_event, metrics) => callback(metrics)),
});

contextBridge.exposeInMainWorld('electronFullscreen', {
  /**
   * Register a callback invoked when the window enters or leaves fullscreen.
   *
   * @param {(isFullscreen: boolean) => void} callback
   */
  onChange: (callback) => ipcRenderer.on('fullscreen-change', (_event, isFullscreen) => callback(isFullscreen)),
});
