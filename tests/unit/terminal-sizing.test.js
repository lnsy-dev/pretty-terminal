/**
 * Terminal Sizing Unit Tests
 *
 * Tests the single resize funnel (fitPane) and the flex-share math in
 * isolation. These guards are what keep spurious resizes (extra SIGWINCHs,
 * vim/micro redraws, zsh PROMPT_SP glitches) from reaching the PTY.
 */

import { describe, it, expect, vi } from 'vitest';

import { computeFlexShares, fitPane } from '../../src/lib/terminal-sizing.js';

/**
 * Build a pane object with mock terminal/fitAddon/pty.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function makePane(overrides = {}) {
  const terminal = {
    cols: 80,
    rows: 24,
    resize: vi.fn(function resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;
    }),
    scrollToBottom: vi.fn(),
  };
  const fitAddon = {
    proposeDimensions: vi.fn(() => ({ cols: 100, rows: 30 })),
  };
  const pty = { resize: vi.fn() };

  return {
    terminal,
    fitAddon,
    pty,
    ptyCreated: true,
    userScrolled: false,
    lastPtySize: null,
    ...overrides,
  };
}

describe('computeFlexShares', () => {
  it('gives a single pane the full width', () => {
    expect(computeFlexShares(1)).toBe('1 1 100%');
  });

  it('splits the width equally between two panes', () => {
    expect(computeFlexShares(2)).toBe('1 1 50%');
  });

  it('splits the width equally between three panes', () => {
    expect(computeFlexShares(3)).toBe(`1 1 ${100 / 3}%`);
  });

  it('never divides by zero', () => {
    expect(computeFlexShares(0)).toBe('1 1 100%');
  });
});

describe('fitPane', () => {
  it('resizes the terminal and forwards the exact dimensions to the PTY', () => {
    const pane = makePane();

    const result = fitPane(pane);

    expect(pane.terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(pane.pty.resize).toHaveBeenCalledWith(100, 30);
    expect(pane.terminal.scrollToBottom).toHaveBeenCalled();
    expect(result).toEqual({ cols: 100, rows: 30 });
    expect(pane.lastPtySize).toEqual({ cols: 100, rows: 30 });
  });

  it('does nothing when the container cannot be measured (hidden tab)', () => {
    const pane = makePane();
    pane.fitAddon.proposeDimensions = vi.fn(() => undefined);

    const result = fitPane(pane);

    expect(result).toBeNull();
    expect(pane.terminal.resize).not.toHaveBeenCalled();
    expect(pane.pty.resize).not.toHaveBeenCalled();
    // A bogus size must never be recorded: a later real fit would otherwise
    // be deduped against it and never reach the PTY.
    expect(pane.lastPtySize).toBeNull();
  });

  it.each([
    [{ cols: NaN, rows: 30 }],
    [{ cols: 100, rows: NaN }],
    [{ cols: 0, rows: 30 }],
    [{ cols: 100, rows: 0 }],
  ])('rejects invalid dimensions %j', (dims) => {
    const pane = makePane();
    pane.fitAddon.proposeDimensions = vi.fn(() => dims);

    expect(fitPane(pane)).toBeNull();
    expect(pane.terminal.resize).not.toHaveBeenCalled();
    expect(pane.pty.resize).not.toHaveBeenCalled();
    expect(pane.lastPtySize).toBeNull();
  });

  it('skips the terminal resize when the grid already has the fitted size', () => {
    const pane = makePane({
      terminal: {
        cols: 100,
        rows: 30,
        resize: vi.fn(),
        scrollToBottom: vi.fn(),
      },
      lastPtySize: { cols: 100, rows: 30 },
    });

    const result = fitPane(pane);

    expect(result).toEqual({ cols: 100, rows: 30 });
    expect(pane.terminal.resize).not.toHaveBeenCalled();
    expect(pane.pty.resize).not.toHaveBeenCalled();
    expect(pane.terminal.scrollToBottom).not.toHaveBeenCalled();
  });

  it('does not forward the same dimensions to the PTY twice', () => {
    const pane = makePane();

    fitPane(pane);
    expect(pane.pty.resize).toHaveBeenCalledTimes(1);

    // Force another measurement cycle with unchanged results.
    pane.terminal.resize.mockClear();
    fitPane(pane);
    expect(pane.pty.resize).toHaveBeenCalledTimes(1);
  });

  it('does not resize a PTY that has not been spawned yet', () => {
    const pane = makePane({ ptyCreated: false });

    const result = fitPane(pane);

    expect(result).toEqual({ cols: 100, rows: 30 });
    expect(pane.terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(pane.pty.resize).not.toHaveBeenCalled();
    // The size is still recorded so the spawn-time dedupe has a baseline.
    expect(pane.lastPtySize).toEqual({ cols: 100, rows: 30 });
  });

  it('works without a PTY (browser fallback shell)', () => {
    const pane = makePane({ pty: null, ptyCreated: false });

    const result = fitPane(pane);

    expect(result).toEqual({ cols: 100, rows: 30 });
    expect(pane.terminal.resize).toHaveBeenCalledWith(100, 30);
  });

  it('does not scroll to bottom when the user has scrolled up', () => {
    const pane = makePane({ userScrolled: true });

    fitPane(pane);

    expect(pane.terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(pane.terminal.scrollToBottom).not.toHaveBeenCalled();
  });
});
