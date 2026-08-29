/**
 * Terminal Sizing
 *
 * Single funnel for all pane sizing math. Every code path that changes a
 * terminal's grid size — pane open, split, close, tab switch, window resize,
 * fullscreen toggle, late font load — goes through fitPane so the rules
 * (guard against hidden containers, skip no-op resizes, dedupe PTY traffic)
 * live in exactly one place.
 *
 * Keeping the number of grid resizes to a minimum matters beyond efficiency:
 * each resize is a SIGWINCH for the PTY child, and fullscreen applications
 * (vim, micro, ...) repaint on every one of them.
 */

/**
 * Compute the flex value that distributes the available width equally among
 * `count` panes.
 *
 * @param {number} count - Number of panes in the tab.
 * @returns {string} CSS flex shorthand (e.g. '1 1 50%').
 */
function computeFlexShares(count) {
  const share = 100 / Math.max(count, 1);
  return `1 1 ${share}%`;
}

/**
 * Resize a pane's terminal to fill its container and forward the new grid
 * size to the PTY when one is running.
 *
 * The fit is guarded end to end:
 *
 * - Hidden or not-yet-laid-out containers (for which FitAddon cannot measure
 *   real cell dimensions) produce no resize at all, and the last known PTY
 *   size is left untouched so a bogus size is never recorded.
 * - Unchanged dimensions skip both the xterm.js resize and the PTY resize,
 *   so observers and explicit refit passes can fire freely without causing
 *   spurious SIGWINCH redraws.
 * - The PTY only receives dimensions that differ from the last size it was
 *   given, and only once it has actually been spawned.
 *
 * @param {Object} pane - Pane object ({ terminal, fitAddon, pty, ptyCreated,
 *   userScrolled, lastPtySize }). `lastPtySize` is updated in place.
 * @returns {{cols: number, rows: number}|null} The fitted size, or null when
 *   the container could not be measured.
 */
function fitPane(pane) {
  const dims = pane.fitAddon.proposeDimensions();

  if (
    !dims ||
    !Number.isFinite(dims.cols) ||
    !Number.isFinite(dims.rows) ||
    dims.cols <= 0 ||
    dims.rows <= 0
  ) {
    return null;
  }

  const gridChanged = dims.cols !== pane.terminal.cols || dims.rows !== pane.terminal.rows;
  if (gridChanged) {
    pane.terminal.resize(dims.cols, dims.rows);
    if (!pane.userScrolled) {
      pane.terminal.scrollToBottom();
    }
  }

  const ptyChanged =
    !pane.lastPtySize ||
    pane.lastPtySize.cols !== dims.cols ||
    pane.lastPtySize.rows !== dims.rows;
  if (pane.pty && pane.ptyCreated && ptyChanged) {
    pane.pty.resize(dims.cols, dims.rows);
  }

  pane.lastPtySize = { cols: dims.cols, rows: dims.rows };
  return pane.lastPtySize;
}

export { computeFlexShares, fitPane };
