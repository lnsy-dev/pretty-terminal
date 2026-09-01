/**
 * Terminal PTY Attachment Unit Tests
 *
 * Verifies that the Electron PTY bridge is created with the terminal's real
 * fitted dimensions. Starting the PTY at the wrong size (e.g. xterm.js's
 * default 80x24) causes zsh's PROMPT_SP to emit a leading "%" when the shell
 * prompt is printed before the resize arrives.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const callLog = [];

vi.mock('dataroom-js', () => ({
  default: class DataroomElement {
    create(tag, options = {}, parent) {
      const el = globalThis.document.createElement(tag);
      Object.entries(options).forEach(([key, value]) => {
        if (key === 'class') {
          el.className = value;
        } else if (key === 'content') {
          el.textContent = value;
        } else {
          el.setAttribute(key, value);
        }
      });
      if (parent) {
        parent.appendChild(el);
      }
      return el;
    }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      callLog.push({ method: 'constructor', options });
    }

    attachCustomKeyEventHandler() {
      callLog.push({ method: 'attachCustomKeyEventHandler' });
    }

    loadAddon(addon) {
      callLog.push({ method: 'loadAddon', addonName: addon.constructor.name });
      if (typeof addon.activate === 'function') {
        addon.activate(this);
      }
    }

    open(container) {
      callLog.push({ method: 'open', container });
    }

    resize(cols, rows) {
      callLog.push({ method: 'resize', cols, rows });
      this.cols = cols;
      this.rows = rows;
    }

    onData() {}
    onScroll() {}
    onBell() {}
    scrollToBottom() {}
    focus() {}
    writeln() {}
    write() {}
  },
}));

// Tests can set this array to make FitAddon return different sizes on each
// call. This simulates a container that needs more than one layout pass to
// reach its real dimensions.
let fitAddonSequence = [];

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    constructor() {
      this.name = 'FitAddon';
      this.terminal = null;
      this.measureCount = 0;
    }
    activate(terminal) {
      this.terminal = terminal;
    }
    proposeDimensions() {
      this.measureCount += 1;
      return fitAddonSequence[this.measureCount - 1] || { cols: 100, rows: 30 };
    }
  },
}));

vi.mock('@xterm/addon-ligatures', () => ({
  LigaturesAddon: class LigaturesAddon {
    constructor() {
      this.name = 'LigaturesAddon';
    }
  },
}));

describe('TerminalComponent PTY attachment', () => {
  let TerminalComponent;

  beforeAll(async () => {
    vi.stubGlobal('customElements', { get: () => undefined, define: vi.fn() });
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      disconnect() {}
    });

    function createMockElement(tag) {
      const classes = new Set();
      return {
        tagName: tag,
        className: '',
        style: {},
        children: [],
        attributes: {},
        textContent: '',
        classList: {
          add: (name) => classes.add(name),
          remove: (name) => classes.delete(name),
          contains: (name) => classes.has(name),
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name];
        },
        appendChild(child) {
          this.children.push(child);
          return child;
        },
        insertBefore(child) {
          this.children.unshift(child);
          return child;
        },
        addEventListener: () => {},
      };
    }

    vi.stubGlobal('document', {
      fonts: { ready: Promise.resolve() },
      addEventListener: () => {},
      querySelector: () => null,
      body: { appendChild: () => {} },
      createElement: createMockElement,
    });
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
    vi.stubGlobal('window', {
      matchMedia: () => ({ addEventListener: () => {} }),
      addEventListener: () => {},
      requestAnimationFrame: (cb) => setTimeout(cb, 0),
      terminalPty: {
        createTerminal: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
      },
    });
    vi.stubGlobal('getComputedStyle', () => ({
      fontFamily: "'Atkinson Hyperlegible Mono', monospace",
      fontSize: '14px',
      getPropertyValue: () => '',
    }));

    const module = await import('../../src/terminal-component.js');
    TerminalComponent = module.TerminalComponent;
  });

  beforeEach(() => {
    callLog.length = 0;
    fitAddonSequence = [];
    window.terminalPty.createTerminal.mockClear();
  });

  it('creates the PTY with the fitted terminal size', async () => {
    vi.useFakeTimers();

    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = { id: 1, container: component.terminalArea, panes: [] };
    const openPanePromise = component.openPane(tab);
    await vi.runAllTimersAsync();
    await openPanePromise;

    const createCall = window.terminalPty.createTerminal.mock.calls[0];
    expect(createCall).toBeDefined();
    // proposeDimensions() yields 100x30; the exact fitted size is forwarded
    // with no rows subtracted.
    expect(createCall[2]).toBe(100);
    expect(createCall[3]).toBe(30);

    vi.useRealTimers();
  });

  it('creates the PTY with the settled size after the container reflows', async () => {
    vi.useFakeTimers();

    // Simulate FitAddon measuring the container at 80x24 on the first layout
    // pass and 100x30 on the second pass. The PTY must be created with the
    // second, settled size so zsh's PROMPT_SP does not print "%".
    fitAddonSequence = [
      { cols: 80, rows: 24 },
      { cols: 100, rows: 30 },
    ];

    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = { id: 1, container: component.terminalArea, panes: [] };
    const openPanePromise = component.openPane(tab);
    await vi.runAllTimersAsync();
    await openPanePromise;

    const createCall = window.terminalPty.createTerminal.mock.calls[0];
    expect(createCall).toBeDefined();
    expect(createCall[2]).toBe(100);
    expect(createCall[3]).toBe(30);

    // The PTY is spawned exactly once.
    expect(window.terminalPty.createTerminal).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  describe('close-pane process confirmation', () => {
    let originalBridge;

    beforeEach(() => {
      originalBridge = window.terminalPty;
    });

    afterEach(() => {
      window.terminalPty = originalBridge;
      delete window.confirm;
    });

    /**
     * Build a minimal fake pane as _teardownPane would see it.
     *
     * @param {number} id - Pane id.
     * @param {object} tab - Owning tab.
     * @returns {object} The fake pane.
     */
    function makeFakePane(id, tab) {
      return {
        id,
        tabId: tab.id,
        element: { remove: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() }, style: {} },
        terminal: { dispose: vi.fn(), focus: vi.fn() },
        shell: null,
        pty: window.terminalPty,
        ptyCreated: true,
        cwd: null,
      };
    }

    /**
     * Build a component with two tabs, each holding one pane.
     *
     * @returns {{ component: object, tab1: object, tab2: object, p1: object, p2: object }}
     */
    function makeComponent() {
      const component = Object.create(TerminalComponent.prototype);
      component.tabs = [];
      component.nextPaneId = 100;
      component.activeTabId = 2;
      component.terminalArea = globalThis.document.createElement('div');
      component._updateLayoutClass = () => {};

      const tab1 = { id: 1, element: { remove: vi.fn() }, container: { remove: vi.fn() }, panes: [], activePaneId: null };
      const tab2 = { id: 2, element: { remove: vi.fn() }, container: { remove: vi.fn() }, panes: [], activePaneId: null };
      const p1 = makeFakePane(11, tab1);
      const p2 = makeFakePane(12, tab2);
      tab1.panes.push(p1);
      tab1.activePaneId = 11;
      tab2.panes.push(p2);
      tab2.activePaneId = 12;
      component.tabs.push(tab1, tab2);

      return { component, tab1, tab2, p1, p2 };
    }

    function makeBridge(overrides = {}) {
      return {
        createTerminal: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        kill: vi.fn(),
        hasProcesses: vi.fn(async () => false),
        ...overrides,
      };
    }

    it('closes without prompting when no processes are running', async () => {
      window.terminalPty = makeBridge();
      window.confirm = vi.fn();
      const { component, tab1, p1 } = makeComponent();

      await component.closePane(p1.id);

      expect(window.terminalPty.hasProcesses).toHaveBeenCalledWith(11);
      expect(window.confirm).not.toHaveBeenCalled();
      expect(window.terminalPty.kill).toHaveBeenCalledWith(11);
      expect(p1.terminal.dispose).toHaveBeenCalled();
      expect(tab1.panes).toHaveLength(0);
      expect(component.tabs.map((t) => t.id)).toEqual([2]);
    });

    it('closes when the user confirms the running-process warning', async () => {
      window.terminalPty = makeBridge({ hasProcesses: vi.fn(async () => true) });
      window.confirm = vi.fn(() => true);
      const { component, tab1, p1 } = makeComponent();

      await component.closePane(p1.id);

      expect(window.confirm).toHaveBeenCalledWith('A process is still running in this terminal. Close anyway?');
      expect(window.terminalPty.kill).toHaveBeenCalledWith(11);
      expect(tab1.panes).toHaveLength(0);
      expect(component.tabs.map((t) => t.id)).toEqual([2]);
    });

    it('keeps the pane open when the user cancels the warning', async () => {
      window.terminalPty = makeBridge({ hasProcesses: vi.fn(async () => true) });
      window.confirm = vi.fn(() => false);
      const { component, tab1, p1 } = makeComponent();

      await component.closePane(p1.id);

      expect(window.confirm).toHaveBeenCalled();
      expect(window.terminalPty.kill).not.toHaveBeenCalled();
      expect(p1.terminal.dispose).not.toHaveBeenCalled();
      expect(tab1.panes).toEqual([p1]);
      expect(component.tabs.map((t) => t.id)).toEqual([1, 2]);
    });

    it('never prompts for panes without a live PTY', async () => {
      window.terminalPty = makeBridge();
      window.confirm = vi.fn();
      const { component, p1 } = makeComponent();
      p1.ptyCreated = false;

      await component.closePane(p1.id);

      expect(window.terminalPty.hasProcesses).not.toHaveBeenCalled();
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it('never prompts when the PTY bridge cannot check processes', async () => {
      window.terminalPty = makeBridge({ hasProcesses: undefined });
      window.confirm = vi.fn();
      const { component, p1 } = makeComponent();

      await component.closePane(p1.id);

      expect(window.confirm).not.toHaveBeenCalled();
      expect(window.terminalPty.kill).toHaveBeenCalledWith(11);
    });
  });
});
