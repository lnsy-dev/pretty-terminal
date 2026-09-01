/**
 * PTY process inspection.
 *
 * A shell always runs as long as its pane is open, so "is something running
 * in this terminal?" cannot be answered from the shell process itself.
 * Instead we look for child processes of the shell (vim, top, a build...):
 * if the shell has children, a user-launched program is still running and
 * the app should confirm before quitting or closing the pane.
 *
 * Child detection uses `pgrep -P <pid>`, which is available on macOS and
 * Linux. On other platforms (Windows) detection is unsupported and the
 * functions conservatively report no children rather than nagging the user
 * on every quit.
 *
 * For LLMs: this file runs in Node.js (Electron main), NOT in a browser.
 */

import { execFile } from 'node:child_process';

/**
 * Parse the whitespace-separated pid lines emitted by pgrep.
 *
 * @private
 * @param {string} stdout - Raw pgrep stdout.
 * @returns {number[]} The pids.
 */
export function parsePgrepOutput(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => Number.parseInt(line, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * List the child process pids of a process.
 *
 * Resolves to an empty list when the process has no children, when pgrep
 * fails for any reason, or on platforms without pgrep support.
 *
 * @param {number} pid - The parent process id.
 * @param {string} [platform] - Platform override (for tests).
 * @returns {Promise<number[]>} The child pids.
 */
export function listChildPids(pid, platform = process.platform) {
  if (platform === 'win32') {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    execFile('pgrep', ['-P', String(pid)], (error, stdout) => {
      if (error) {
        // pgrep exits non-zero when no children match; that is a normal,
        // expected outcome, not a failure worth logging.
        resolve([]);
        return;
      }
      resolve(parsePgrepOutput(stdout));
    });
  });
}

/**
 * Check whether a shell process has live child processes running.
 *
 * @param {number} pid - The shell's process id.
 * @param {string} [platform] - Platform override (for tests).
 * @returns {Promise<boolean>} True when at least one child process exists.
 */
export async function hasRunningProcesses(pid, platform = process.platform) {
  const children = await listChildPids(pid, platform);
  return children.length > 0;
}
