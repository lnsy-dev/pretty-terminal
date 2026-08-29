/**
 * Terminal Component E2E Tests
 *
 * Verifies that the application boots straight into a working xterm.js
 * terminal and that the built-in shell accepts commands.
 */

import { expect, browser } from '@wdio/globals';

describe('terminal initialization', () => {
  it('boots without uncaught errors and exposes a working terminal', async () => {
    await browser.addInitScript(() => {
      window.__terminalInitErrors = [];
      window.addEventListener('error', (e) => {
        window.__terminalInitErrors.push({
          type: 'error',
          message: e.message,
          stack: e.error?.stack,
        });
      });
      window.addEventListener('unhandledrejection', (e) => {
        window.__terminalInitErrors.push({
          type: 'unhandledrejection',
          message: e.reason?.message,
          stack: e.reason?.stack,
        });
      });
    });

    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000, timeoutMsg: 'xterm.js screen never mounted' }
    );

    const state = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      return {
        hasTerminal: !!component?.terminal,
        terminalRows: component?.terminal?.rows,
        terminalCols: component?.terminal?.cols,
        errors: window.__terminalInitErrors || [],
      };
    });

    expect(state.hasTerminal).toBe(true);
    expect(state.terminalRows).toBeGreaterThan(0);
    expect(state.terminalCols).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
  });
});

describe('terminal component', () => {
  beforeEach(async () => {
    await browser.url('/');

    // Wait for xterm.js to mount inside the terminal component.
    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );
  });

  /**
   * Read all visible rows from the xterm.js buffer as a single string.
   *
   * @returns {Promise<string>}
   */
  async function getTerminalText() {
    return browser.execute(() => {
      const component = document.querySelector('terminal-component');
      if (!component || !component.terminal) {
        return '';
      }

      const terminal = component.terminal;
      const buffer = terminal.buffer.active;
      const lines = [];

      for (let i = 0; i < buffer.length; i += 1) {
        const line = buffer.getLine(i);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      return lines.join('\n');
    });
  }

  /**
   * Send keystrokes to the shell and wait for them to be processed.
   *
   * @param {string} text - Raw text to send.
   * @returns {Promise<void>}
   */
  async function sendToTerminal(text) {
    await browser.execute((input) => {
      const component = document.querySelector('terminal-component');
      component.shell.handleData(input);
    }, text);
  }

  it('renders the terminal as the only UI', async () => {
    const terminal = await $('terminal-component');
    await expect(terminal).toExist();

    const childrenCount = await browser.execute(
      () => document.body.children.length
    );

    // Only the title bar and the terminal should be direct children of body.
    expect(childrenCount).toBe(2);
  });

  it('displays the welcome message and prompt', async () => {
    await browser.waitUntil(
      async () => {
        const text = await getTerminalText();
        return text.includes('Welcome to pretty-terminal') && text.includes('> ');
      },
      { timeout: 15000 }
    );
  });

  it('maps the ANSI palette to the dataroom theme colors', async () => {
    const result = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const style = getComputedStyle(component.container);
      const cssVar = (name) => style.getPropertyValue(name).trim();

      return {
        theme: component.terminal.options.theme,
        expected: {
          background: cssVar('--background'),
          foreground: cssVar('--foreground'),
          red: cssVar('--accent-red'),
          green: cssVar('--accent-green'),
          blue: cssVar('--accent-blue'),
          magenta: cssVar('--accent-purple'),
          cyan: cssVar('--accent-cyan'),
          brightBlack: cssVar('--terminal-bright-black'),
          brightWhite: cssVar('--terminal-bright-white'),
        },
      };
    });

    for (const [key, value] of Object.entries(result.expected)) {
      expect(value).not.toBe('');
      expect(result.theme[key]).toBe(value);
    }
  });

  it('adopts the dark palette for new tabs when the theme is dark', async () => {
    const theme = await browser.execute(async () => {
      // Simulate a dark color scheme by overriding the CSS variables that
      // buildTerminalTheme reads. Browser emulate() does not reliably flip
      // the media query in this test environment, so we drive the theme
      // through the same CSS custom properties the app uses at runtime.
      const darkVars = {
        '--background': '#1b1c25',
        '--foreground': '#e5c7a9',
        '--accent-red': '#d9c9c9',
        '--terminal-bright-white': '#e2d5c0',
      };
      for (const [name, value] of Object.entries(darkVars)) {
        document.documentElement.style.setProperty(name, value);
      }

      const component = document.querySelector('terminal-component');
      const beforeTerminal = component.terminal;
      const newTabId = await component.openTab();
      const afterTerminal = component.terminal;
      const newTab = component.tabs.find((t) => t.id === newTabId);
      const newPane = newTab.panes[0];

      return {
        background: afterTerminal.options.theme.background,
        foreground: afterTerminal.options.theme.foreground,
        red: afterTerminal.options.theme.red,
        brightWhite: afterTerminal.options.theme.brightWhite,
        sameAsNewPane: afterTerminal === newPane.terminal,
        sameAsBefore: afterTerminal === beforeTerminal,
      };
    });

    expect(theme.sameAsNewPane).toBe(true);
    expect(theme.sameAsBefore).toBe(false);
    expect(theme.background).toBe('#1b1c25');
    expect(theme.foreground).toBe('#e5c7a9');
    expect(theme.red).toBe('#d9c9c9');
    expect(theme.brightWhite).toBe('#e2d5c0');
  });

  it('updates an existing terminal when the color scheme changes', async () => {
    const result = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const terminal = component.terminal;
      const before = terminal.options.theme.background;

      // Simulate a theme switch by overriding the CSS variables and
      // re-applying the palette, matching what _setupThemeListener does
      // when the system color scheme changes.
      document.documentElement.style.setProperty('--background', '#1b1c25');
      document.documentElement.style.setProperty('--foreground', '#e5c7a9');
      document.documentElement.style.setProperty('--accent-red', '#d9c9c9');
      document.documentElement.style.setProperty('--terminal-bright-white', '#e2d5c0');
      component._applyThemeToAllPanes();

      return {
        before,
        after: terminal.options.theme.background,
        foreground: terminal.options.theme.foreground,
        red: terminal.options.theme.red,
        brightWhite: terminal.options.theme.brightWhite,
      };
    });

    expect(result.before).toBe('#f2ece2');
    expect(result.after).toBe('#1b1c25');
    expect(result.foreground).toBe('#e5c7a9');
    expect(result.red).toBe('#d9c9c9');
    expect(result.brightWhite).toBe('#e2d5c0');
  });

  it('initializes a working shell in a newly opened tab', async () => {
    const newTabId = await browser.execute(async () => {
      const component = document.querySelector('terminal-component');
      return component.openTab();
    });

    expect(newTabId).toBe(2);

    const activeTabId = await browser.execute(() => {
      return document.querySelector('terminal-component').activeTabId;
    });

    expect(activeTabId).toBe(2);

    await browser.waitUntil(
      async () => {
        const text = await getTerminalText();
        return text.includes('Welcome to pretty-terminal') && text.includes('> ');
      },
      { timeout: 15000 }
    );
  });

  it('runs the echo command', async () => {
    const marker = `e2e-${Date.now()}`;
    await sendToTerminal(`echo ${marker}\r`);

    await browser.waitUntil(
      async () => {
        const text = await getTerminalText();
        return text.includes(marker);
      },
      { timeout: 15000 }
    );
  });

  it('runs the help command', async () => {
    await sendToTerminal('help\r');

    await browser.waitUntil(
      async () => {
        const text = await getTerminalText();
        return text.includes('Available commands:');
      },
      { timeout: 15000 }
    );
  });
});

