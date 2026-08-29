/**
 * Terminal Pane Creation Unit Tests
 *
 * Verifies that every new xterm.js pane is configured correctly for the
 * Nerd Font ligature addon. These tests catch initialization ordering bugs
 * (e.g. loading LigaturesAddon before open) and missing options
 * (e.g. allowProposedApi) without needing a real browser.
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

    onData() {}
    onScroll() {}
    resize(cols, rows) {
      callLog.push({ method: 'resize', cols, rows });
      this.cols = cols;
      this.rows = rows;
    }
    scrollToBottom() {}
    focus() {}
    writeln() {}
    write() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    constructor() {
      this.name = 'FitAddon';
      this.terminal = null;
    }
    activate(terminal) {
      this.terminal = terminal;
    }
    fit() {
      if (this.terminal) {
        this.terminal.cols = 100;
        this.terminal.rows = 30;
      }
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

describe('TerminalComponent pane creation', () => {
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
    vi.stubGlobal('window', {
      matchMedia: () => ({ addEventListener: () => {} }),
      addEventListener: () => {},
      terminalPty: null,
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
  });

  it('creates a terminal with allowProposedApi enabled', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    await component.openPane({ id: 1, container: component.terminalArea, panes: [] });

    const constructorCall = callLog.find((c) => c.method === 'constructor');
    expect(constructorCall.options.allowProposedApi).toBe(true);
  });

  it('opens the terminal before loading the ligatures addon', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    await component.openPane({ id: 1, container: component.terminalArea, panes: [] });

    const openIndex = callLog.findIndex((c) => c.method === 'open');
    const ligaturesIndex = callLog.findIndex(
      (c) => c.method === 'loadAddon' && c.addonName === 'LigaturesAddon'
    );

    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(ligaturesIndex).toBeGreaterThanOrEqual(0);
    expect(ligaturesIndex).toBeGreaterThan(openIndex);
  });

  it('fits the terminal to the container immediately after opening', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    await component.openPane({ id: 1, container: component.terminalArea, panes: [] });

    const openIndex = callLog.findIndex((c) => c.method === 'open');
    const resizeIndex = callLog.findIndex((c) => c.method === 'resize');

    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(resizeIndex).toBeGreaterThan(openIndex);
  });

  it('reflows a pane before its PTY is created so the grid stays current', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = { id: 1, container: component.terminalArea, panes: [] };
    await component.openPane(tab);

    // Simulate a pane whose PTY has been attached but not yet created.
    const [pane] = tab.panes;
    pane.pty = { resize: vi.fn() };
    pane.ptyCreated = false;

    callLog.length = 0;
    component.reflowPanes(tab);

    // The terminal should still be resized even though the PTY does not exist
    // yet, so the rendered grid does not drift from the container.
    const resizeCall = callLog.find((c) => c.method === 'resize');
    expect(resizeCall).toBeDefined();
    expect(pane.pty.resize).not.toHaveBeenCalled();
  });
});
