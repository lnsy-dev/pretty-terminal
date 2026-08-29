/**
 * Terminal Split/Resize Lifecycle Unit Tests
 *
 * Verifies the resize behavior of the pane lifecycle: splitting a tab,
 * closing a pane, switching tabs, and the ResizeObserver funnel. These tests
 * guard against regressions where a split produced spurious intermediate
 * resizes (full-width -> half-width) that made fullscreen apps (vim, micro)
 * redraw and zsh print PROMPT_SP "%" markers.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Captured ResizeObserver callbacks, one per observed pane, so tests can
// simulate layout changes.
let observerCallbacks = [];

// Dimensions every FitAddon mock reports on its next measurement.
let nextDims = { cols: 100, rows: 30 };

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
      this.resizeCalls = [];
    }

    attachCustomKeyEventHandler() {}

    loadAddon(addon) {
      if (typeof addon.activate === 'function') {
        addon.activate(this);
      }
    }

    open() {}

    resize(cols, rows) {
      this.resizeCalls.push({ cols, rows });
      this.cols = cols;
      this.rows = rows;
    }

    onData() {}
    onScroll() {}
    scrollToBottom() {}
    focus() {}
    writeln() {}
    write() {}
    dispose() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    activate(terminal) {
      this.terminal = terminal;
    }
    proposeDimensions() {
      return nextDims;
    }
  },
}));

vi.mock('@xterm/addon-ligatures', () => ({
  LigaturesAddon: class LigaturesAddon {},
}));

describe('TerminalComponent split/resize lifecycle', () => {
  let TerminalComponent;

  beforeAll(async () => {
    vi.stubGlobal('customElements', { get: () => undefined, define: vi.fn() });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        constructor(callback) {
          this.callback = callback;
          observerCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );

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
        remove() {},
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
      terminalPty: {
        createTerminal: vi.fn(),
        resize: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
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
    vi.useFakeTimers();
    observerCallbacks = [];
    nextDims = { cols: 100, rows: 30 };
    window.terminalPty.createTerminal.mockClear();
    window.terminalPty.resize.mockClear();
    window.terminalPty.kill.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Build a component with one tab containing one open pane.
   *
   * @returns {{component: Object, tab: Object}}
   */
  async function setupSinglePane() {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = 1;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = {
      id: 1,
      element: globalThis.document.createElement('div'),
      container: component.terminalArea,
      panes: [],
      activePaneId: null,
    };
    component.tabs.push(tab);
    await component.openPane(tab);

    return { component, tab };
  }

  /**
   * Fire the ResizeObserver callback for the given pane index (0-based,
   * in creation order) and run out the debounce.
   *
   * @param {number} index
   */
  async function fireObserver(index) {
    observerCallbacks[index]();
    await vi.advanceTimersByTimeAsync(150);
  }

  it('spawns the PTY once, at the fitted size, when a pane opens', async () => {
    const { tab } = await setupSinglePane();

    expect(window.terminalPty.createTerminal).toHaveBeenCalledTimes(1);
    expect(window.terminalPty.createTerminal).toHaveBeenCalledWith(tab.panes[0].id, undefined, 100, 30);
    expect(tab.panes[0].ptyCreated).toBe(true);
  });

  it('sends exactly one PTY resize per pane when a split changes their size', async () => {
    const { component, tab } = await setupSinglePane();
    await component.openPane(tab, { insertAfterPaneId: tab.panes[0].id });

    // Both PTYs are running; nothing has been resized yet.
    expect(window.terminalPty.resize).not.toHaveBeenCalled();

    // Simulate the layout settling after the split: both panes halve.
    nextDims = { cols: 50, rows: 30 };
    await fireObserver(0);
    await fireObserver(1);

    const resizes = window.terminalPty.resize.mock.calls;
    expect(resizes).toHaveLength(2);
    expect(resizes).toContainEqual([50, 30]);

    // Firing again with unchanged dimensions must not produce more resizes.
    await fireObserver(0);
    await fireObserver(1);
    expect(window.terminalPty.resize).toHaveBeenCalledTimes(2);
  });

  it('does not resize the new pane to full width before halving it on split', async () => {
    const { component, tab } = await setupSinglePane();

    await component.openPane(tab, { insertAfterPaneId: tab.panes[0].id });

    // Every resize the second pane's terminal has seen must be the same,
    // settled size — no full-width intermediate step.
    const newPane = tab.panes[1];
    const distinct = new Set(newPane.terminal.resizeCalls.map((r) => `${r.cols}x${r.rows}`));
    expect(distinct.size).toBe(1);
  });

  it('refits the remaining pane to full width when a split pane is closed', async () => {
    const { component, tab } = await setupSinglePane();
    await component.openPane(tab, { insertAfterPaneId: tab.panes[0].id });

    nextDims = { cols: 50, rows: 30 };
    await fireObserver(0);
    await fireObserver(1);

    component.closePane(tab.panes[1].id);

    expect(tab.panes).toHaveLength(1);
    expect(tab.panes[0].element.style.flex).toBe('1 1 100%');

    // The remaining pane grows back to full width.
    nextDims = { cols: 100, rows: 30 };
    await fireObserver(0);

    expect(window.terminalPty.resize).toHaveBeenLastCalledWith(100, 30);
  });

  it('ignores size changes for panes in an inactive tab', async () => {
    const { component, tab } = await setupSinglePane();
    component.activeTabId = 999;

    nextDims = { cols: 50, rows: 30 };
    await fireObserver(0);

    expect(tab.panes[0].terminal.resizeCalls).toHaveLength(1); // initial fit only
    expect(window.terminalPty.resize).not.toHaveBeenCalled();
  });

  it('fits panes synchronously when their tab becomes active', async () => {
    const { component, tab } = await setupSinglePane();
    const pane = tab.panes[0];

    // Simulate the tab being hidden: its container is display:none and the
    // measured size drifts while hidden.
    component.activeTabId = 2;
    component.tabs.push({
      id: 2,
      element: globalThis.document.createElement('div'),
      container: globalThis.document.createElement('div'),
      panes: [],
      activePaneId: null,
    });

    nextDims = { cols: 60, rows: 20 };
    component.setActiveTab(1);

    // No observer, no timers: the explicit fit pass applies the new size.
    expect(pane.terminal.cols).toBe(60);
    expect(pane.terminal.rows).toBe(20);
    expect(window.terminalPty.resize).toHaveBeenLastCalledWith(60, 20);
  });
});
