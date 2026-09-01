/**
 * PTY Process Detection Unit Tests
 *
 * Verifies that child-process detection for the quit/close confirmation
 * guards parses pgrep output correctly and degrades gracefully (no children,
 * pgrep failures, unsupported platforms).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { parsePgrepOutput, listChildPids, hasRunningProcesses } from '../../electron/pty-processes.js';

describe('pty-processes', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  describe('parsePgrepOutput', () => {
    it('parses newline-separated pids', () => {
      expect(parsePgrepOutput('123\n456\n789\n')).toEqual([123, 456, 789]);
    });

    it('ignores blank lines and non-numeric garbage', () => {
      expect(parsePgrepOutput('\n123\n\nabc\n456\n')).toEqual([123, 456]);
    });

    it('returns an empty list for empty output', () => {
      expect(parsePgrepOutput('')).toEqual([]);
    });
  });

  describe('listChildPids', () => {
    it('runs pgrep -P against the shell pid and parses the pids', async () => {
      execFile.mockImplementation((cmd, args, cb) => {
        expect(cmd).toBe('pgrep');
        expect(args).toEqual(['-P', '999']);
        cb(null, '42\n43\n');
      });

      await expect(listChildPids(999)).resolves.toEqual([42, 43]);
    });

    it('resolves to an empty list when pgrep reports no children', async () => {
      // pgrep exits non-zero when nothing matches; that is normal.
      execFile.mockImplementation((cmd, args, cb) => {
        cb(Object.assign(new Error('exit 1'), { code: 1 }), '');
      });

      await expect(listChildPids(999)).resolves.toEqual([]);
    });

    it('resolves to an empty list when pgrep fails unexpectedly', async () => {
      execFile.mockImplementation((cmd, args, cb) => {
        cb(new Error('ENOENT'), '');
      });

      await expect(listChildPids(999)).resolves.toEqual([]);
    });

    it('reports no children on platforms without pgrep (win32)', async () => {
      await expect(listChildPids(999, 'win32')).resolves.toEqual([]);
      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('hasRunningProcesses', () => {
    it('is true when the shell has child processes', async () => {
      execFile.mockImplementation((cmd, args, cb) => cb(null, '42\n'));
      await expect(hasRunningProcesses(999)).resolves.toBe(true);
    });

    it('is false when the shell has no child processes', async () => {
      execFile.mockImplementation((cmd, args, cb) => cb(null, ''));
      await expect(hasRunningProcesses(999)).resolves.toBe(false);
    });
  });
});
