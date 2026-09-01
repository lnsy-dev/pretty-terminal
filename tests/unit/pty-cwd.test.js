/**
 * PTY Working Directory Resolution Unit Tests
 *
 * Verifies that resolvePtyCwd reads a process's working directory from the
 * platform-appropriate source (lsof on macOS, /proc on Linux) and degrades
 * gracefully to null on any failure.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readlink: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { parseLsofCwd, resolvePtyCwd } from '../../electron/pty-cwd.js';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

/**
 * Stub process.platform for the duration of one test.
 *
 * @param {string} platform - Platform name to emulate.
 */
function stubPlatform(platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.clearAllMocks();
});

describe('parseLsofCwd', () => {
  it('extracts the cwd from lsof -F output', () => {
    const output = 'p1234\nc zsh\nn/Users/lnsy/Code/pretty-terminal\n';
    expect(parseLsofCwd(output)).toBe('/Users/lnsy/Code/pretty-terminal');
  });

  it('returns null when no name field is present', () => {
    expect(parseLsofCwd('p1234\nc zsh\n')).toBeNull();
    expect(parseLsofCwd('')).toBeNull();
  });
});

describe('resolvePtyCwd', () => {
  it('returns null for a missing pid', async () => {
    await expect(resolvePtyCwd(undefined)).resolves.toBeNull();
    await expect(resolvePtyCwd(null)).resolves.toBeNull();
  });

  it('parses lsof output on macOS', async () => {
    stubPlatform('darwin');
    execFile.mockImplementation((cmd, args, cb) => {
      expect(cmd).toBe('lsof');
      expect(args).toEqual(['-a', '-p', '4242', '-d', 'cwd', '-Fn']);
      cb(null, { stdout: 'p4242\nc zsh\nn/tmp/project\n' });
    });

    await expect(resolvePtyCwd(4242)).resolves.toBe('/tmp/project');
  });

  it('readlinks /proc on Linux', async () => {
    stubPlatform('linux');
    readlink.mockResolvedValue('/home/lnsy/work');

    await expect(resolvePtyCwd(4242)).resolves.toBe('/home/lnsy/work');
    expect(readlink).toHaveBeenCalledWith('/proc/4242/cwd');
  });

  it('resolves null when lsof fails', async () => {
    stubPlatform('darwin');
    execFile.mockImplementation((cmd, args, cb) => cb(new Error('no such process')));

    await expect(resolvePtyCwd(999999)).resolves.toBeNull();
  });

  it('resolves null on unsupported platforms', async () => {
    stubPlatform('win32');
    await expect(resolvePtyCwd(4242)).resolves.toBeNull();
  });
});
