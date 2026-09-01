/**
 * Electron Bell Badge Unit Tests
 *
 * Verifies the terminal-bell-badge IPC handler: on macOS it shows the
 * silent-bell marker on the app (Dock) icon when a tab has an unread bell
 * and clears it when none do; on other platforms it is a no-op.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { BrowserWindowMock } = vi.hoisted(() => ({
  BrowserWindowMock: Object.assign(
    vi.fn(function BrowserWindow() {
      return {
        webContents: { id: 1, isDestroyed: () => false, send: vi.fn(), once: vi.fn() },
        isDestroyed: () => false,
        isFullScreen: () => false,
        loadURL: vi.fn(async () => {}),
        on: vi.fn(),
        destroy: vi.fn(),
      };
    }),
    { getAllWindows: vi.fn(() => []) }
  ),
}));

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    quit: vi.fn(),
    getName: () => 'pretty-terminal',
    dock: { setBadge: vi.fn() },
  },
  BrowserWindow: BrowserWindowMock,
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../electron/dev-server.js', () => ({ resolveStartUrl: vi.fn(async () => 'x') }));

describe('terminal-bell-badge handler', () => {
  let electron;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    electron = await import('electron');
    await import('../../electron/main.js');
    await new Promise((r) => setTimeout(r, 0));
  });

  function bellBadgeHandler() {
    const calls = electron.ipcMain.on.mock.calls.filter(([name]) => name === 'terminal-bell-badge');
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1];
  }

  it('sets the dock badge when a tab has an unread bell', () => {
    const handler = bellBadgeHandler();

    handler(null, true);

    expect(electron.app.dock.setBadge).toHaveBeenLastCalledWith('●');
  });

  it('clears the dock badge when no tab has a bell', () => {
    const handler = bellBadgeHandler();

    handler(null, false);

    expect(electron.app.dock.setBadge).toHaveBeenLastCalledWith('');
  });

  it('is a no-op on non-macOS platforms', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const handler = bellBadgeHandler();

      handler(null, true);

      expect(electron.app.dock.setBadge).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
