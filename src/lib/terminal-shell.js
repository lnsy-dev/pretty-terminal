/**
 * Terminal Shell
 *
 * A small line-oriented shell that sits on top of an xterm.js Terminal
 * instance. It handles printable input, backspace, command history, and
 * a handful of built-in commands.
 *
 * The shell is intentionally decoupled from xterm.js so it can be unit
 * tested with a plain "terminal" stub that exposes `write`, `writeln`,
 * and `clear`.
 */

const DEFAULT_PROMPT = '> ';

const ESCAPE_UP = '\x1B[A';
const ESCAPE_DOWN = '\x1B[B';
const ESCAPE_RIGHT = '\x1B[C';
const ESCAPE_LEFT = '\x1B[D';
const CARRIAGE_RETURN = '\r';
const BACKSPACE = '\x7F';
const INTERRUPT = '\x03';
const ERASE_LINE = '\x1B[K';

/**
 * Built-in command table.
 *
 * Each command receives the parsed argument array and the shell instance.
 *
 * @type {Object<string, {description: string, run: (args: string[], shell: TerminalShell) => void}>}
 */
const COMMANDS = {
  help: {
    description: 'Show available commands',
    run(_args, shell) {
      shell.writeln('Available commands:');
      const keys = Object.keys(COMMANDS).sort();
      keys.forEach((key) => {
        shell.writeln(`  ${key.padEnd(10)} ${COMMANDS[key].description}`);
      });
    },
  },

  clear: {
    description: 'Clear the terminal screen',
    run(_args, shell) {
      shell.clear();
    },
  },

  echo: {
    description: 'Print the given arguments',
    run(args, shell) {
      shell.writeln(args.join(' '));
    },
  },

  date: {
    description: 'Print the current date and time',
    run(_args, shell) {
      shell.writeln(new Date().toString());
    },
  },

  whoami: {
    description: 'Print the current user',
    run(_args, shell) {
      shell.writeln('guest');
    },
  },

  exit: {
    description: 'End the session',
    run(_args, shell) {
      shell.writeln('Goodbye.');
    },
  },
};

/**
 * TerminalShell
 *
 * @class
 */
class TerminalShell {
  /**
   * Create a new shell.
   *
   * @param {Object} terminal - Object with `write`, `writeln`, and `clear` methods.
   * @param {string} [prompt='> '] - Prompt string.
   */
  constructor(terminal, prompt = DEFAULT_PROMPT) {
    this.terminal = terminal;
    this.prompt = prompt;
    this.inputLine = '';
    this.history = [];
    this.historyPosition = 0;
    this.draftLine = '';
  }

  /**
   * Print a welcome message and the initial prompt.
   *
   * @returns {void}
   */
  start() {
    this.writeln('Welcome to pretty-terminal.');
    this.writeln('Type "help" for a list of commands.');
    this.writePrompt();
  }

  /**
   * Write raw text to the terminal.
   *
   * @param {string} text - Text to write.
   * @returns {void}
   */
  write(text) {
    this.terminal.write(text);
  }

  /**
   * Write a line of text followed by a newline.
   *
   * @param {string} text - Text to write.
   * @returns {void}
   */
  writeln(text) {
    this.terminal.writeln(text);
  }

  /**
   * Clear the terminal screen.
   *
   * @returns {void}
   */
  clear() {
    this.terminal.clear();
  }

  /**
   * Write the prompt at the current cursor position.
   *
   * @returns {void}
   */
  writePrompt() {
    this.write(this.prompt);
  }

  /**
   * Process a chunk of terminal input data.
   *
   * @param {string} data - Input string from xterm.js `onData`.
   * @returns {void}
   */
  handleData(data) {
    for (const char of data) {
      this.handleCharacter(char);
    }
  }

