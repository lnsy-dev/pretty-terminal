/**
 * Terminal Component
 *
 * A full-screen terminal emulator built on xterm.js. In Electron the
 * terminal is backed by a real PTY in the main process (giving full
 * system shell access); in a plain browser it falls back to the small
 * built-in TerminalShell.
 *
 * The component supports multiple tabs, and each tab can contain multiple
 * terminal panes arranged side-by-side. Only one tab is visible at a time,
 * but all panes in the active tab are shown together.
 */

import DataroomElement from 'dataroom-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import TerminalShell from './lib/terminal-shell.js';

/**
 * Read a CSS custom property from an element's computed style.
 *
 * @param {HTMLElement} element - Element to inspect.
 * @param {string} name - CSS variable name (e.g. '--background').
 * @param {string} fallback - Fallback value.
 * @returns {string}
 */
function getCssVar(element, name, fallback) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Build the xterm.js theme from the dataroom CSS custom properties.
 *
 * The full 16-color ANSI palette is set so programs that emit ANSI colors
 * (oh-my-zsh themes, ls, grep, ...) render in the dataroom palette in both
 * light and dark color schemes. Fallbacks match the light scheme.
 *
 * @param {HTMLElement} element - Element to read computed styles from.
 * @returns {Object} xterm.js ITheme object.
 */
function buildTerminalTheme(element) {
  const background = getCssVar(element, '--background', '#f2ece2');

  return {
    background,
    foreground: getCssVar(element, '--foreground', '#1a1812'),
    cursor: getCssVar(element, '--accent', '#9f1113'),
    cursorAccent: background,
    selectionBackground: getCssVar(element, '--highlight', '#9f1113'),
    selectionForeground: background,
    black: getCssVar(element, '--terminal-black', '#1a1812'),
    red: getCssVar(element, '--accent-red', '#9f1111'),
    green: getCssVar(element, '--accent-green', '#119f11'),
    yellow: getCssVar(element, '--accent-yellow', '#9f9f11'),
    blue: getCssVar(element, '--accent-blue', '#11119f'),
    magenta: getCssVar(element, '--accent-purple', '#70119f'),
    cyan: getCssVar(element, '--accent-cyan', '#119f9f'),
    white: getCssVar(element, '--terminal-white', '#d2cec0'),
    brightBlack: getCssVar(element, '--terminal-bright-black', '#6b6759'),
    brightRed: getCssVar(element, '--terminal-bright-red', '#c01416'),
    brightGreen: getCssVar(element, '--terminal-bright-green', '#16b816'),
    brightYellow: getCssVar(element, '--terminal-bright-yellow', '#b8b816'),
    brightBlue: getCssVar(element, '--terminal-bright-blue', '#1616c8'),
    brightMagenta: getCssVar(element, '--terminal-bright-magenta', '#8c16c0'),
    brightCyan: getCssVar(element, '--terminal-bright-cyan', '#16b8b8'),
    brightWhite: getCssVar(element, '--terminal-bright-white', '#ffffff'),
  };
}

/**
 * Return a debounced wrapper that waits until `ms` have elapsed without the
 * wrapped function being called before invoking it.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} ms - Quiet period in milliseconds.
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timeout = null;
  return (...args) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, ms);
  };
}

/**
 * Resize the terminal to fill its container and forward the new
 * dimensions to a PTY if one is attached.
 *
 * FitAddon can occasionally round up so the rendered grid is one pixel
 * taller than the container, clipping the bottom row. Reserve a two-row
 * buffer at the bottom so the last line of text is always fully visible.
 *
 * @param {Terminal} terminal - xterm.js Terminal instance.
 * @param {FitAddon} fitAddon - xterm.js fit addon.
 * @param {Object} [pty] - Electron PTY bridge.
 * @param {{cols: number, rows: number}} [lastSize] - Last size sent to the PTY.
 * @returns {{cols: number, rows: number}}
 */
function fitTerminal(terminal, fitAddon, pty, lastSize = null) {
  fitAddon.fit();

  // FitAddon's math can round so the rendered grid is slightly taller than
  // the container, clipping the bottom row. Reserve two blank rows at the
  // bottom so the last line of text is always fully visible.
  const rowBuffer = 2;
  if (terminal.rows > rowBuffer) {
    terminal.resize(terminal.cols, terminal.rows - rowBuffer);
  }

  const size = { cols: terminal.cols, rows: terminal.rows };
  const changed = !lastSize || lastSize.cols !== size.cols || lastSize.rows !== size.rows;
  if (pty && changed) {
    pty.resize(size.cols, size.rows);
  }

  terminal.scrollToBottom();

  return size;
}

