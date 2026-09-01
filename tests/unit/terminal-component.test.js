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
    onBell() {}
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
    component.openTab = vi.fn();

    component.processTabShortcut(makeEvent('4'));
    expect(setActiveTab).toHaveBeenCalledWith(4);

    setActiveTab.mockClear();
    component.processTabShortcut(makeEvent('1'));
    expect(setActiveTab).not.toHaveBeenCalled();
    expect(component.openTab).toHaveBeenCalledWith(undefined, 1);
  });

  it('opens a tab with the pressed number when that tab does not exist', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [{ id: 1 }, { id: 2 }];
    component.setActiveTab = setActiveTab;
    component.openTab = vi.fn();

    component.processTabShortcut(makeEvent('5'));
    expect(component.openTab).toHaveBeenCalledWith(undefined, 5);
    expect(setActiveTab).not.toHaveBeenCalled();

    component.openTab.mockClear();
    component.processTabShortcut(makeEvent('0'));
    expect(component.openTab).toHaveBeenCalledWith(undefined, 10);
  });

  it('still switches when the numbered tab exists', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    component.tabs = [{ id: 1 }, { id: 2 }];
    component.setActiveTab = setActiveTab;
    component.openTab = vi.fn();

    component.processTabShortcut(makeEvent('2'));
    expect(setActiveTab).toHaveBeenCalledWith(2);
    expect(component.openTab).not.toHaveBeenCalled();
  });

  it('moves the active session with Cmd+Shift+{number}', () => {
    const component = Object.create(TerminalComponent.prototype);
    const moveActivePaneToTab = vi.fn();
    component.moveActivePaneToTab = moveActivePaneToTab;

    component.processTabShortcut(makeEvent('3', true, true));
    expect(moveActivePaneToTab).toHaveBeenCalledWith(3);

    component.processTabShortcut(makeEvent('0', true, true));
    expect(moveActivePaneToTab).toHaveBeenCalledWith(10);
  });

  it('does not move sessions for plain Cmd+{number}', () => {
    const component = Object.create(TerminalComponent.prototype);
    const setActiveTab = vi.fn();
    const moveActivePaneToTab = vi.fn();
    component.tabs = [{ id: 3 }];
    component.setActiveTab = setActiveTab;
    component.moveActivePaneToTab = moveActivePaneToTab;

    component.processTabShortcut(makeEvent('3'));
    expect(setActiveTab).toHaveBeenCalledWith(3);
    expect(moveActivePaneToTab).not.toHaveBeenCalled();
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

  it('opens a new tab with Cmd+T', () => {
    const component = Object.create(TerminalComponent.prototype);
    const openTab = vi.fn();
    component.openTab = openTab;

    const event = makeEvent('t');
    component.processTabShortcut(event);
    expect(openTab).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not open a new tab with Ctrl+T or Ctrl+Return (Cmd only)', () => {
    const component = Object.create(TerminalComponent.prototype);
    const openTab = vi.fn();
    component.openTab = openTab;

    // New tabs are Cmd-only: Ctrl+T and Ctrl+Return must reach the shell
    // untouched, where terminal programs commonly bind them.
    for (const key of ['t', 'T', 'Enter']) {
      const event = {
        key,
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        defaultPrevented: false,
        type: 'keydown',
      };
      component.processTabShortcut(event);
      expect(openTab).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('opens a new tab with Cmd+Return', () => {
    const component = Object.create(TerminalComponent.prototype);
    const openTab = vi.fn();
    component.openTab = openTab;

    const event = makeEvent('Enter');
    component.processTabShortcut(event);
    expect(openTab).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does not open a new tab with Return alone or Ctrl+Return', () => {
    const component = Object.create(TerminalComponent.prototype);
    const openTab = vi.fn();
    component.openTab = openTab;

    // Plain Return must reach the shell (it sends \\r), and Ctrl+Return is
    // not bound to anything.
    for (const modifiers of [{ metaKey: false, ctrlKey: false }, { metaKey: false, ctrlKey: true }]) {
      const event = {
        key: 'Enter',
        metaKey: modifiers.metaKey,
        ctrlKey: modifiers.ctrlKey,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        defaultPrevented: false,
        type: 'keydown',
      };
      component.processTabShortcut(event);
      expect(openTab).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('swallows Cmd+Return inside an xterm.js pane so the shell never sees it', () => {
    const component = Object.create(TerminalComponent.prototype);
    component.processTabShortcut = vi.fn();

    const event = makeEvent('Enter');
    expect(component.handleTerminalKeyEvent(event)).toBe(false);
    expect(component.processTabShortcut).toHaveBeenCalledWith(event);
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

  it('passes plain Tab presses through to the terminal (no duplication)', () => {
    const component = Object.create(TerminalComponent.prototype);

    // Tab must reach xterm.js / the PTY untouched so the shell receives
    // exactly one "\\t" per keypress for completion.
    const keydown = makeEvent('Tab', false);
    expect(component.handleTerminalKeyEvent(keydown)).toBe(true);

    const keyup = { ...makeEvent('Tab', false), type: 'keyup' };
    expect(component.handleTerminalKeyEvent(keyup)).toBe(true);

    // The global shortcut path must neither act on nor cancel plain Tab.
    const globalEvent = makeEvent('Tab', false);
    component.processTabShortcut(globalEvent);
    expect(globalEvent.preventDefault).not.toHaveBeenCalled();
  });
});
