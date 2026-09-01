/**
 * Terminal Silent-Bell Unit Tests
 *
 * Verifies the silent-bell indicator: a BEL from a background pane marks the
 * owning tab (tiny red dot via the .has-bell class) and badges the app icon;
 * the indicator clears as soon as the user opens the tab. Bells from the
 * already-active tab are ignored.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const terminalInstances = [];

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
    constructor() {
      this.cols = 80;
      this.rows = 24;
      terminalInstances.push(this);
    }

    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    onData() {}
    onScroll() {}
    onBell(cb) {
      this.bellCb = cb;
    }
    resize() {}
    scrollToBottom() {}
    focus() {}
    writeln() {}
    write() {}
    dispose() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    constructor() {
      this.name = 'FitAddon';
    }
    activate() {}
    proposeDimensions() {
      return { cols: 100, rows: 30 };
    }
    fit() {}
  },
}));

vi.mock('@xterm/addon-ligatures', () => ({
  LigaturesAddon: class LigaturesAddon {
    constructor() {
      this.name = 'LigaturesAddon';
    }
  },
}));

describe('TerminalComponent silent bell', () => {
  let TerminalComponent;

  beforeAll(async () => {
    vi.stubGlobal('customElements', { get: () => undefined, define: vi.fn() });
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
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
          toggle: (name, force) => {
            if (force) {
              classes.add(name);
            } else {
              classes.delete(name);
            }
          },
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
      fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
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
    terminalInstances.length = 0;
    window.terminalPty = null;
  });

  afterEach(() => {
    window.terminalPty = null;
  });

  /**
   * Build a component with an active tab (id 1) and open a pane in it.
   *
   * @returns {Promise<Object>} { component, activeTab }
   */
  async function makeComponentWithActiveTab() {
    const component = Object.create(TerminalComponent.prototype);
    component.tabs = [];
    component.nextPaneId = 1;
    component.activeTabId = null;
    component.terminalArea = globalThis.document.createElement('div');
    component.tabBar = globalThis.document.createElement('div');
    component.newTabButton = globalThis.document.createElement('div');
    component._updateLayoutClass = () => {};

    const activeTab = component._createTab(1);
    await component.openPane(activeTab);
    component.activeTabId = 1;
    return { component, activeTab };
  }

  it('creates a bell dot element on every tab', async () => {
    const { component } = await makeComponentWithActiveTab();
    const tab = component._createTab(2);

    const dot = tab.element.children.find((c) => c.className === 'tab-bell-dot');
    expect(dot).toBeDefined();
  });

  it('marks a background tab when its pane rings the bell and badges the app icon', async () => {
    const { component, activeTab } = await makeComponentWithActiveTab();
    const backgroundTab = component._createTab(2);
    await component.openPane(backgroundTab);

    const setBellBadge = vi.fn();
    window.terminalPty = { setBellBadge };

    // Fire the bell from the background tab's pane.
    const backgroundTerminal = terminalInstances[1];
    backgroundTerminal.bellCb();

    expect(backgroundTab.element.classList.contains('has-bell')).toBe(true);
    expect(backgroundTab.hasBell).toBe(true);
    expect(activeTab.element.classList.contains('has-bell')).toBe(false);
    expect(setBellBadge).toHaveBeenCalledWith(true);
  });

  it('ignores bells from the already-active tab', async () => {
    const { component, activeTab } = await makeComponentWithActiveTab();

    const setBellBadge = vi.fn();
    window.terminalPty = { setBellBadge };

    terminalInstances[0].bellCb();

    expect(activeTab.element.classList.contains('has-bell')).toBe(false);
    expect(activeTab.hasBell).toBe(false);
    expect(setBellBadge).not.toHaveBeenCalled();
  });

  it('clears the bell indicator when the tab is opened', async () => {
    const { component } = await makeComponentWithActiveTab();
    const backgroundTab = component._createTab(2);
    await component.openPane(backgroundTab);

    const setBellBadge = vi.fn();
    window.terminalPty = { setBellBadge };

    terminalInstances[1].bellCb();
    expect(backgroundTab.element.classList.contains('has-bell')).toBe(true);

    component.setActiveTab(2);

    expect(backgroundTab.element.classList.contains('has-bell')).toBe(false);
    expect(backgroundTab.hasBell).toBe(false);
    expect(setBellBadge).toHaveBeenLastCalledWith(false);
  });

  it('updates the app icon badge when a belled tab is closed', async () => {
    const { component } = await makeComponentWithActiveTab();
    const backgroundTab = component._createTab(2);
    await component.openPane(backgroundTab);

    const setBellBadge = vi.fn();
    window.terminalPty = { setBellBadge };

    terminalInstances[1].bellCb();
    expect(setBellBadge).toHaveBeenLastCalledWith(true);

    // Close the belled background tab (component stays on tab 1).
    component.closeTab(2);

    expect(setBellBadge).toHaveBeenLastCalledWith(false);
  });

  it('does not throw when the bridge lacks setBellBadge', async () => {
    const { component, activeTab } = await makeComponentWithActiveTab();
    const backgroundTab = component._createTab(2);
    await component.openPane(backgroundTab);

    window.terminalPty = {}; // bridge without setBellBadge

    expect(() => terminalInstances[1].bellCb()).not.toThrow();
    expect(backgroundTab.element.classList.contains('has-bell')).toBe(true);
  });
});
