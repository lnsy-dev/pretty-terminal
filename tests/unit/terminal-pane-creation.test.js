/**
 * Terminal Pane Creation Unit Tests
 *
 * Verifies that every new xterm.js pane is configured correctly for the
 * Nerd Font ligature addon. These tests catch initialization ordering bugs
 * (e.g. loading LigaturesAddon before open) and missing options
 * (e.g. allowProposedApi) without needing a real browser.
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
      callLog.push({ method: 'open', container, flexAtOpen: container.style.flex });
    }

    onData() {}
    onScroll() {}
    onBell() {}
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
    proposeDimensions() {
      return { cols: 100, rows: 30 };
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
      const element = {
        tagName: tag,
        className: '',
        style: {},
        children: [],
        parent: null,
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
          child.parent = this;
          return child;
        },
        insertBefore(child) {
          this.children.unshift(child);
          child.parent = this;
          return child;
        },
        remove() {
          if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index !== -1) {
              this.parent.children.splice(index, 1);
            }
            this.parent = null;
          }
        },
        addEventListener: () => {},
      };
      return element;
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

  it('assigns the pane its final flex share before the terminal is opened', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = { id: 1, container: component.terminalArea, panes: [] };
    await component.openPane(tab);
    await component.openPane(tab, { insertAfterPaneId: tab.panes[0].id });

    // The container passed to xterm.js open() must already carry the equal
    // flex share, so the terminal's first measurement happens at its real
    // (half) width instead of the CSS default full width.
    const openCalls = callLog.filter((c) => c.method === 'open');
    expect(openCalls).toHaveLength(2);
    expect(openCalls[0].flexAtOpen).toBe('1 1 100%');
    expect(openCalls[1].flexAtOpen).toBe('1 1 50%');

    // The first pane's share is halved by the split as well.
    expect(tab.panes[0].element.style.flex).toBe('1 1 50%');
  });

  describe('moveActivePaneToTab (Cmd+Shift+{number})', () => {
    beforeAll(() => {
      // setActiveTab focuses the active pane on the next frame.
      vi.stubGlobal('requestAnimationFrame', () => {});
    });

    /**
     * Build a component that can create real tabs/panes via openTab.
     *
     * @returns {object} The component instance.
     */
    function makeComponent() {
      const component = Object.create(TerminalComponent.prototype);
      component.tabs = [];
      component.nextPaneId = 1;
      component.activeTabId = null;
      component.terminalArea = globalThis.document.createElement('div');
      component.tabBar = globalThis.document.createElement('div');
      component.newTabButton = globalThis.document.createElement('div');
      component._updateLayoutClass = () => {};
      return component;
    }

    it('moves the active session to an existing tab as a split', async () => {
      const component = makeComponent();
      await component.openTab(undefined, 1);
      await component.openTab(undefined, 2);

      const movedPane = component.tabs[0].panes[0];
      const movedTerminal = movedPane.terminal;
      component.setActiveTab(1);

      const result = component.moveActivePaneToTab(2);

      expect(result).toBe(2);
      // The emptied source tab is gone; tab 2 now holds both sessions.
      expect(component.tabs).toHaveLength(1);
      expect(component.tabs[0].id).toBe(2);
      expect(component.tabs[0].panes).toHaveLength(2);
      expect(component.tabs[0].panes[1]).toBe(movedPane);
      // The session itself is untouched: same terminal instance, still live.
      expect(movedPane.terminal).toBe(movedTerminal);
      expect(movedPane.tabId).toBe(2);
      // The target tab is active with the moved session focused.
      expect(component.activeTabId).toBe(2);
      expect(component.tabs[0].activePaneId).toBe(movedPane.id);
      // Two panes share the tab equally (a split).
      expect(component.tabs[0].panes[0].element.style.flex).toBe('1 1 50%');
      expect(component.tabs[0].panes[1].element.style.flex).toBe('1 1 50%');
    });

    it('moves the session to a new tab when the number does not exist', async () => {
      const component = makeComponent();
      await component.openTab(undefined, 1);

      const movedPane = component.tabs[0].panes[0];

      component.moveActivePaneToTab(5);

      expect(component.tabs).toHaveLength(1);
      expect(component.tabs[0].id).toBe(5);
      expect(component.tabs[0].panes).toEqual([movedPane]);
      expect(component.activeTabId).toBe(5);
      // A lone pane keeps the full width.
      expect(component.tabs[0].panes[0].element.style.flex).toBe('1 1 100%');
    });

    it('is a no-op when the target is the pane\'s current tab', async () => {
      const component = makeComponent();
      await component.openTab(undefined, 1);

      const result = component.moveActivePaneToTab(1);

      expect(result).toBe(1);
      expect(component.tabs).toHaveLength(1);
      expect(component.tabs[0].panes).toHaveLength(1);
      expect(component.activeTabId).toBe(1);
    });

    it('keeps the source tab alive when other panes remain', async () => {
      const component = makeComponent();
      await component.openTab(undefined, 1);
      await component.openTab(undefined, 2);

      const tab1 = component.tabs[0];
      const tab2 = component.tabs[1];
      await component.openPane(tab1, { insertAfterPaneId: tab1.panes[0].id });
      component.setActiveTab(1);

      const movedPane = component.getActivePane();
      component.moveActivePaneToTab(2);

      expect(tab1.panes).toHaveLength(1);
      expect(tab2.panes).toHaveLength(2);
      expect(tab2.panes).toContain(movedPane);
      // The remaining pane is the active one of the source tab.
      expect(tab1.activePaneId).toBe(tab1.panes[0].id);
      expect(tab1.panes[0].element.style.flex).toBe('1 1 100%');
      expect(component.activeTabId).toBe(2);
    });
  });

  it('reflowPanes assigns equal flex shares without resizing terminals', async () => {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');

    const tab = { id: 1, container: component.terminalArea, panes: [] };
    await component.openPane(tab);
    await component.openPane(tab, { insertAfterPaneId: tab.panes[0].id });

    callLog.length = 0;
    tab.panes.forEach((pane) => {
      pane.element.style.flex = '1 1 100%';
    });

    component.reflowPanes(tab);

    expect(tab.panes[0].element.style.flex).toBe('1 1 50%');
    expect(tab.panes[1].element.style.flex).toBe('1 1 50%');
    // Resizing is the observer/fitPane path's job, not reflow's.
    const resizeCall = callLog.find((c) => c.method === 'resize');
    expect(resizeCall).toBeUndefined();
  });

  describe('new tab cwd inheritance', () => {
    /**
     * Install a fake PTY bridge that records createTerminal calls.
     *
     * @param {string|null} cwd - Value the fake getCwd resolves with.
     * @returns {Array<{paneId: number, cwd: string}>} Recorded spawn calls.
     */
    function installFakePty(cwd) {
      const created = [];
      globalThis.window.terminalPty = {
        onData: () => {},
        onExit: () => {},
        getCwd: () => Promise.resolve(cwd),
        createTerminal: (paneId, shell, cols, rows, spawnCwd) => created.push({ paneId, cwd: spawnCwd }),
      };
      return created;
    }

    /**
     * Build a component with tab 1 (pane 1, live PTY) active, ready for
     * openTab to be called.
     *
     * @param {object} [tabOverrides]
     * @returns {object} The component instance.
     */
    function makeComponentWithActivePane() {
      const component = Object.create(TerminalComponent.prototype);
      component.tabs = [{ id: 1, panes: [{ id: 1, ptyCreated: true }], activePaneId: 1 }];
      component.nextPaneId = 2;
      component.activeTabId = 1;
      component.terminalArea = globalThis.document.createElement('div');
      component.tabBar = globalThis.document.createElement('div');
      component.newTabButton = globalThis.document.createElement('div');
      component._updateLayoutClass = () => {};
      component.setActiveTab = (id) => {
        component.activeTabId = id;
      };
      return component;
    }

    afterEach(() => {
      globalThis.window.terminalPty = null;
    });

    it('spawns new-tab shells in the active pane working directory', async () => {
      const created = installFakePty('/Users/lnsy/Code/pretty-terminal');
      const component = makeComponentWithActivePane();

      await component.openTab();

      expect(created).toHaveLength(1);
      expect(created[0].cwd).toBe('/Users/lnsy/Code/pretty-terminal');
    });

    it('uses the default directory when no pane is active (first tab)', async () => {
      const created = installFakePty('/Users/lnsy/Code/pretty-terminal');
      const component = makeComponentWithActivePane();
      component.tabs = [];
      component.activeTabId = null;

      await component.openTab();

      expect(created).toHaveLength(1);
      expect(created[0].cwd).toBeNull();
    });

    it('uses the default directory when getCwd fails', async () => {
      const created = installFakePty('/Users/lnsy/Code/pretty-terminal');
      globalThis.window.terminalPty.getCwd = () => Promise.reject(new Error('bridge gone'));
      const component = makeComponentWithActivePane();

      await component.openTab();

      expect(created).toHaveLength(1);
      expect(created[0].cwd).toBeNull();
    });
  });
});
