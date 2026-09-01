/**
 * Electron Quit Guard Tests
 *
 * Verifies that the main process asks for confirmation before quitting
 * (Cmd+Q / app.quit / window close) while any pane's shell still has
 * user-launched child processes running, and that quitting proceeds
 * silently when nothing is running or the user confirms.
 *
 * The main process module keeps quit-guard state (forceQuit, open PTY
 * table) at module scope, so each test imports a fresh instance via
 * vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { BrowserWindowMock, winInstances } = vi.hoisted(() => {
  const winInstances = [];
  const BrowserWindowMock = Object.assign(vi.fn(function BrowserWindow() {
    const win = {
      webContents: {
        id: winInstances.length + 1,
        isDestroyed: () => false,
        send: vi.fn(),
        once: vi.fn(),
      },
      isDestroyed: () => false,
      isFullScreen: () => false,
      loadURL: vi.fn(async () => {}),
      on: vi.fn(),
      destroy: vi.fn(),
    };
    winInstances.push(win);
    return win;
  }), { getAllWindows: vi.fn(() => winInstances) });
  return { BrowserWindowMock, winInstances };
});

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    quit: vi.fn(),
    getName: () => 'pretty-terminal',
  },
  BrowserWindow: BrowserWindowMock,
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../electron/dev-server.js', () => ({
  resolveStartUrl: vi.fn(async () => 'app://local/index.html'),
}));

/**
 * Build a fake IPC event sender.
 *
 * @param {number} senderId
 * @returns {{sender: object}}
 */
function makeEvent(senderId) {
  return {
    sender: {
      id: senderId,
      isDestroyed: () => false,
      send: vi.fn(),
    },
  };
}

/**
 * Flush the microtask/timer queue so async flows settle.
 *
 * @returns {Promise<void>}
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Electron quit guard', () => {
  /** Freshly imported mocks + main-process IPC/window handlers per test. */
  let electron;
  let childProcess;
  let ptyModule;
  let handlers;

  beforeEach(async () => {
    // resetModules re-runs the main-process module (fresh forceQuit/pty
    // state) but keeps the mock instances, so clear their call history and
    // pick the handlers registered by THIS test's import (the last ones).
    vi.clearAllMocks();
    vi.resetModules();
    winInstances.length = 0;

    electron = await import('electron');
    childProcess = await import('node:child_process');
    ptyModule = await import('node-pty');

    await import('../../electron/main.js');
    // Flush the whenReady().then(...) callback so createWindow registers
    // the window 'close' handler.
    await settle();

    const win = winInstances[0];
    const lastRegistration = (mock, name) =>
      mock.mock.calls.filter(([registered]) => registered === name).pop()[1];
    handlers = {
      win,
      beforeQuit: lastRegistration(electron.app.on, 'before-quit'),
      create: lastRegistration(electron.ipcMain.on, 'terminal-create'),
      hasProcesses: lastRegistration(electron.ipcMain.handle, 'terminal-has-processes'),
      close: lastRegistration(win.on, 'close'),
    };
  });

  /**
   * Spawn one PTY through the terminal-create handler.
   *
   * @param {number} senderId - Sender webContents id.
   * @param {number} pid - Fake shell pid.
   * @returns {void}
   */
  function spawnPty(senderId, pid) {
    ptyModule.spawn.mockImplementation(() => ({
      pid,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }));
    handlers.create(makeEvent(senderId), { tabId: 1, cols: 80, rows: 24 });
  }

  it('reports running processes for a pane with children', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, '200\n'));
    spawnPty(10, 100);

    await expect(handlers.hasProcesses(makeEvent(10), { tabId: 1 })).resolves.toBe(true);
  });

  it('reports no processes for a pane without children', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, ''));
    spawnPty(11, 101);

    await expect(handlers.hasProcesses(makeEvent(11), { tabId: 1 })).resolves.toBe(false);
    // Unknown pane ids resolve to false as well.
    await expect(handlers.hasProcesses(makeEvent(11), { tabId: 99 })).resolves.toBe(false);
  });

  it('quits without a dialog when no shell has running processes', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, ''));

    const event = { preventDefault: vi.fn() };
    handlers.beforeQuit(event);
    await settle();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(electron.app.quit).toHaveBeenCalled();

    // The follow-up quit pass is not intercepted again.
    const secondEvent = { preventDefault: vi.fn() };
    handlers.beforeQuit(secondEvent);
    expect(secondEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('asks for confirmation before quitting while processes run', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, '200\n'));
    spawnPty(12, 102);
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 }); // cancel

    const event = { preventDefault: vi.fn() };
    handlers.beforeQuit(event);
    await vi.waitFor(() => expect(electron.dialog.showMessageBox).toHaveBeenCalled());
    await settle();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.dialog.showMessageBox.mock.calls[0][1].buttons).toEqual(['Quit', 'Cancel']);
    expect(electron.app.quit).not.toHaveBeenCalled();

    // User confirms: the quit goes through.
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const secondEvent = { preventDefault: vi.fn() };
    handlers.beforeQuit(secondEvent);
    await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
    expect(secondEvent.preventDefault).toHaveBeenCalled();
  });

  it('does not quit when the user cancels the confirmation', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, '200\n'));
    spawnPty(13, 103);
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 });

    const event = { preventDefault: vi.fn() };
    handlers.beforeQuit(event);
    await vi.waitFor(() => expect(electron.dialog.showMessageBox).toHaveBeenCalled());
    await settle();

    expect(electron.app.quit).not.toHaveBeenCalled();

    // Cancelling releases the guard: a later quit prompts again instead of
    // being silently swallowed.
    const secondEvent = { preventDefault: vi.fn() };
    handlers.beforeQuit(secondEvent);
    await vi.waitFor(() => expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(2));
    expect(secondEvent.preventDefault).toHaveBeenCalled();
  });

  it('confirms before closing the window while processes run', async () => {
    childProcess.execFile.mockImplementation((cmd, args, cb) => cb(null, '200\n'));
    spawnPty(14, 104);
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1 }); // cancel

    const event = { preventDefault: vi.fn() };
    handlers.close(event);
    await vi.waitFor(() => expect(electron.dialog.showMessageBox).toHaveBeenCalled());
    await settle();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(electron.dialog.showMessageBox.mock.calls[0][1].buttons).toEqual(['Close', 'Cancel']);
    expect(handlers.win.destroy).not.toHaveBeenCalled();

    // User confirms the close: the window is destroyed.
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const secondEvent = { preventDefault: vi.fn() };
    handlers.close(secondEvent);
    await vi.waitFor(() => expect(handlers.win.destroy).toHaveBeenCalled());
    expect(secondEvent.preventDefault).toHaveBeenCalled();
  });
});