/**
 * Attach the xterm.js instance to the local fallback shell (used in
 * browsers / automated tests where the Electron PTY is not available).
 *
 * @param {Terminal} terminal - xterm.js Terminal instance.
 * @param {FitAddon} fitAddon - xterm.js fit addon.
 * @returns {TerminalShell}
 */
function attachLocalShell(terminal, fitAddon) {
  const shell = new TerminalShell(terminal);
  shell.start();

  terminal.onData((data) => shell.handleData(data));

  return shell;
}

/**
 * TerminalComponent
 *
 * Manages a tab bar and one terminal session per tab. Tabs can be split
 * into multiple panes; each pane owns its own terminal and shell/PTY
 * session.
 *
 * @extends DataroomElement
 */
class TerminalComponent extends DataroomElement {
  /**
   * Set up the tab bar, terminal area, and the first tab.
   *
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    this.classList.add('terminal-component');

    this.tabs = [];
    this.activeTabId = null;
    // Pane IDs must be globally unique because they double as the Electron
    // PTY session key. Per-tab pane IDs would collide (tab 1 pane 1 and tab 2
    // pane 1 would share a PTY) and cause new tabs to reuse the first tab's
    // shell instead of spawning their own.
    this.nextPaneId = 1;

    // Place the tab bar inside the title bar so tabs sit at the very top of
    // the window, to the right of the macOS traffic-light buttons.
    const titleBar = document.querySelector('.title-bar');
    this.titleBar = titleBar;

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'tab-bar';
    if (titleBar) {
      titleBar.appendChild(this.tabBar);
    } else {
      this.appendChild(this.tabBar);
    }

    this.newTabButton = this.create('button', { class: 'new-tab-button', content: '+' }, this.tabBar);
    this.newTabButton.addEventListener('click', () => this.openTab());
    this.newTabButton.setAttribute('aria-label', 'New tab');
    this.newTabButton.setAttribute('title', 'New tab');

    // Drag handle so the window can still be dragged from the tab bar even
    // though the tabs and + button are marked no-drag.
    this.dragHandle = document.createElement('div');
    this.dragHandle.className = 'drag-handle';
    this.dragHandle.textContent = '⋮⋮';
    this.dragHandle.setAttribute('title', 'Drag to move window');
    this.tabBar.insertBefore(this.dragHandle, this.tabBar.firstChild);

    this.terminalArea = this.create('div', { class: 'terminal-area' });

    this.createRenameDialog();

    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('click', (e) => this.hideContextMenu());

    // Watch the terminal area itself so any change to its size — browser
    // window resize, fullscreen toggle, or container reflow — is forwarded to
    // the active PTY after the browser has finished layout.
    if (typeof ResizeObserver !== 'undefined') {
      this.terminalAreaResizeObserver = new ResizeObserver(debounce(() => {
        this.fitActiveTab();
      }, 100));
      this.terminalAreaResizeObserver.observe(this.terminalArea);
    }

    if (this.titleBar && window.electronFullscreen) {
      window.electronFullscreen.onChange((isFullscreen) => {
        this.titleBar.classList.toggle('fullscreen', isFullscreen);
        requestAnimationFrame(() => this.fitActiveTab());
      });
    }

    this._setupThemeListener();

    await this.openTab();
  }

  /**
   * Watch for system light/dark changes and re-apply the xterm.js theme so
   * existing terminals follow the dataroom palette instead of keeping the
   * scheme they were created with.
   *
   * @private
   * @returns {void}
   */
  _setupThemeListener() {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => this._applyThemeToAllPanes());
  }

  /**
   * Re-read the dataroom CSS variables and push the updated palette to every
   * open xterm.js pane.
   *
   * @private
   * @returns {void}
   */
  _applyThemeToAllPanes() {
    for (const tab of this.tabs) {
      for (const pane of tab.panes) {
        pane.terminal.options.theme = buildTerminalTheme(pane.element);
      }
    }
  }

  /**
   * Create the rename dialog.
   *
   * @private
   * @returns {void}
   */
  createRenameDialog() {
    this.renameDialog = this.create('dialog', { class: 'rename-dialog' });
    this.renameDialog.setAttribute('aria-labelledby', 'rename-dialog-title');

    const title = this.create('h2', { id: 'rename-dialog-title', content: 'Rename tab' }, this.renameDialog);

    const form = this.create('form', { method: 'dialog' }, this.renameDialog);
    this.renameInput = this.create('input', { type: 'text', name: 'tab-name' }, form);

    const buttonGroup = this.create('div', { class: 'rename-dialog-buttons' }, form);
    this.create('button', { type: 'submit', value: 'confirm', content: 'OK' }, buttonGroup);
    this.create('button', { type: 'submit', value: 'cancel', content: 'Cancel' }, buttonGroup);

    this.renameDialog.addEventListener('close', () => {
      if (this.renameDialog.returnValue === 'confirm' && this.renameTargetTabId !== null) {
        const newName = this.renameInput.value.trim();
        if (newName) {
          this.renameTab(this.renameTargetTabId, newName);
        }
      }
      this.renameTargetTabId = null;
      this.renameInput.value = '';
    });
  }

  /**
   * Install a single set of PTY output/exit listeners and route events to
   * the matching pane. This is done once because contextBridge cannot receive
   * per-pane callback functions from the renderer.
   *
   * @private
   * @returns {void}
   */
  _installPtyListeners() {
    if (this.ptyListenersInstalled || !window.terminalPty) {
      return;
    }

    const pty = window.terminalPty;

    pty.onData(({ tabId, data }) => {
      const pane = this.findPaneById(tabId);
      if (!pane) {
        return;
      }

      pane.terminal.write(data);
      if (!pane.userScrolled) {
        pane.terminal.scrollToBottom();
      }
    });

    pty.onExit(({ tabId, exitCode }) => {
      const pane = this.findPaneById(tabId);
      if (!pane) {
        return;
      }

      pane.terminal.writeln(`\r\n[process exited with code ${exitCode}]`);
    });

    this.ptyListenersInstalled = true;
  }

  /**
   * Attach a pane's terminal to the Electron PTY bridge.
   *
   * The pane id is used as the PTY session id so every split pane gets its
   * own independent shell process.
   *
   * @private
   * @param {Object} pane - Pane object.
   * @returns {void}
   */
  _attachPty(pane) {
    const pty = window.terminalPty;
    if (!pty) {
      return;
    }

    this._installPtyListeners();

    pane.userScrolled = false;
    pane.terminal.onScroll(() => {
      pane.userScrolled = pane.terminal.buffer.active.viewportY < pane.terminal.buffer.active.baseY;
    });

    pane.terminal.onData((data) => pty.write(pane.id, data));

    // Size the terminal to its container before spawning the PTY. Starting the
    // shell with the real dimensions avoids the default 80x24 -> actual-size
    // resize race that makes zsh's PROMPT_SP print a leading "%" on wrapped or
    // partial prompt lines (especially visible in narrow split panes).
    //
    // Wait two animation frames so the pane container has had time to be laid
    // out by the browser. Flex distribution, title-bar insertion, and the
    // initial xterm.js render can each take a frame, so one rAF is sometimes
    // not enough for FitAddon to measure real pixel dimensions instead of
    // defaulting to 80x24.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pane.lastPtySize = fitTerminal(pane.terminal, pane.fitAddon, null);
        pty.createTerminal(pane.id, undefined, pane.lastPtySize.cols, pane.lastPtySize.rows);
        pane.ptyCreated = true;
      });
    });
  }

  /**
   * Handle global keyboard shortcuts for tabs and panes.
   *
   * Cmd/Ctrl+T opens a new tab. Cmd/Ctrl+Shift+T splits the active tab.
   * Cmd/Ctrl+W closes the active pane. Cmd/Ctrl+1-9 switch to the tab whose
   * id is 1-9, and Cmd/Ctrl+0 switches to the tab whose id is 10.
   * Ctrl+Left/Right cycles tabs.
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event.
   * @returns {void}
   */
  handleKeyDown(e) {
    if (e.defaultPrevented || e.type !== 'keydown') {
      return;
    }

    this.processTabShortcut(e);
  }

  /**
   * Perform the tab/pane shortcut action, if any, for the given key event.
   *
   * Cmd/Ctrl+1 through Cmd/Ctrl+9 switch to the tab whose id is 1-9, and
   * Cmd/Ctrl+0 switches to the tab whose id is 10. Tabs keep their number
   * when other tabs are closed, so Cmd/Ctrl+4 always activates tab 4 even
   * if it is the only remaining tab.
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event.
   * @returns {void}
   */
  processTabShortcut(e) {
    const isNewTab = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isSplitPane = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;
    const isClosePane = (e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isCycleRight = e.key === 'ArrowRight' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isCycleLeft = e.key === 'ArrowLeft' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isNumberSwitch = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

    if (isNewTab) {
      e.preventDefault();
      this.openTab();
      return;
    }

    if (isSplitPane) {
      e.preventDefault();
      this.splitActiveTab();
      return;
    }

    if (isClosePane) {
      e.preventDefault();
      this.closeActivePane();
      return;
    }

    if (isNumberSwitch) {
      e.preventDefault();
      const digit = parseInt(e.key, 10);
      const targetId = digit === 0 ? 10 : digit;
      const tab = this.tabs.find((t) => t.id === targetId);
      if (tab) {
        this.setActiveTab(tab.id);
      }
      return;
    }

    if (isCycleRight) {
      e.preventDefault();
      this.cycleTab(1);
      return;
    }

    if (isCycleLeft) {
      e.preventDefault();
      this.cycleTab(-1);
    }
  }

  /**
   * Intercept terminal key events so shortcuts are handled even when an
   * xterm.js pane has focus.
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event from xterm.js.
   * @returns {boolean} false to stop xterm.js from processing the event.
   */
  handleTerminalKeyEvent(e) {
    if (e.type !== 'keydown') {
      return true;
    }

    const isShortcut = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isSplitPane = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;
    const isClosePane = (e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isCycleRight = e.key === 'ArrowRight' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isCycleLeft = e.key === 'ArrowLeft' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isNumberSwitch = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;

    if (isShortcut || isSplitPane || isClosePane || isCycleRight || isCycleLeft || isNumberSwitch) {
      this.processTabShortcut(e);
      return false;
    }

    return true;
  }

  /**
   * Return the currently active tab object.
   *
   * @private
   * @returns {Object|null}
   */
  getActiveTab() {
    return this.tabs.find((t) => t.id === this.activeTabId) || null;
  }

  /**
   * Return the currently active pane object.
   *
   * @private
   * @returns {Object|null}
   */
  getActivePane() {
    const tab = this.getActiveTab();
    if (!tab) {
      return null;
    }
    return tab.panes.find((p) => p.id === tab.activePaneId) || null;
  }

  /**
   * Find a pane across all tabs by its id.
   *
   * @private
   * @param {number} paneId - Pane id.
   * @returns {Object|null}
   */
  findPaneById(paneId) {
    for (const tab of this.tabs) {
      const pane = tab.panes.find((p) => p.id === paneId);
      if (pane) {
        return pane;
      }
    }
    return null;
  }

  /**
   * Return the smallest positive integer not already used as a tab id.
   *
   * This fills gaps left by closed tabs, so creating a new tab when tabs
   * 1 and 4 exist produces tab 2 instead of tab 5.
   *
   * @private
   * @returns {number}
   */
  _nextTabId() {
    const used = new Set(this.tabs.map((t) => t.id));
    let id = 1;
    while (used.has(id)) {
      id += 1;
    }
    return id;
  }

  /**
   * Open a new terminal tab.
   *
   * The new tab is assigned the lowest available positive integer id and is
   * inserted into the tab bar so tabs remain ordered 1, 2, 3, ... visually.
   *
   * @param {string} [name] - Optional tab label. Defaults to the tab number.
   * @returns {Promise<number>} The new tab id.
   */
  async openTab(name) {
    const tabId = this._nextTabId();

    const tabName = name || String(tabId);

    const container = this.create('div', { class: 'terminal-container', 'data-tab-id': String(tabId) }, this.terminalArea);

    const tabElement = this.create('div', { class: 'tab', 'data-tab-id': String(tabId) });

    const label = this.create('span', { class: 'tab-label', content: tabName }, tabElement);

    tabElement.addEventListener('click', () => this.setActiveTab(tabId));
    tabElement.addEventListener('contextmenu', (e) => this.showContextMenu(e, tabId));

    const tab = {
      id: tabId,
      name: tabName,
      element: tabElement,
      labelElement: label,
      container,
      panes: [],
      activePaneId: null,
    };

    // Keep tabs ordered numerically in both the data model and the tab bar.
    const nextTab = this.tabs.find((t) => t.id > tabId);
    if (nextTab) {
      this.tabBar.insertBefore(tabElement, nextTab.element);
      const insertIndex = this.tabs.indexOf(nextTab);
      this.tabs.splice(insertIndex, 0, tab);
    } else {
      this.tabBar.insertBefore(tabElement, this.newTabButton);
      this.tabs.push(tab);
    }

    // Wait for the monospace web font to load before measuring cells.
    await document.fonts.ready;

    // Activate the tab before creating its first pane so xterm.js opens in
    // a visible container and measures correctly.
    this.setActiveTab(tabId);

    await this.openPane(tab);

    this._updateLayoutClass();

    return tabId;
  }

  /**
   * Open a new terminal pane inside a tab.
   *
   * @private
   * @param {Object} tab - Tab object.
   * @param {Object} [options] - Pane options.
   * @param {number} [options.insertAfterPaneId] - Pane id to insert after.
   * @returns {Promise<number>} The new pane id.
   */
  async openPane(tab, options = {}) {
    const paneId = this.nextPaneId;
    this.nextPaneId += 1;

    const paneContainer = this.create('div', { class: 'terminal-pane', 'data-pane-id': String(paneId) }, tab.container);

    const style = getComputedStyle(paneContainer);

    const terminal = new Terminal({
      fontFamily: style.fontFamily || getCssVar(paneContainer, '--font-mono', 'monospace'),
      fontSize: parseFloat(style.fontSize) || 14,
      theme: buildTerminalTheme(paneContainer),
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      scrollback: 10000,
      lineHeight: 1.2,
      allowProposedApi: true,
    });

    terminal.attachCustomKeyEventHandler((e) => this.handleTerminalKeyEvent(e));

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(paneContainer);

    // Size the terminal to the container immediately so the initial shell
    // output (and the PTY when it is created) uses the real grid instead of
    // xterm.js's default 80x24. This avoids zsh PROMPT_SP emitting a leading
    // "%" when the prompt is printed at one size and then resized.
    fitTerminal(terminal, fitAddon, null);

    // LigaturesAddon must be loaded after the terminal is opened; it needs
    // access to the renderer and will throw if activated too early.
    const ligaturesAddon = new LigaturesAddon();
    terminal.loadAddon(ligaturesAddon);

    const pane = {
      id: paneId,
      tabId: tab.id,
      element: paneContainer,
      terminal,
      fitAddon,
      shell: null,
      pty: null,
      lastPtySize: null,
    };

    if (options.insertAfterPaneId !== undefined) {
      const index = tab.panes.findIndex((p) => p.id === options.insertAfterPaneId);
      tab.panes.splice(index + 1, 0, pane);
    } else {
      tab.panes.push(pane);
    }

    paneContainer.addEventListener('mousedown', () => {
      this.setActivePane(tab, paneId);
    });

    if (window.terminalPty) {
      this._attachPty(pane);
      pane.pty = window.terminalPty;
    } else {
      pane.shell = attachLocalShell(terminal, fitAddon);
    }

    // Watch for container size changes (window resize, tab switches, pane
    // splits, font loads) and push the new grid size to the PTY.
    if (typeof ResizeObserver !== 'undefined') {
      pane.resizeObserver = new ResizeObserver(debounce(() => {
        if (tab.id !== this.activeTabId) {
          return;
        }
        if (pane.ptyCreated) {
          pane.lastPtySize = fitTerminal(pane.terminal, pane.fitAddon, pane.pty, pane.lastPtySize);
        } else if (pane.pty) {
          // The PTY is attached but not spawned yet; keep the terminal grid in
          // sync so the dimensions used at spawn time are current.
          pane.lastPtySize = fitTerminal(pane.terminal, pane.fitAddon, null, pane.lastPtySize);
        }
      }, 100));
      pane.resizeObserver.observe(paneContainer);
    }

    this.setActivePane(tab, paneId);

    if (this.activeTabId === tab.id) {
      this.terminal = pane.terminal;
      this.shell = pane.shell;
      this.container = pane.element;
    }

    this.reflowPanes(tab);

    return paneId;
  }

  /**
   * Split the active tab, adding a new pane to the right of the currently
   * active pane.
   *
   * @returns {Promise<number>|undefined} The new pane id, if a tab is active.
   */
  splitActiveTab() {
    const tab = this.getActiveTab();
    if (!tab) {
      return undefined;
    }
    return this.openPane(tab, { insertAfterPaneId: tab.activePaneId });
  }

  /**
   * Close the active pane.
   *
   * @returns {void}
   */
  closeActivePane() {
    const pane = this.getActivePane();
    if (!pane) {
      return;
    }
    this.closePane(pane.id);
  }

  /**
   * Close a specific pane.
   *
   * If the pane is the only pane of the only tab, it is kept open so the
   * window never becomes empty. If it is the last pane of a non-last tab,
   * the whole tab is closed.
   *
   * @param {number} paneId - Pane id.
   * @returns {void}
   */
  closePane(paneId) {
    const pane = this.findPaneById(paneId);
    if (!pane) {
      return;
    }

    const tab = this.tabs.find((t) => t.id === pane.tabId);
    if (!tab) {
      return;
    }

    // Never close the only pane of the only tab.
    if (tab.panes.length === 1 && this.tabs.length === 1) {
      return;
    }

    const paneIndex = tab.panes.findIndex((p) => p.id === paneId);

    if (pane.resizeObserver) {
      pane.resizeObserver.disconnect();
    }

    if (pane.pty) {
      pane.pty.kill(pane.id);
    } else if (pane.shell && typeof pane.shell.stop === 'function') {
      pane.shell.stop();
    }

    pane.terminal.dispose();
    pane.element.remove();

    tab.panes.splice(paneIndex, 1);

    if (tab.panes.length === 0) {
      this.closeTab(tab.id);
      return;
    }

    if (tab.activePaneId === paneId) {
      const newIndex = Math.max(0, paneIndex - 1);
      this.setActivePane(tab, tab.panes[newIndex].id);
    }

    this.reflowPanes(tab);

    if (this.activeTabId === tab.id) {
      const activePane = this.getActivePane();
      if (activePane) {
        this.terminal = activePane.terminal;
        this.shell = activePane.shell;
        this.container = activePane.element;
      }
    }
  }

  /**
   * Close a tab and remove all of its panes.
   *
   * @private
   * @param {number} tabId - Tab id.
   * @returns {void}
   */
  closeTab(tabId) {
    const tabIndex = this.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) {
      return;
    }

    const tab = this.tabs[tabIndex];

    tab.panes.forEach((pane) => {
      if (pane.resizeObserver) {
        pane.resizeObserver.disconnect();
      }

      if (pane.pty) {
        pane.pty.kill(pane.id);
      } else if (pane.shell && typeof pane.shell.stop === 'function') {
        pane.shell.stop();
      }
      pane.terminal.dispose();
      pane.element.remove();
    });

    tab.element.remove();
    tab.container.remove();

    this.tabs.splice(tabIndex, 1);

    this._updateLayoutClass();

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      if (this.tabs.length > 0) {
        const newIndex = Math.max(0, tabIndex - 1);
        this.setActiveTab(this.tabs[newIndex].id);
      }
    }
  }

  /**
   * Set the active pane within a tab.
   *
   * @private
   * @param {Object} tab - Tab object.
   * @param {number} paneId - Pane id.
   * @returns {void}
   */
  setActivePane(tab, paneId) {
    const pane = tab.panes.find((p) => p.id === paneId);
    if (!pane) {
      return;
    }

    const previousPane = tab.panes.find((p) => p.id === tab.activePaneId);
    if (previousPane) {
      previousPane.element.classList.remove('active');
    }

    tab.activePaneId = paneId;
    pane.element.classList.add('active');
    pane.terminal.focus();
  }

  /**
   * Resize and reflow all panes in a tab so they share the available width.
   *
   * @private
   * @param {Object} tab - Tab object.
   * @returns {void}
   */
  reflowPanes(tab) {
    const count = tab.panes.length;
    if (count === 0) {
      return;
    }

    tab.panes.forEach((pane) => {
      pane.element.style.flex = `1 1 ${100 / count}%`;
    });

    tab.panes.forEach((pane) => {
      // Do not forward dimensions to a PTY that has not been spawned yet, but
      // still resize the xterm.js terminal so it matches the container. This
      // keeps the rendered grid correct while the pane is being split or a tab
      // is being switched to, preventing a later resize from wrapping the
      // already-printed prompt and triggering zsh's PROMPT_SP "%" marker.
      if (pane.pty && !pane.ptyCreated) {
        pane.lastPtySize = fitTerminal(pane.terminal, pane.fitAddon, null, pane.lastPtySize);
        return;
      }
      pane.lastPtySize = fitTerminal(pane.terminal, pane.fitAddon, pane.pty, pane.lastPtySize);
    });
  }

  /**
   * Update the component layout class based on the number of tabs.
   *
   * With a single tab the terminal is a narrow 80ch column centered on the
   * page. Once a second tab is opened the terminal expands to fill the width
   * and aligns to the left.
   *
   * @private
   * @returns {void}
   */
  _updateLayoutClass() {
    if (this.tabs.length <= 1) {
      this.classList.add('single-tab');
    } else {
      this.classList.remove('single-tab');
    }
  }

  /**
   * Switch to the tab with the given id.
   *
   * @param {number} tabId - Tab id.
   * @returns {void}
   */
  setActiveTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) {
      return;
    }

    const previousTab = this.tabs.find((t) => t.id === this.activeTabId);
    if (previousTab) {
      previousTab.element.classList.remove('active');
      previousTab.container.classList.remove('active');
      previousTab.container.style.display = 'none';
    }

    this.activeTabId = tabId;
    tab.element.classList.add('active');
    tab.container.classList.add('active');
    tab.container.style.display = 'flex';

    this.reflowPanes(tab);

    // Expose the active terminal/shell/container for existing tests and callers.
    const activePane = this.getActivePane();
    if (activePane) {
      this.terminal = activePane.terminal;
      this.shell = activePane.shell;
      this.container = activePane.element;

      requestAnimationFrame(() => {
        activePane.terminal.focus();
      });
    }
  }

  /**
   * Resize the active terminal to fill the available space.
   *
   * @returns {void}
   */
  fitActiveTab() {
    const tab = this.getActiveTab();
    if (!tab) {
      return;
    }

    this.reflowPanes(tab);
  }

  /**
   * Cycle to the next or previous tab, wrapping around.
   *
   * @param {number} direction - 1 for next, -1 for previous.
   * @returns {void}
   */
  cycleTab(direction) {
    if (this.tabs.length < 2) {
      return;
    }

    const activeIndex = this.tabs.findIndex((t) => t.id === this.activeTabId);
    const nextIndex = (activeIndex + direction + this.tabs.length) % this.tabs.length;
    this.setActiveTab(this.tabs[nextIndex].id);
  }

  /**
   * Rename a tab.
   *
   * @param {number} tabId - Tab id.
   * @param {string} newName - New tab label.
   * @returns {void}
   */
  renameTab(tabId, newName) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !newName) {
      return;
    }

    tab.name = newName;
    tab.labelElement.textContent = newName;
    tab.element.setAttribute('title', newName);
  }

  /**
   * Show the context menu for a tab.
   *
   * The menu is created on demand and appended to document.body so its
   * position:fixed coordinates are relative to the viewport, not the
   * transformed terminal-component element. It is removed from the DOM
   * when hidden so it does not pollute the body.
   *
   * @private
   * @param {MouseEvent} e - Context menu event.
   * @param {number} tabId - Tab id.
   * @returns {void}
   */
  showContextMenu(e, tabId) {
    e.preventDefault();
    e.stopPropagation();

    this.hideContextMenu();
    this.contextMenuTargetTabId = tabId;

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.setAttribute('role', 'menu');

    const renameItem = document.createElement('div');
    renameItem.className = 'tab-context-menu-item';
    renameItem.setAttribute('role', 'menuitem');
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
      if (this.contextMenuTargetTabId !== null) {
        this.showRenameDialog(this.contextMenuTargetTabId);
      }
      this.hideContextMenu();
    });

    menu.appendChild(renameItem);
    document.body.appendChild(menu);

    this.contextMenu = menu;
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
  }

  /**
   * Hide the context menu.
   *
   * @private
   * @returns {void}
   */
  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    this.contextMenuTargetTabId = null;
  }

  /**
   * Open the rename dialog for a tab.
   *
   * @private
   * @param {number} tabId - Tab id.
   * @returns {void}
   */
  showRenameDialog(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) {
      return;
    }

    this.renameTargetTabId = tabId;
    this.renameInput.value = tab.name;
    this.renameDialog.showModal();
    this.renameInput.select();
  }
}

if (!customElements.get('terminal-component')) {
  customElements.define('terminal-component', TerminalComponent);
}

export { TerminalComponent, fitTerminal };
export default TerminalComponent;
