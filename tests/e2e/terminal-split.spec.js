/**
 * Terminal Split Pane E2E Tests
 *
 * Regression tests for split-pane layout and resizing: equal width
 * distribution, no horizontal overflow, grid sizes that follow the container,
 * and a bottom row that is never clipped (guards the removed row-buffer
 * workaround).
 */

import { expect, browser } from '@wdio/globals';

describe('terminal split panes', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1280, 900);
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000, timeoutMsg: 'xterm.js screen never mounted' }
    );
  });

  afterEach(async () => {
    await browser.setWindowSize(1280, 900);
  });

  /**
   * Split the active tab and wait for the second pane to mount.
   *
   * @returns {Promise<void>}
   */
  async function splitAndWait() {
    await browser.execute(() => {
      document.querySelector('terminal-component').splitActiveTab();
    });
    await browser.waitUntil(
      async () => (await $$('.terminal-pane')).length === 2,
      { timeout: 5000, timeoutMsg: 'second pane never mounted' }
    );
  }

  /**
   * Read layout metrics for every pane of the active tab.
   *
   * @returns {Promise<{areaWidth: number, panes: Array}>}
   */
  async function getPaneMetrics() {
    return browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const tab = component.tabs.find((t) => t.id === component.activeTabId);
      const area = component.terminalArea.getBoundingClientRect();
      return {
        areaWidth: area.width,
        areaScrollWidth: component.terminalArea.scrollWidth,
        areaClientWidth: component.terminalArea.clientWidth,
        panes: tab.panes.map((pane) => ({
          id: pane.id,
          width: pane.element.getBoundingClientRect().width,
          cols: pane.terminal.cols,
          rows: pane.terminal.rows,
        })),
      };
    });
  }

  it('gives both panes equal width without overflowing the terminal area', async () => {
    await splitAndWait();

    const metrics = await getPaneMetrics();

    expect(metrics.panes).toHaveLength(2);
    const [first, second] = metrics.panes;
    // Equal shares, each half of the area (allowing sub-pixel rounding).
    expect(Math.abs(first.width - second.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(first.width - metrics.areaWidth / 2)).toBeLessThanOrEqual(2);
    // No horizontal overflow.
    expect(first.width + second.width).toBeLessThanOrEqual(metrics.areaWidth + 2);
    expect(metrics.areaScrollWidth).toBeLessThanOrEqual(metrics.areaClientWidth + 1);
  });

  it('halves the terminal grid columns when splitting', async () => {
    const before = await getPaneMetrics();
    expect(before.panes).toHaveLength(1);

    await splitAndWait();

    // The grid refits after the split (debounced observer).
    await browser.waitUntil(
      async () => {
        const metrics = await getPaneMetrics();
        return metrics.panes.every((pane) => pane.cols < before.panes[0].cols);
      },
      { timeout: 5000, timeoutMsg: 'pane cols did not shrink after split' }
    );

    const metrics = await getPaneMetrics();
    const [first, second] = metrics.panes;
    expect(first.cols).toBe(second.cols);
    // Roughly half the columns (borders/scrollbar eat a few cells).
    expect(first.cols).toBeLessThanOrEqual(Math.ceil(before.panes[0].cols / 2) + 2);
    expect(first.cols).toBeGreaterThanOrEqual(Math.floor(before.panes[0].cols / 2) - 4);
  });

  it('restores full width when the split pane is closed', async () => {
    const before = await getPaneMetrics();

    await splitAndWait();

    // Let the split settle so both panes reach their halved column count.
    await browser.waitUntil(
      async () => {
        const metrics = await getPaneMetrics();
        return metrics.panes.every((pane) => pane.cols < before.panes[0].cols);
      },
      { timeout: 5000, timeoutMsg: 'pane cols did not shrink after split' }
    );
    const split = await getPaneMetrics();

    await browser.execute(() => {
      const component = document.querySelector('terminal-component');
      const tab = component.tabs.find((t) => t.id === component.activeTabId);
      component.closePane(tab.activePaneId);
    });

    await browser.waitUntil(
      async () => (await $$('.terminal-pane')).length === 1,
      { timeout: 5000, timeoutMsg: 'pane was not closed' }
    );

    // The remaining pane must grow back (debounced observer refit) to its
    // pre-split size.
    await browser.waitUntil(
      async () => {
        const metrics = await getPaneMetrics();
        return metrics.panes[0].cols > split.panes[0].cols;
      },
      { timeout: 5000, timeoutMsg: 'remaining pane did not grow back after close' }
    );

    const metrics = await getPaneMetrics();
    expect(Math.abs(metrics.panes[0].cols - before.panes[0].cols)).toBeLessThanOrEqual(2);
    expect(Math.abs(metrics.panes[0].width - metrics.areaWidth)).toBeLessThanOrEqual(2);
  });

  it('shrinks both panes proportionally when the window is resized', async () => {
    await splitAndWait();

    const before = await getPaneMetrics();

    await browser.setWindowSize(800, 900);

    await browser.waitUntil(
      async () => {
        const metrics = await getPaneMetrics();
        return metrics.panes.every((pane, i) => pane.cols < before.panes[i].cols);
      },
      { timeout: 5000, timeoutMsg: 'pane cols did not shrink after window resize' }
    );

    const metrics = await getPaneMetrics();
    expect(metrics.panes[0].cols).toBe(metrics.panes[1].cols);
    expect(metrics.areaScrollWidth).toBeLessThanOrEqual(metrics.areaClientWidth + 1);
  });

  it('never renders a grid taller than its pane (bottom row stays visible)', async () => {
    // Odd heights exercise fractional-pixel rounding in the fit math.
    for (const height of [900, 901, 857]) {
      await browser.setWindowSize(1280, height);

      await browser.waitUntil(
        async () => {
          return browser.execute(() => {
            const pane = document.querySelector('.terminal-pane');
            const screen = document.querySelector('.xterm-screen');
            if (!pane || !screen) {
              return false;
            }
            // The rendered grid must fit inside the pane: if it were taller,
            // the bottom row of text would be clipped.
            return screen.getBoundingClientRect().height <= pane.clientHeight + 1;
          });
        },
        { timeout: 5000, timeoutMsg: `grid taller than pane at window height ${height}` }
      );
    }
  });
});
