/**
 * Electron Main Process PTY Working Directory Tests
 *
 * Verifies that the pseudo-terminal spawned by the Electron main process:
 *   - starts in the cwd passed by the renderer (so new tabs open where the
 *     user currently is),
 *   - falls back to the home directory when the cwd is missing or no longer
 *     exists (a deleted directory would make spawn() fail),
 *   - and that the terminal-get-cwd handler resolves the live pane's cwd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    pid: 4242,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('../../electron/pty-cwd.js', () => ({
  resolvePtyCwd: vi.fn(),
}));

import { resolvePtyCwd } from '../../electron/pty-cwd.js';

// Import the main process module after the mocks are in place so the IPC
// handlers register against the mocked ipcMain.
await import('../../electron/main.js');

const createHandler = ipcMain.on.mock.calls.find(([name]) => name === 'terminal-create')[1];
const getCwdHandler = ipcMain.handle.mock.calls.find(([name]) => name === 'terminal-get-cwd')[1];

describe('Electron PTY working directory', () => {
  beforeEach(() => {
    spawn.mockClear();
    resolvePtyCwd.mockReset();
  });

  /**
   * Build a fake IPC event sender.
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

  it('spawns the shell in the cwd passed by the renderer', () => {
    createHandler(makeEvent(1), { tabId: 1, cols: 80, rows: 24, cwd: '/tmp' });

    expect(spawn.mock.calls[0][2].cwd).toBe('/tmp');
  });

  it('falls back to HOME when the cwd does not exist', () => {
    createHandler(makeEvent(1), {
      tabId: 2,
      cols: 80,
      rows: 24,
      cwd: '/definitely/not/a/real/directory/xyz',
    });

    expect(spawn.mock.calls[0][2].cwd).toBe(process.env.HOME);
  });

  it('falls back to HOME when no cwd is given', () => {
    createHandler(makeEvent(1), { tabId: 3, cols: 80, rows: 24 });

    expect(spawn.mock.calls[0][2].cwd).toBe(process.env.HOME);
  });

  it('resolves the cwd of a live pane via terminal-get-cwd', async () => {
    createHandler(makeEvent(7), { tabId: 5, cols: 80, rows: 24 });
    resolvePtyCwd.mockResolvedValue('/tmp/live/dir');

    await expect(getCwdHandler(makeEvent(7), { tabId: 5 })).resolves.toBe('/tmp/live/dir');
    expect(resolvePtyCwd).toHaveBeenCalledWith(4242);
  });

  it('resolves null from terminal-get-cwd when the pane has no PTY', async () => {
    await expect(getCwdHandler(makeEvent(9), { tabId: 404 })).resolves.toBeNull();
    expect(resolvePtyCwd).not.toHaveBeenCalled();
  });
});
