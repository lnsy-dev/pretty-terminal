/**
 * Terminal PTY Attachment Unit Tests
 *
 * Verifies that the Electron PTY bridge is created with the terminal's real
 * fitted dimensions. Starting the PTY at the wrong size (e.g. xterm.js's
 * default 80x24) causes zsh's PROMPT_SP to emit a leading "%" when the shell
 * prompt is printed before the resize arrives.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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
      this.fitCount = 0;
    }
    activate(terminal) {
      this.terminal = terminal;
    }
    fit() {
      if (!this.terminal) {
        return;
      }
      this.fitCount += 1;
      const size = fitAddonSequence[this.fitCount - 1] || { cols: 100, rows: 30 };
      this.terminal.cols = size.cols;
      this.terminal.rows = size.rows;
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
    // fitAddon.fit() sets 100x30, fitTerminal subtracts the 2-row buffer.
    expect(createCall[2]).toBe(100);
    expect(createCall[3]).toBe(28);

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
    expect(createCall[3]).toBe(28);

    vi.useRealTimers();
  });
});