  /**
   * Handle a single input character.
   *
   * @private
   * @param {string} char - One Unicode character.
   * @returns {void}
   */
  handleCharacter(char) {
    // Multi-character sequences (arrow keys) arrive as single strings from
    // xterm.js, but iterating by code point gives us one char at a time.
    // Accumulate ESC into a buffer and match the full sequence.
    if (this.escapeBuffer !== undefined) {
      this.escapeBuffer += char;
      if (this.escapeBuffer.length >= 3) {
        this.handleEscape(this.escapeBuffer);
        this.escapeBuffer = undefined;
      }
      return;
    }

    if (char === '\x1B') {
      this.escapeBuffer = char;
      return;
    }

    switch (char) {
      case CARRIAGE_RETURN:
        this.processCommand();
        break;
      case BACKSPACE:
        this.backspace();
        break;
      case INTERRUPT:
        this.cancelInput();
        break;
      default:
        if (isPrintable(char)) {
          this.inputLine += char;
          this.write(char);
        }
        break;
    }
  }

  /**
   * Handle an ANSI escape sequence.
   *
   * @private
   * @param {string} sequence - The escape sequence.
   * @returns {void}
   */
  handleEscape(sequence) {
    switch (sequence) {
      case ESCAPE_UP:
        this.historyUp();
        break;
      case ESCAPE_DOWN:
        this.historyDown();
        break;
      case ESCAPE_LEFT:
      case ESCAPE_RIGHT:
        // Cursor movement inside the line is not supported in this simple shell.
        break;
      default:
        // Ignore unknown escape sequences.
        break;
    }
  }

  /**
   * Remove the last character from the current input line.
   *
   * @private
   * @returns {void}
   */
  backspace() {
    if (this.inputLine.length === 0) {
      return;
    }
    this.inputLine = this.inputLine.slice(0, -1);
    this.write('\b \b');
  }

  /**
   * Cancel the current input line (Ctrl+C).
   *
   * @private
   * @returns {void}
   */
  cancelInput() {
    this.write('^C');
    this.write('\r\n');
    this.inputLine = '';
    this.historyPosition = this.history.length;
    this.draftLine = '';
    this.writePrompt();
  }

  /**
   * Submit the current input line as a command.
   *
   * @private
   * @returns {void}
   */
  processCommand() {
    const line = this.inputLine.trim();

    this.write('\r\n');

    if (line.length > 0) {
      this.history.push(line);
      this.historyPosition = this.history.length;
      this.draftLine = '';

      const [commandName, ...args] = line.split(/\s+/);
      const command = COMMANDS[commandName.toLowerCase()];

      if (command) {
        command.run(args, this);
      } else {
        this.writeln(`${commandName}: command not found`);
      }
    }

    this.inputLine = '';
    this.writePrompt();
  }

  /**
   * Recall the previous command from history.
   *
   * @private
   * @returns {void}
   */
  historyUp() {
    if (this.history.length === 0) {
      return;
    }

    if (this.historyPosition === this.history.length) {
      this.draftLine = this.inputLine;
    }

    if (this.historyPosition > 0) {
      this.historyPosition -= 1;
      this.inputLine = this.history[this.historyPosition];
      this.redrawInputLine();
    }
  }

  /**
   * Move forward through command history.
   *
   * @private
   * @returns {void}
   */
  historyDown() {
    if (this.history.length === 0 || this.historyPosition === this.history.length) {
      return;
    }

    this.historyPosition += 1;

    if (this.historyPosition === this.history.length) {
      this.inputLine = this.draftLine;
    } else {
      this.inputLine = this.history[this.historyPosition];
    }

    this.redrawInputLine();
  }

  /**
   * Redraw the current prompt and input line in place.
   *
   * @private
   * @returns {void}
   */
  redrawInputLine() {
    this.write('\r');
    this.write(ERASE_LINE);
    this.writePrompt();
    this.write(this.inputLine);
  }
}

/**
 * Determine whether a character should be echoed to the terminal.
 *
 * @param {string} char - A single Unicode character.
 * @returns {boolean}
 */
function isPrintable(char) {
  const code = char.codePointAt(0);
  return code >= 0x20 && code !== 0x7f;
}

export { COMMANDS, TerminalShell };
export default TerminalShell;
