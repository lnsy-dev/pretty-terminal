/**
 * Electron Main Process PTY Locale Tests
 *
 * Verifies that the pseudo-terminal spawned by the Electron main process
 * is given a UTF-8 locale fallback when the app has no locale environment
 * variables. This prevents commands like `ls` from replacing Unicode
 * characters in filenames with '?'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { spawn } from 'node-pty';

vi.mock('electron', () => ({
  app: {
    whenReady: () => new Promise(() => {}),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}));

// Import the main process module after the Electron and node-pty mocks are
// in place so the IPC handlers are registered against our mocked ipcMain.
await import('../../electron/main.js');

const createHandler = ipcMain.on.mock.calls.find(([name]) => name === 'terminal-create')[1];

describe('Electron PTY locale', () => {
  let savedLocale;

  beforeEach(() => {
    savedLocale = {
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      LC_CTYPE: process.env.LC_CTYPE,
    };
    spawn.mockClear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedLocale)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  /**
   * Build a fake IPC event sender for terminal-create.
   *
   * @param {number} [senderId=1]
   * @returns {{sender: object}}
   */
  function makeEvent(senderId = 1) {
    return {
      sender: {
        id: senderId,
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };
  }

  it('defaults LANG to en_US.UTF-8 when no locale is configured', () => {
    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LC_CTYPE;

    createHandler(makeEvent(1), { tabId: 1, cols: 80, rows: 24 });

    const spawnOptions = spawn.mock.calls[0][2];
    expect(spawnOptions.env.LANG).toBe('en_US.UTF-8');
  });

  it('preserves an existing LANG environment variable', () => {
    process.env.LANG = 'de_DE.UTF-8';
    delete process.env.LC_ALL;
    delete process.env.LC_CTYPE;

    createHandler(makeEvent(2), { tabId: 2, cols: 80, rows: 24 });

    const spawnOptions = spawn.mock.calls[0][2];
    expect(spawnOptions.env.LANG).toBe('de_DE.UTF-8');
  });

  it('does not override an explicit LC_ALL locale', () => {
    delete process.env.LANG;
    process.env.LC_ALL = 'fr_FR.UTF-8';
    delete process.env.LC_CTYPE;

    createHandler(makeEvent(3), { tabId: 3, cols: 80, rows: 24 });

    const spawnOptions = spawn.mock.calls[0][2];
    expect(spawnOptions.env.LANG).toBeUndefined();
    expect(spawnOptions.env.LC_ALL).toBe('fr_FR.UTF-8');
  });
});
