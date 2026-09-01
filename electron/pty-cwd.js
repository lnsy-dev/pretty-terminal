/**
 * PTY Working Directory Resolution
 *
 * Resolves the current working directory of a running PTY process so newly
 * opened tabs can start their shell in the same directory the user is
 * currently in, instead of always falling back to the home directory.
 *
 * There is no portable API for this, so the implementation is per-platform:
 *   - macOS: `lsof -a -p <pid> -d cwd -Fn` (the only sanctioned way to read
 *     another process's cwd on Darwin).
 *   - Linux: readlink(2) on /proc/<pid>/cwd.
 *
 * All failures resolve to null; callers fall back to the home directory.
 */

import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Parse the cwd out of `lsof -a -p <pid> -d cwd -Fn` output.
 *
 * The -F output mode emits one field per line, each prefixed with a single
 * character tag: `p<pid>`, `c<command>`, and `n<name>` for the file name.
 * With `-d cwd` exactly one entry matches, so the `n` line holds the cwd.
 *
 * @param {string} stdout - Raw lsof -F output.
 * @returns {string|null} The working directory, or null if absent.
 */
export function parseLsofCwd(stdout) {
  const line = stdout.split('\n').find((l) => l.startsWith('n/'));
  return line ? line.slice(1) : null;
}

/**
 * Resolve the current working directory of a process.
 *
 * @param {number|null|undefined} pid - Process id to inspect.
 * @returns {Promise<string|null>} The cwd path, or null when it cannot be
 *   determined (unknown pid, unsupported platform, lsof missing, ...).
 */
export async function resolvePtyCwd(pid) {
  if (!pid) {
    return null;
  }

  try {
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
      return parseLsofCwd(stdout);
    }
    if (process.platform === 'linux') {
      return await readlink(`/proc/${pid}/cwd`);
    }
  } catch {
    // Fall through: an unreadable cwd is not an error worth surfacing; the
    // caller just starts the new shell in the home directory instead.
  }

  return null;
}
