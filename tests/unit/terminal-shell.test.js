/**
 * Terminal Shell Unit Tests
 *
 * Verifies the line editor, built-in commands, and command history
 * without needing a real xterm.js Terminal instance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalShell, COMMANDS, longestCommonPrefix } from '../../src/lib/terminal-shell.js';

/**
 * Create a fake terminal that captures everything written to it.
 *
 * @returns {{terminal: Object, lines: string[]}}
 */
function createStubTerminal() {
  const lines = [];

  const terminal = {
    buffer: '',
    write(text) {
      this.buffer += text;
    },
    writeln(text) {
      this.buffer += `${text}\r\n`;
    },
    clear() {
      this.buffer = '';
      lines.push('[clear]');
    },
  };

  return { terminal, lines };
}

/**
 * Flush the terminal buffer into the captured lines array.
 *
 * @param {{buffer: string}} terminal - Stub terminal.
 * @returns {string}
 */
function flushBuffer(terminal) {
  const text = terminal.buffer;
  terminal.buffer = '';
  return text;
}

describe('TerminalShell', () => {
  let stub;
  let shell;

  beforeEach(() => {
    stub = createStubTerminal();
    shell = new TerminalShell(stub.terminal);
  });

  it('prints a prompt and accepts typed input', () => {
    shell.start();
    const intro = flushBuffer(stub.terminal);
    expect(intro).toContain('Welcome to pretty-terminal');
    expect(intro).toContain('> ');

    shell.handleData('hello');
    expect(flushBuffer(stub.terminal)).toBe('hello');
  });

  it('executes the echo command', () => {
    shell.handleData('echo one two three\r');
    const output = flushBuffer(stub.terminal);
    expect(output).toContain('one two three');
  });

  it('executes the help command', () => {
    shell.handleData('help\r');
    const output = flushBuffer(stub.terminal);
    expect(output).toContain('Available commands:');
    expect(output).toContain('help');
    expect(output).toContain('clear');
  });

  it('reports unknown commands', () => {
    shell.handleData('nope\r');
    const output = flushBuffer(stub.terminal);
    expect(output).toContain('nope: command not found');
  });

  it('clears the screen', () => {
    shell.handleData('clear\r');
    expect(stub.lines).toContain('[clear]');
  });

  it('supports backspace', () => {
    shell.handleData('abc');
    shell.handleData('\x7F');
    expect(shell.inputLine).toBe('ab');
    expect(flushBuffer(stub.terminal)).toBe('abc\b \b');
  });

  it('ignores backspace when the input line is empty', () => {
    shell.handleData('\x7F');
    expect(shell.inputLine).toBe('');
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('cancels the current line on Ctrl+C', () => {
    shell.handleData('partial');
    shell.handleData('\x03');
    const output = flushBuffer(stub.terminal);
    expect(output).toContain('^C');
    expect(shell.inputLine).toBe('');
  });

  it('cycles through command history with arrow keys', () => {
    shell.handleData('first\r');
    shell.handleData('second\r');

    flushBuffer(stub.terminal);

    shell.handleData('\x1B[A');
    expect(shell.inputLine).toBe('second');

    shell.handleData('\x1B[A');
    expect(shell.inputLine).toBe('first');

    shell.handleData('\x1B[B');
    expect(shell.inputLine).toBe('second');

    shell.handleData('\x1B[B');
    expect(shell.inputLine).toBe('');
  });

  it('preserves the current draft when recalling history', () => {
    shell.handleData('historical\r');
    shell.handleData('draft');

    shell.handleData('\x1B[A');
    expect(shell.inputLine).toBe('historical');

    shell.handleData('\x1B[B');
    expect(shell.inputLine).toBe('draft');
  });

  it('does not add empty commands to history', () => {
    shell.handleData('\r');
    shell.handleData('\x1B[A');
    expect(shell.history.length).toBe(0);
    expect(shell.inputLine).toBe('');
  });
});

describe('TerminalShell tab completion', () => {
  let stub;
  let shell;

  beforeEach(() => {
    stub = createStubTerminal();
    shell = new TerminalShell(stub.terminal);
    shell.start();
    flushBuffer(stub.terminal);
  });

  it('completes a unique command name and adds a trailing space', () => {
    shell.handleData('cle');
    flushBuffer(stub.terminal); // drop the echo of the typed characters
    shell.handleData('\t');
    expect(shell.inputLine).toBe('clear ');
    // A full in-place redraw, not an append: no duplicated text.
    expect(flushBuffer(stub.terminal)).toBe('\r\x1B[K> clear ');
  });

  it('completes each built-in command from an unambiguous prefix', () => {
    for (const command of Object.keys(COMMANDS)) {
      const partial = command.slice(0, Math.max(command.length - 1, 1));
      // Skip prefixes that also match another command (e.g. "ec" vs "exit").
      const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(partial));
      if (matches.length !== 1) {
        continue;
      }
      shell.handleData(`${partial}\t`);
      expect(shell.inputLine).toBe(`${command} `);
      flushBuffer(stub.terminal);
      shell.handleData('\x03'); // Ctrl+C resets the line for the next case
      flushBuffer(stub.terminal);
    }
  });

  it('extends the line to the common prefix when several commands match', () => {
    shell.handleData('e');
    flushBuffer(stub.terminal);
    shell.handleData('\t'); // candidates: echo, exit -> common prefix "e"
    expect(shell.inputLine).toBe('e');
    // Nothing to add, so nothing may be written to the terminal.
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('is idempotent when Tab is pressed repeatedly (no duplicated text)', () => {
    shell.handleData('cle\t');
    expect(shell.inputLine).toBe('clear ');
    flushBuffer(stub.terminal);

    shell.handleData('\t');
    shell.handleData('\t');
    expect(shell.inputLine).toBe('clear ');
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('writes the completed text exactly once across the whole session', () => {
    shell.handleData('da\t');
    shell.handleData('\r');
    const output = stub.terminal.buffer;
    const occurrences = output.split('date').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does nothing on an empty input line', () => {
    shell.handleData('\t');
    expect(shell.inputLine).toBe('');
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('does nothing when no command matches the prefix', () => {
    shell.handleData('zz');
    flushBuffer(stub.terminal);
    shell.handleData('\t');
    expect(shell.inputLine).toBe('zz');
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('never inserts a literal tab character into the input line', () => {
    for (const input of ['', 'e', 'cle', 'zz', 'echo o']) {
      shell.inputLine = input;
      shell.handleData('\t');
      expect(shell.inputLine.includes('\t')).toBe(false);
    }
  });

  it('does not complete past the command position (no filesystem access)', () => {
    shell.handleData('echo on');
    flushBuffer(stub.terminal);
    shell.handleData('\t');
    expect(shell.inputLine).toBe('echo on');
    expect(flushBuffer(stub.terminal)).toBe('');
  });

  it('runs the command after completion', () => {
    shell.handleData('cle\t\r');
    expect(stub.lines).toContain('[clear]');
    expect(shell.inputLine).toBe('');
  });
});

describe('longestCommonPrefix', () => {
  it('returns the whole string for a single candidate', () => {
    expect(longestCommonPrefix(['clear'])).toBe('clear');
  });

  it('returns the shared prefix of all candidates', () => {
    expect(longestCommonPrefix(['echo', 'exit'])).toBe('e');
    expect(longestCommonPrefix(['cl', 'clear', 'clea'])).toBe('cl');
  });

  it('returns an empty string when candidates share nothing', () => {
    expect(longestCommonPrefix(['echo', 'help'])).toBe('');
  });
});

describe('COMMANDS', () => {
  it('contains the expected built-ins', () => {
    expect(Object.keys(COMMANDS).sort()).toEqual([
      'clear',
      'date',
      'echo',
      'exit',
      'help',
      'whoami',
    ]);
  });
});
