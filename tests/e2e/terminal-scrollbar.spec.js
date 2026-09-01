/**
 * Terminal Scrollbar E2E Tests
 *
 * Verifies that xterm.js's scrollbar is visually hidden while the
 * viewport stays scrollable (wheel/trackpad scrolling still works).
 */

import { expect, browser } from '@wdio/globals';

describe('terminal scrollbar', () => {
  beforeEach(async () => {
    await browser.url('/');

    await browser.waitUntil(
      async () => {
        const screen = await $('.xterm-screen');
        return screen.isExisting();
      },
      { timeout: 15000 }
    );
  });

  it('hides the xterm.js scrollbar', async () => {
    const result = await browser.execute(() => {
      const viewport = document.querySelector('.terminal-pane .xterm-viewport');
      if (!viewport) {
        return null;
      }
      const style = getComputedStyle(viewport);
      const webkitScrollbar = getComputedStyle(viewport, '::-webkit-scrollbar');
      return {
        scrollbarWidth: style.scrollbarWidth,
        webkitDisplay: webkitScrollbar.display,
        // The viewport must remain the scroll container.
        isScrollContainer: viewport.scrollHeight >= viewport.clientHeight,
      };
    });

    expect(result).not.toBeNull();
    expect(result.scrollbarWidth).toBe('none');
    expect(result.webkitDisplay).toBe('none');
    expect(result.isScrollContainer).toBe(true);
  });
});