describe('terminal layout', () => {
  afterEach(async () => {
    await browser.setWindowSize(1280, 900);
  });

  it('shrinks to fit a narrow viewport instead of being cut off', async () => {
    await browser.setWindowSize(600, 600);
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );

    const layout = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const rect = component.getBoundingClientRect();
      return {
        componentWidth: rect.width,
        viewportWidth: window.innerWidth,
      };
    });

    // The terminal should never overflow the viewport horizontally.
    expect(layout.componentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });

  it('caps each xterm.js instance at 120ch on a wide viewport', async () => {
    await browser.setWindowSize(1600, 900);
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );

    const layout = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const wrapper = document.querySelector('.xterm-wrapper');
      const componentRect = component.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const chPx = wrapperRect.width / component.terminal.cols;
      return {
        componentWidth: componentRect.width,
        viewportWidth: window.innerWidth,
        wrapperWidth: wrapperRect.width,
        cols: component.terminal.cols,
        chPx,
      };
    });

    // The component itself fills the viewport, but each xterm grid stays
    // within roughly 120 character cells.
    expect(layout.componentWidth).toBeGreaterThan(layout.viewportWidth - 300);
    expect(layout.wrapperWidth).toBeLessThanOrEqual(120 * layout.chPx + 2);
    expect(layout.cols).toBeLessThanOrEqual(121);
  });

  it('resizes the terminal grid when the window is resized', async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );

    const before = await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      return {
        cols: component.terminal.cols,
        rows: component.terminal.rows,
      };
    });

    await browser.setWindowSize(600, 600);

    // Wait for the debounced resize observer to forward the new grid size.
    await browser.waitUntil(
      async () => {
        const after = await browser.execute(() => {
          const component = document.querySelector('terminal-component');
          return {
            cols: component.terminal.cols,
            rows: component.terminal.rows,
          };
        });
        return after.cols < before.cols;
      },
      { timeout: 5000, timeoutMsg: 'terminal cols did not decrease after window resize' }
    );
  });
});
