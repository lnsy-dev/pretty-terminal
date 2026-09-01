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
import { computeFlexShares, fitPane } from './lib/terminal-sizing.js';

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
 * Match the "open a new tab" shortcut: Cmd+T or Cmd+Return.
 *
 * New tabs are deliberately Cmd-only (macOS convention): Ctrl+T is left for
 * the shell, where it is commonly bound (e.g. fzf, command palettes). Shared
 * by the document-level handler and the xterm.js custom key handler so both
 * paths agree on exactly which events open a tab.
 *
 * @param {KeyboardEvent} e - Keyboard event.
 * @returns {boolean} Whether the event matches the new-tab shortcut.
 */
function isNewTabShortcut(e) {
  return (
    e.metaKey && !e.altKey && !e.shiftKey &&
    (e.key === 't' || e.key === 'T' || e.key === 'Enter')
  );
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

    // Pane size changes are observed per pane (see openPane), which covers
    // every container-level geometry change: window resizes, fullscreen
    // toggles, and the .single-tab width-cap transition all change the size
    // of every pane in the active tab.
    if (this.titleBar && window.electronFullscreen) {
      window.electronFullscreen.onChange((isFullscreen) => {
        this.titleBar.classList.toggle('fullscreen', isFullscreen);
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

    // Spawn the PTY only once the pane has measurable dimensions so the
    // shell starts at its final size. Starting at xterm.js's default 80x24
    // and resizing afterwards makes zsh's PROMPT_SP print a leading "%" on
    // wrapped prompt lines and forces fullscreen apps (vim, micro) through a
    // spurious redraw. Normally the pane is already laid out (openPane fits
    // it synchronously) and the first attempt succeeds; the retry loop only
    // covers the rare not-yet-laid-out case.
    const maxAttempts = 10;
    const spawn = (attemptsLeft) => {
      const size = fitPane(pane);
      if (size) {
        pty.createTerminal(pane.id, undefined, size.cols, size.rows, pane.cwd);
        pane.ptyCreated = true;
        return;
      }
      if (attemptsLeft > 0) {
        requestAnimationFrame(() => spawn(attemptsLeft - 1));
      }
    };
    spawn(maxAttempts);
  }

  /**
   * Handle global keyboard shortcuts for tabs and panes.
   *
   * Cmd+T or Cmd+Return opens a new tab. Cmd/Ctrl+Shift+T splits the
   * active tab. Cmd/Ctrl+W closes the active pane. Cmd/Ctrl+1-9 switch to the
   * tab whose id is 1-9, and Cmd/Ctrl+0 switches to the tab whose id is 10; a
   * number with no matching tab opens a new tab under that number.
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
   * Cmd+T and Cmd+Return open a new tab. Cmd/Ctrl+1 through Cmd/Ctrl+9
   * switch to the tab whose id is 1-9, and Cmd/Ctrl+0 switches to the tab
   * whose id is 10. Tabs keep their number
   * when other tabs are closed, so Cmd/Ctrl+4 always activates tab 4 even
   * if it is the only remaining tab. When the numbered tab does not exist,
   * a new tab is opened under that number.
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event.
   * @returns {void}
   */
  processTabShortcut(e) {
    const isNewTab = isNewTabShortcut(e);
    const isSplitPane = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;
    const isClosePane = (e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isCycleRight = e.key === 'ArrowRight' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isCycleLeft = e.key === 'ArrowLeft' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isNumberSwitch = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isMoveSession = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;

    if (isNewTab) {
      e.preventDefault();
      this.openTab();
      return;
    }

    if (isMoveSession) {
      // Cmd/Ctrl+Shift+{number}: move the active session to that tab
      // (creating the tab if needed); an occupied target becomes a split.
      e.preventDefault();
      const digit = parseInt(e.key, 10);
      this.moveActivePaneToTab(digit === 0 ? 10 : digit);
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
      } else {
        // The numbered tab does not exist yet: open one under that number
        // (fire-and-forget; openTab resolves once fonts are loaded).
        this.openTab(undefined, targetId);
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

    const isShortcut = isNewTabShortcut(e);
    const isSplitPane = (e.key === 't' || e.key === 'T') && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;
    const isClosePane = (e.key === 'w' || e.key === 'W') && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isCycleRight = e.key === 'ArrowRight' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isCycleLeft = e.key === 'ArrowLeft' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const isNumberSwitch = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const isMoveSession = /^[0-9]$/.test(e.key) && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey;

    if (isShortcut || isSplitPane || isClosePane || isCycleRight || isCycleLeft || isNumberSwitch || isMoveSession) {
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
   * By default the new tab is assigned the lowest available positive integer
   * id; passing `forcedId` instead opens the tab under that exact number
   * (used by Cmd+{number} to conjure a tab that does not exist yet).
   * The tab is inserted into the tab bar so tabs remain ordered 1, 2, 3, ...
   * visually.
   *
   * The new tab's shell starts in the working directory of the pane that is
   * active when the tab is opened, so opening a tab feels like opening a
   * shell right where the user currently is (instead of always in HOME).
   *
   * @param {string} [name] - Optional tab label. Defaults to the tab number.
   * @param {number} [forcedId] - Optional tab id to use. Falls back to the
   *   lowest available id when omitted or already taken.
   * @returns {Promise<number>} The new tab id.
   */
  async openTab(name, forcedId) {
    // Capture the source pane before any tab switch: the new tab inherits
    // the working directory of whatever pane the user is currently in. The
    // lookup runs while the tab bar/fonts settle below.
    const sourcePane = this.getActivePane();
    const cwdPromise = this._getPaneCwd(sourcePane);

    const forcedIdAvailable = (
      forcedId !== undefined && !this.tabs.some((t) => t.id === forcedId)
    );
    const tabId = forcedIdAvailable ? forcedId : this._nextTabId();

    const tab = this._createTab(tabId, name);

    // Apply the layout class (single-tab width cap) BEFORE the first fit:
    // the class changes the component's width (120ch cap), and fitting before
    // it is applied sizes the terminal (and the PTY spawn) to the uncapped
    // window width, forcing a second, spurious resize right after open.
    this._updateLayoutClass();

    // Explicitly load the terminal font before any cell measurement.
    // @font-face fonts load lazily on first use, so fonts.ready alone can
    // resolve before the terminal font has even been requested — xterm.js
    // would then measure cells with fallback-font metrics and cache them,
    // leaving the grid mis-sized (by several columns) once the real font
    // swaps in.
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      const family = getCssVar(this.terminalArea, '--font-mono', 'monospace').split(',')[0].trim();
      try {
        await document.fonts.load(`14px ${family}`);
      } catch {
        // Fall through with whatever metrics are available.
      }
    }

    // Wait for the monospace web font to load before measuring cells.
    await document.fonts.ready;

    // Activate the tab before creating its first pane so xterm.js opens in
    // a visible container and measures correctly.
    this.setActiveTab(tabId);

    await this.openPane(tab, { cwd: await cwdPromise });

    return tabId;
  }

  /**
   * Create a tab shell (data model + tab bar entry + container) without any
   * panes.
   *
   * The tab is inserted so tabs remain ordered 1, 2, 3, ... visually. Used
   * by openTab for ordinary tab creation and by moveActivePaneToTab when a
   * session is moved to a tab number that does not exist yet.
   *
   * @private
   * @param {number} tabId - Id for the new tab (assumed free).
   * @param {string} [name] - Optional tab label. Defaults to the tab number.
   * @returns {Object} The new tab object.
   */
  _createTab(tabId, name) {
    const tabName = name || String(tabId);

    const container = this.create('div', { class: 'terminal-container', 'data-tab-id': String(tabId) }, this.terminalArea);

    const tabElement = this.create('div', { class: 'tab', 'data-tab-id': String(tabId) });

    const label = this.create('span', { class: 'tab-label', content: tabName }, tabElement);

    // Silent-bell indicator: a tiny red dot on the lower right of the tab
    // label. Hidden by default; shown via the .has-bell class on the tab.
    this.create('span', { class: 'tab-bell-dot' }, tabElement);

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
      hasBell: false,
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

    this._updateLayoutClass();

    return tab;
  }

  /**
   * Resolve the working directory a new pane's shell should start in.
   *
   * Returns the source pane's cwd when the Electron PTY bridge is available
   * and the pane has a live PTY; otherwise null (the main process then falls
   * back to the user's home directory). Used by openTab so new tabs inherit
   * the current pane's directory.
   *
   * @private
   * @param {Object|null} sourcePane - Pane whose cwd to resolve.
   * @returns {Promise<string|null>} The cwd, or null when unavailable.
   */
  async _getPaneCwd(sourcePane) {
    const pty = typeof window !== 'undefined' ? window.terminalPty : null;
    if (!sourcePane || !sourcePane.ptyCreated || !pty || typeof pty.getCwd !== 'function') {
      return null;
    }
    try {
      return await pty.getCwd(sourcePane.id);
    } catch {
      return null;
    }
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

    // Inner wrapper that carries the per-instance width cap. xterm.js's
    // FitAddon measures this wrapper's width, so the grid is limited to 120ch
    // per pane while the outer .terminal-pane (and the component) can still
    // fill the window on a split.
    const xtermWrapper = this.create('div', { class: 'xterm-wrapper' }, paneContainer);

    // Give every pane its equal flex share BEFORE opening xterm.js so the
    // terminal's first measurement happens at its real width. Fitting at the
    // CSS default (full width) and then again after the split reflow produced
    // a spurious full-width -> half-width resize: two SIGWINCHs, two redraws
    // in fullscreen apps, and zsh PROMPT_SP "%" markers on wrapped prompts.
    // The share is applied to both the pane container (which participates in
    // the tab's flex layout) and the measured wrapper itself.
    const share = computeFlexShares(tab.panes.length + 1);
    paneContainer.style.flex = share;
    xtermWrapper.style.flex = share;
    tab.panes.forEach((existing) => {
      existing.element.style.flex = share;
    });

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

    // Silent bell: mark the pane's tab (and the app icon) when BEL rings;
    // the indicator clears when the user opens that tab.
    terminal.onBell(() => this._handlePaneBell(pane));

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(xtermWrapper);

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
      ptyCreated: false,
      userScrolled: false,
      lastPtySize: null,
      // Working directory to spawn the shell in (from openTab); null means
      // the main process picks its default (the home directory).
      cwd: options.cwd || null,
    };

    if (options.insertAfterPaneId !== undefined) {
      const index = tab.panes.findIndex((p) => p.id === options.insertAfterPaneId);
      tab.panes.splice(index + 1, 0, pane);
    } else {
      tab.panes.push(pane);
    }

    paneContainer.addEventListener('mousedown', () => {
      // Resolve the owner tab at event time: the pane can be moved to a
      // different tab (Cmd+Shift+{number}) after this listener was created.
      const ownerTab = this.tabs.find((t) => t.panes.some((p) => p.id === paneId));
      if (ownerTab) {
        this.setActivePane(ownerTab, paneId);
      }
    });

    // Size the terminal to the container immediately so the initial shell
    // output (and the PTY when it is created) uses the real grid instead of
    // xterm.js's default 80x24. The container is visible here and already has
    // its final flex share, so this single fit produces the settled size.
    fitPane(pane);

    if (window.terminalPty) {
      pane.pty = window.terminalPty;
      this._attachPty(pane);
    } else {
      pane.shell = attachLocalShell(terminal, fitAddon);
    }

    // Watch for container size changes (window resize, splits, tab switches,
    // fullscreen, font loads) and push the new grid size to the PTY.
    if (typeof ResizeObserver !== 'undefined') {
      pane.resizeObserver = new ResizeObserver(debounce(() => {
        // Compare against the pane's current tab (panes can be moved between
        // tabs), not the tab captured when the pane was created.
        if (pane.tabId !== this.activeTabId) {
          return;
        }
        fitPane(pane);
      }, 100));
      pane.resizeObserver.observe(paneContainer);
    }

    this.setActivePane(tab, paneId);

    if (this.activeTabId === tab.id) {
      this.terminal = pane.terminal;
      this.shell = pane.shell;
      this.container = pane.element;
    }

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
   * Move the active pane (its running session) to the tab with the given
   * number, without closing the session.
   *
   * - If the target tab does not exist, it is created under that number and
   *   the pane becomes its first (full-width) pane.
   * - If the target tab already exists, the pane is added to it as a split.
   * - If the source tab is left without panes, it is removed; the window is
   *   never left empty because the moved pane still exists elsewhere.
   * - Moving to the tab the pane already belongs to is a no-op.
   *
   * @param {number} targetTabId - Tab number to move the session into.
   * @returns {number|undefined} The target tab id, if a pane was active.
   */
  moveActivePaneToTab(targetTabId) {
    const pane = this.getActivePane();
    if (!pane) {
      return undefined;
    }

    const sourceTab = this.getActiveTab();
    const existingTarget = this.tabs.find((t) => t.id === targetTabId);

    // Already home: nothing to move.
    if (existingTarget && existingTarget === sourceTab) {
      return targetTabId;
    }

    // Detach the pane from its source tab without touching its PTY or
    // terminal — the whole point is to keep the session running.
    const paneIndex = sourceTab.panes.indexOf(pane);
    sourceTab.panes.splice(paneIndex, 1);
    if (pane.resizeObserver) {
      pane.resizeObserver.disconnect();
      pane.resizeObserver = null;
    }
    pane.element.remove();

    // Drop the source tab entirely when it ran out of panes. This mirrors
    // closeTab's teardown but keeps the (moved) pane alive.
    if (sourceTab.panes.length === 0) {
      sourceTab.element.remove();
      sourceTab.container.remove();
      this.tabs.splice(this.tabs.indexOf(sourceTab), 1);
      this._updateLayoutClass();
    } else {
      // Hand focus/active marking to a neighbouring pane. The source tab is
      // about to be deactivated anyway, so no focus() is needed here.
      const neighbour = sourceTab.panes[Math.max(0, paneIndex - 1)];
      pane.element.classList.remove('active');
      if (neighbour) {
        sourceTab.activePaneId = neighbour.id;
        neighbour.element.classList.add('active');
      }
      this.reflowPanes(sourceTab);
    }

    const targetTab = existingTarget || this._createTab(targetTabId);

    // Re-home the pane in the target tab: it joins any existing panes as a
    // split (reflowPanes equalises the flex shares).
    pane.tabId = targetTab.id;
    targetTab.container.appendChild(pane.element);
    targetTab.panes.push(pane);
    this.reflowPanes(targetTab);

    this.setActiveTab(targetTab.id);
    this.setActivePane(targetTab, pane.id);

    return targetTab.id;
  }

  /**
   * Close the active pane.
   *
   * @returns {Promise<void>} Resolves once the pane is closed, or earlier
   *   when the user cancelled the close confirmation.
   */
  closeActivePane() {
    const pane = this.getActivePane();
    if (!pane) {
      return Promise.resolve();
    }
    return this.closePane(pane.id);
  }

  /**
   * Close a specific pane.
   *
   * If the pane is the only pane of the only tab, it is kept open so the
   * window never becomes empty. If it is the last pane of a non-last tab,
   * the whole tab is closed.
   *
   * Before closing, asks for confirmation when the pane's shell still has
   * user-launched processes running (checked through the Electron PTY
   * bridge); cancelling keeps the pane open.
   *
   * @param {number} paneId - Pane id.
   * @returns {Promise<void>} Resolves once the pane is closed, or earlier
   *   when the user cancelled the close confirmation.
   */
  closePane(paneId) {
    const pane = this.findPaneById(paneId);
    if (!pane) {
      return Promise.resolve();
    }

    const tab = this.tabs.find((t) => t.id === pane.tabId);
    if (!tab) {
      return Promise.resolve();
    }

    // Never close the only pane of the only tab.
    if (tab.panes.length === 1 && this.tabs.length === 1) {
      return Promise.resolve();
    }

    return this._confirmClosePane(pane).then((confirmed) => {
      if (confirmed) {
        this._teardownPane(tab, pane);
      }
    });
  }

  /**
   * Ask the user to confirm closing a pane whose shell still has running
   * processes.
   *
   * Resolves true (close proceeds) when the pane has no live PTY, when the
   * PTY bridge is unavailable, when the check fails, or when no child
   * processes are running — only a confirmed-running process prompts.
   *
   * @private
   * @param {Object} pane - Pane about to be closed.
   * @returns {Promise<boolean>} True when closing may proceed.
   */
  async _confirmClosePane(pane) {
    if (!pane.ptyCreated) {
      return true;
    }

    const pty = typeof window !== 'undefined' ? window.terminalPty : null;
    if (!pty || typeof pty.hasProcesses !== 'function') {
      return true;
    }

    let hasProcs = false;
    try {
      hasProcs = await pty.hasProcesses(pane.id);
    } catch {
      return true;
    }

    if (!hasProcs) {
      return true;
    }

    if (typeof window.confirm === 'function') {
      return window.confirm('A process is still running in this terminal. Close anyway?');
    }
    return true;
  }

  /**
   * Tear down a pane: kill its shell, dispose its terminal and remove it
   * from its tab (closing the tab when it runs out of panes).
   *
   * @private
   * @param {Object} tab - Tab that owns the pane.
   * @param {Object} pane - Pane to remove.
   * @returns {void}
   */
  _teardownPane(tab, pane) {
    const paneIndex = tab.panes.indexOf(pane);

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

    if (tab.activePaneId === pane.id) {
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
    if (tab.hasBell) {
      this._updateBellBadge();
    }

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      if (this.tabs.length > 0) {
        const newIndex = Math.max(0, tabIndex - 1);
        this.setActiveTab(this.tabs[newIndex].id);
      }
    }
  }

  /**
   * Handle a BEL from one of the panes: mark the owning tab with the bell
   * indicator and badge the app icon, unless the bell came from the tab the
   * user is already looking at (the indicator would be pointless there and
   * would never be "opened" afterwards).
   *
   * @private
   * @param {Object} pane - Pane whose terminal rang the bell.
   * @returns {void}
   */
  _handlePaneBell(pane) {
    const tab = this.tabs.find((t) => t.id === pane.tabId);
    if (!tab || tab.id === this.activeTabId) {
      return;
    }
    this._setTabBell(tab, true);
  }

  /**
   * Show or hide a tab's silent-bell indicator and refresh the app icon
   * badge to reflect whether any tab still has an unread bell.
   *
   * @private
   * @param {Object} tab - Tab object.
   * @param {boolean} hasBell - True to show the indicator, false to clear it.
   * @returns {void}
   */
  _setTabBell(tab, hasBell) {
    tab.hasBell = hasBell;
    tab.element.classList.toggle('has-bell', hasBell);
    this._updateBellBadge();
  }

  /**
   * Badge the app (Dock) icon when at least one tab has an unread bell and
   * clear it when none do. Silently ignored when the PTY bridge is not
   * available (e.g. the local fallback shell) or does not expose the method.
   *
   * @private
   * @returns {void}
   */
  _updateBellBadge() {
    const pty = typeof window !== 'undefined' ? window.terminalPty : null;
    if (!pty || typeof pty.setBellBadge !== 'function') {
      return;
    }
    try {
      pty.setBellBadge(this.tabs.some((t) => t.hasBell));
    } catch {
      // The badge is cosmetic; never let it break the terminal.
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
   * Distribute the available width equally among a tab's panes.
   *
   * This only assigns flex shares; the actual terminal/PTY resizing happens
   * through each pane's ResizeObserver (and explicit fitPane passes where
   * synchronous correctness matters), so every resize flows through a single
   * guarded, deduplicated path.
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

    const share = computeFlexShares(count);
    tab.panes.forEach((pane) => {
      pane.element.style.flex = share;
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

    // Opening a tab clears its silent-bell indicator.
    if (tab.hasBell) {
      this._setTabBell(tab, false);
    }

    // Fit explicitly: the container was hidden (display:none) until now, and
    // waiting for the debounced pane observers would leave a stale grid on
    // screen. Hidden containers cannot be measured, so fitPane is a safe
    // no-op for any pane that is still not laid out.
    for (const pane of tab.panes) {
      fitPane(pane);
    }

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
   * Resize every pane of the active tab to fill the available space.
   *
   * @returns {void}
   */
  fitActiveTab() {
    const tab = this.getActiveTab();
    if (!tab) {
      return;
    }

    for (const pane of tab.panes) {
      fitPane(pane);
    }
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

export { TerminalComponent };
export default TerminalComponent;
