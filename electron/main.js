/**
 * Electron Main Process
 *
 * Launches the app as an Electron desktop application.
 *
 * Two load modes:
 *   1. Development: if the webpack dev server answers at ELECTRON_DEV_URL
 *      (read from .env or defaulting to http://localhost:3000, started
 *      with `npm start`), and identifies itself with the custom
 *      X-Pochade-Dev-Server header, the window loads that URL for
 *      hot-reload development.
 *   2. Production: the bundled dist/ directory is served over a custom
 *      privileged `app://` protocol registered below.
 *
 * Why a custom protocol instead of loadFile()? The app relies on web
 * platform features that need a real origin: module web workers,
 * fetching .wasm binaries, and OPFS (Origin Private File System)
 * persistence for the SQLite database. Serving dist/ over a standard,
 * secure scheme makes all of them behave exactly like they do on the
 * web — no special Electron-only code paths.
 *
 * For LLMs: this file runs in Node.js (Electron main), NOT in a browser.
 * Renderer code lives in src/ and index.js. Keep Node/Electron APIs here
 * and web APIs there; the renderer has contextIsolation enabled and no
 * nodeIntegration.
 */

import { app, BrowserWindow, protocol, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { spawn } from 'node-pty';
import { WINDOW_OPTIONS } from './window-options.js';
import { isProfilerEnabled, collectMetrics } from './profiler.js';
import { resolveStartUrl } from './dev-server.js';
import { resolvePtyCwd } from './pty-cwd.js';
import { hasRunningProcesses } from './pty-processes.js';

// Load project-specific environment variables (PORT, ELECTRON_DEV_URL, etc.)
// so the dev server URL matches the one generated when the project was created.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.ELECTRON_DEV_URL || 'http://localhost:3000';

/** Active pseudo-terminals, keyed by `${rendererWebContentsId}:${tabId}`. */
const ptyProcesses = new Map();

/**
 * Quit-guard state.
 *
 * `forceQuit` is set once the user has confirmed quitting (or nothing is
 * running), so the real quit pass is not intercepted again. While a
 * confirmation dialog is open further quit/close requests are swallowed so
 * dialogs never stack.
 */
let forceQuit = false;
let quitConfirmationOpen = false;

/**
 * Check whether any live PTY has user-launched child processes running.
 *
 * @returns {Promise<boolean>}
 */
async function anyPtyHasRunningProcesses() {
  for (const ptyProcess of ptyProcesses.values()) {
    if (await hasRunningProcesses(ptyProcess.pid)) {
      return true;
    }
  }
  return false;
}

/**
 * Ask the user to confirm closing/quitting while processes are running.
 *
 * When nothing is running (or the user confirms) the pending quit/close is
 * carried out by setting forceQuit and re-triggering the original action.
 *
 * @param {BrowserWindow} win - The window being closed (may be undefined).
 * @param {{ quit: boolean }} options - Whether the intent was quitting the
 *   app (Cmd+Q) or just closing its window.
 * @returns {Promise<void>}
 */
async function confirmQuitIfNeeded(win, { quit }) {
  if (quitConfirmationOpen) {
    return;
  }
  quitConfirmationOpen = true;
  try {
    const verb = quit ? 'Quit' : 'Close';
    if (!(await anyPtyHasRunningProcesses())) {
      forceQuit = true;
      if (quit) {
        app.quit();
      } else if (win && !win.isDestroyed()) {
        win.destroy();
      }
      return;
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [verb, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Processes are still running',
      detail: `Terminal processes are still running. ${verb} anyway?`,
    });

    if (response === 0) {
      forceQuit = true;
      if (quit) {
        app.quit();
      } else if (win && !win.isDestroyed()) {
        win.destroy();
      }
    }
  } finally {
    quitConfirmationOpen = false;
  }
}

/**
 * Pick a sensible default shell for the current platform.
 *
 * @returns {string}
 */
function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Terminal IPC bridge.
 *
 * The renderer owns the xterm.js UI but cannot access Node APIs. Each
 * terminal is backed by a real pseudo-terminal spawned here in the main
 * process, giving the user a full system shell.
 */
ipcMain.on('terminal-create', (event, { tabId, shell, cols, rows, cwd }) => {
  const webContents = event.sender;
  const senderId = webContents.id;
  const ptyKey = `${senderId}:${tabId}`;

  if (ptyProcesses.has(ptyKey)) {
    return;
  }

  const shellPath = shell || getDefaultShell();

  // Programs like `ls` decide how to print non-ASCII filenames from the
  // locale. When the app is launched from the macOS Finder/dock the process
  // environment often has no LANG, so the shell defaults to the C locale and
  // replaces Unicode characters with '?'. Default to a UTF-8 locale when none
  // is already configured so Unicode filenames render correctly.
  const ptyEnv = { ...process.env };
  if (!ptyEnv.LANG && !ptyEnv.LC_ALL && !ptyEnv.LC_CTYPE) {
    ptyEnv.LANG = 'en_US.UTF-8';
  }

  // New tabs pass the cwd of the pane they were opened from so the shell
  // starts where the user currently is. The path must still exist (a shell
  // left behind in a deleted directory would make spawn() fail), otherwise
  // fall back to the home directory.
  const spawnCwd = cwd && existsSync(cwd)
    ? cwd
    : process.env.HOME || process.cwd();

  const ptyProcess = spawn(shellPath, [], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: spawnCwd,
    env: ptyEnv,
  });

  ptyProcess.onData((data) => {
    if (!webContents.isDestroyed()) {
      webContents.send('terminal-output', { tabId, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (!webContents.isDestroyed()) {
      webContents.send('terminal-exit', { tabId, exitCode });
    }
    ptyProcesses.delete(ptyKey);
  });

  ptyProcesses.set(ptyKey, ptyProcess);
});

/**
 * Report the working directory of a pane's shell process.
 *
 * The renderer calls this before opening a new tab so the new shell can
 * start in the same directory the user is currently in. Resolves to null
 * when the pane has no live PTY or the cwd cannot be determined.
 */
ipcMain.handle('terminal-get-cwd', async (event, { tabId }) => {
  const ptyProcess = ptyProcesses.get(`${event.sender.id}:${tabId}`);
  if (!ptyProcess) {
    return null;
  }
  return resolvePtyCwd(ptyProcess.pid);
});

/**
 * Report whether a pane's shell has user-launched child processes running
 * (vim, a build, ...). The shell itself always runs while the pane is open,
 * so only children count as "something is running". The renderer uses this
 * to ask for confirmation before closing a pane.
 */
ipcMain.handle('terminal-has-processes', async (event, { tabId }) => {
  const ptyProcess = ptyProcesses.get(`${event.sender.id}:${tabId}`);
  if (!ptyProcess) {
    return false;
  }
  return hasRunningProcesses(ptyProcess.pid);
});

/**
 * Show or clear the silent-bell badge on the app (Dock) icon. The renderer
 * calls this whenever a tab gains or loses an unread bell indicator.
 */
ipcMain.on('terminal-bell-badge', (event, active) => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(active ? '●' : '');
  }
});

ipcMain.on('terminal-input', (event, { tabId, data }) => {
  const ptyProcess = ptyProcesses.get(`${event.sender.id}:${tabId}`);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.on('terminal-resize', (event, { tabId, cols, rows }) => {
  const ptyProcess = ptyProcesses.get(`${event.sender.id}:${tabId}`);
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
});

ipcMain.on('terminal-kill', (event, { tabId }) => {
  const ptyKey = `${event.sender.id}:${tabId}`;
  const ptyProcess = ptyProcesses.get(ptyKey);
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcesses.delete(ptyKey);
  }
});

/** Minimal MIME table for the static files webpack emits into dist/. */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Register `app://` as a privileged scheme.
 * Must run before the app is ready. `standard` + `secure` make the
 * scheme behave like https: for URL parsing and web platform features
 * (workers, OPFS, File System Access API).
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

/**
 * Serve files from dist/ over the app:// protocol.
 *
 * @param {Request} request - The incoming protocol request
 * @returns {Promise<Response>} The file contents or an error response
 */
async function handleAppRequest(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (!pathname || pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.normalize(path.join(DIST_DIR, pathname));

  // Guard against path traversal outside dist/
  if (!filePath.startsWith(DIST_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const data = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, {
      headers: { 'Content-Type': contentType },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

/**
 * Start streaming memory/CPU metrics to the renderer.
 *
 * Sends an initial enable signal after the page loads, then posts a
 * metrics payload every second until the window is destroyed.
 *
 * @param {BrowserWindow} win - The target renderer window
 */
function attachMemoryProfiler(win) {
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('profiler-enabled');

    const interval = setInterval(() => {
      if (win.isDestroyed()) {
        clearInterval(interval);
        return;
      }
      win.webContents.send('profiler-metrics', collectMetrics());
    }, 1000);
  });
}

/**
 * Create the main application window.
 *
 * @returns {Promise<void>}
 */
async function createWindow() {
  const win = new BrowserWindow(WINDOW_OPTIONS);

  if (isProfilerEnabled()) {
    attachMemoryProfiler(win);
  }

  // Capture the WebContents id up front; by the time 'closed' fires the
  // webContents object is already destroyed.
  const windowId = win.webContents.id;

  win.on('closed', () => {
    const prefix = `${windowId}:`;
    for (const [key, ptyProcess] of ptyProcesses.entries()) {
      if (key.startsWith(prefix)) {
        ptyProcess.kill();
        ptyProcesses.delete(key);
      }
    }
  });

  // Confirm before the window closes while shells still have processes
  // running. forceQuit is set once the user confirmed (or nothing runs), so
  // the actual close is not intercepted again.
  win.on('close', (e) => {
    if (forceQuit) {
      return;
    }
    e.preventDefault();
    confirmQuitIfNeeded(win, { quit: false });
  });

  // Notify the renderer when the window enters or leaves fullscreen so the
  // UI can adjust (e.g. hide the drag handle and flush tabs left).
  win.on('enter-full-screen', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('fullscreen-change', true);
    }
  });
  win.on('leave-full-screen', () => {
    if (!win.webContents.isDestroyed()) {
      win.webContents.send('fullscreen-change', false);
    }
  });

  const startUrl = await resolveStartUrl(DEV_SERVER_URL);
  await win.loadURL(startUrl);

  if (!win.webContents.isDestroyed()) {
    win.webContents.send('fullscreen-change', win.isFullScreen());
  }
}

app.whenReady().then(() => {
  protocol.handle('app', handleAppRequest);
  createWindow();

  // macOS: re-create the window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Intercept Cmd+Q / app.quit() so running terminal processes can be
// confirmed first. The window 'close' handler above covers closing the
// window itself; this one covers quitting the whole app.
app.on('before-quit', (e) => {
  if (forceQuit) {
    return;
  }
  e.preventDefault();
  confirmQuitIfNeeded(BrowserWindow.getAllWindows()[0], { quit: true });
});
