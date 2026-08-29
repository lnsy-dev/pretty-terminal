/**
 * Terminal Component Unit Tests
 *
 * Tests the tab keyboard-shortcut logic in isolation. The component's
 * DOM/xterm.js dependencies are mocked so the test can run in Node.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('dataroom-js', () => ({
  default: class DataroomElement {},
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    constructor() {
      this.cols = 80;
      this.rows = 24;
    }

    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    onData() {}
    onScroll() {}
    resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;
    }
    scrollToBottom() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    constructor() {
      this.fitCols = 100;
      this.fitRows = 30;
    }

    fit(terminal) {
      if (terminal) {
        terminal.cols = this.fitCols;
        terminal.rows = this.fitRows;
      }
    }
  },
}));

describe('TerminalComponent tab shortcuts', () => {
  let TerminalComponent;

  beforeAll(async () => {
    vi.stubGlobal('customElements', { get: () => undefined, define: vi.fn() });
    const module = await import('../../src/terminal-component.js');
    TerminalComponent = module.TerminalComponent;
  });

  /**
   * Build a synthetic keyboard event for processTabShortcut.
   *
   * @param {string} key - The key value.
   * @param {boolean} metaKey - Whether the meta key is pressed.
   * @param {boolean} shiftKey - Whether the shift key is pressed.
   * @returns {KeyboardEvent & { preventDefault: Function }}
   */
  function makeEvent(key, metaKey = true, shiftKey = false) {
    return {
      key,
      metaKey,
      ctrlKey: false,
      altKey: false,
      shiftKey,
      preventDefault: vi.fn(),
      defaultPrevented: false,
      type: 'keydown',
    };
  }

  it('switches to tabs 1-9 with Cmd/Ctrl+1-9', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
      { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 },
    ];
    component.setActiveTab = setActiveTab;

    component.processTabShortcut(makeEvent('1'));
    expect(setActiveTab).toHaveBeenCalledWith(1);

    component.processTabShortcut(makeEvent('5'));
    expect(setActiveTab).toHaveBeenCalledWith(5);

    component.processTabShortcut(makeEvent('9'));
    expect(setActiveTab).toHaveBeenCalledWith(9);
  });

  it('switches to the tenth tab with Cmd/Ctrl+0', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
      { id: 6 }, { id: 7 }, { id: 8 }, { id: 9 }, { id: 10 },
    ];
    component.setActiveTab = setActiveTab;

    component.processTabShortcut(makeEvent('0'));
    expect(setActiveTab).toHaveBeenCalledWith(10);
  });

  it('switches to a tab by its retained number, not its array position', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [{ id: 4 }];
    component.setActiveTab = setActiveTab;

    component.processTabShortcut(makeEvent('4'));
    expect(setActiveTab).toHaveBeenCalledWith(4);

    setActiveTab.mockClear();
    component.processTabShortcut(makeEvent('1'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('ignores number switches for tabs that do not exist', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [{ id: 1 }, { id: 2 }];
    component.setActiveTab = setActiveTab;

    component.processTabShortcut(makeEvent('5'));
    expect(setActiveTab).not.toHaveBeenCalled();

    component.processTabShortcut(makeEvent('0'));
    expect(setActiveTab).not.toHaveBeenCalled();
  });

  it('chooses the lowest unused positive integer for a new tab id', () => {
    const component = Object.create(TerminalComponent.prototype);

    component.tabs = [];
    expect(component._nextTabId()).toBe(1);

    component.tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(component._nextTabId()).toBe(4);

    component.tabs = [{ id: 1 }, { id: 4 }];
    expect(component._nextTabId()).toBe(2);

    component.tabs = [{ id: 2 }, { id: 3 }];
    expect(component._nextTabId()).toBe(1);
  });

  it('does not treat plain digit keys as shortcuts', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [{ id: 1 }, { id: 2 }];
    component.setActiveTab = setActiveTab;

    const event = makeEvent('1', false);
    component.processTabShortcut(event);
    expect(setActiveTab).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('opens a new tab with Cmd/Ctrl+T', () => {
    const component = Object.create(TerminalComponent.prototype);
    const openTab = vi.fn();
    component.openTab = openTab;

    const event = makeEvent('t');
    component.processTabShortcut(event);
    expect(openTab).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('splits the active tab with Cmd/Ctrl+Shift+T', () => {
    const component = Object.create(TerminalComponent.prototype);
    const splitActiveTab = vi.fn();
    component.splitActiveTab = splitActiveTab;

    const event = makeEvent('t', true, true);
    component.processTabShortcut(event);
    expect(splitActiveTab).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not split with Cmd/Ctrl+T without shift', () => {
    const component = Object.create(TerminalComponent.prototype);
    component.openTab = vi.fn();
    const splitActiveTab = vi.fn();
    component.splitActiveTab = splitActiveTab;

    component.processTabShortcut(makeEvent('t'));
    expect(splitActiveTab).not.toHaveBeenCalled();
  });

  it('closes the active pane with Cmd/Ctrl+W', () => {
    const component = Object.create(TerminalComponent.prototype);
    const closeActivePane = vi.fn();
    component.closeActivePane = closeActivePane;

    const event = makeEvent('w');
    component.processTabShortcut(event);
    expect(closeActivePane).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe('fitTerminal', () => {
  it('resizes the terminal and forwards the buffered dimensions to the PTY', async () => {
    const { fitTerminal } = await import('../../src/terminal-component.js');
    const terminal = {
      cols: 80,
      rows: 24,
      resize: vi.fn(function resize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
      }),
      scrollToBottom: vi.fn(),
    };
    const fitAddon = {
      fit: vi.fn(() => {
        terminal.cols = 100;
        terminal.rows = 30;
      }),
    };
    const pty = {
      resize: vi.fn(),
    };

    const result = fitTerminal(terminal, fitAddon, pty);

    expect(fitAddon.fit).toHaveBeenCalled();
    expect(terminal.resize).toHaveBeenCalledWith(100, 28);
    expect(pty.resize).toHaveBeenCalledWith(100, 28);
    expect(result).toEqual({ cols: 100, rows: 28 });
  });

  it('does not resize when the terminal is too small for the row buffer', async () => {
    const { fitTerminal } = await import('../../src/terminal-component.js');
    const terminal = {
      cols: 80,
      rows: 1,
      resize: vi.fn(function resize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
      }),
      scrollToBottom: vi.fn(),
    };
    const fitAddon = {
      fit: vi.fn(() => {
        terminal.cols = 80;
        terminal.rows = 1;
      }),
    };
    const pty = {
      resize: vi.fn(),
    };

    const result = fitTerminal(terminal, fitAddon, pty);

    expect(terminal.resize).not.toHaveBeenCalled();
    expect(pty.resize).toHaveBeenCalledWith(80, 1);
    expect(result).toEqual({ cols: 80, rows: 1 });
  });

  it('does not forward the same dimensions twice to the PTY', async () => {
    const { fitTerminal } = await import('../../src/terminal-component.js');
    const terminal = {
      cols: 100,
      rows: 28,
      resize: vi.fn(function resize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
      }),
      scrollToBottom: vi.fn(),
    };
    const fitAddon = {
      fit: vi.fn(() => {
        terminal.cols = 100;
        terminal.rows = 30;
      }),
    };
    const pty = {
      resize: vi.fn(),
    };

    const first = fitTerminal(terminal, fitAddon, pty);
    expect(pty.resize).toHaveBeenCalledTimes(1);
    expect(pty.resize).toHaveBeenLastCalledWith(100, 28);

    pty.resize.mockClear();
    const second = fitTerminal(terminal, fitAddon, pty, first);
    expect(pty.resize).not.toHaveBeenCalled();
    expect(second).toEqual({ cols: 100, rows: 28 });
  });
});
