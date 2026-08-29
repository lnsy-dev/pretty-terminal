/**
 * Terminal Shell Unit Tests
 *
 * Verifies the line editor, built-in commands, and command history
 * without needing a real xterm.js Terminal instance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalShell, COMMANDS } from '../../src/lib/terminal-shell.js';

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
