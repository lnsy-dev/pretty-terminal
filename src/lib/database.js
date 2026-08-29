/**
 * Database Client Library
 *
 * Promise-based main-thread client for the sqlite worker
 * (src/sqlite-worker.js). All database access in the app should go
 * through this module — components never talk to the worker directly.
 *
 * The lower half of the file is a generic request/response transport;
 * the upper half (exported helpers) is the app's domain API: a `notes`
 * table with create/read/delete plus index generation.
 *
 * For LLMs: when adding a new table or query, add a helper here that
 * composes `callWorker('exec', ...)` / `callWorker('query', ...)`.
 * Always use bound parameters (?) for user input — never string
 * interpolation into SQL.
 */

/**
 * Lazily-created module worker instance.
 *
 * Note the `{ type: 'module' }` option: this worker imports npm modules
 * and a .wasm URL, so it uses webpack 5's native module-worker support
 * instead of the classic inline-worker transform.
 *
 * @type {Worker|null}
 */
let worker = null;

/** @type {number} Monotonic request id counter */
let nextRequestId = 1;

/** @type {Map<number, {resolve: Function, reject: Function}>} In-flight requests */
const pendingRequests = new Map();

/**
 * Get (or create) the sqlite worker and wire up its message handler.
 *
 * @returns {Worker} The sqlite worker instance
 */
function getWorker() {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL('../sqlite-worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data;
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(id);
    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error));
    }
  };

  worker.onerror = (error) => {
    // A catastrophic worker failure rejects every in-flight request
    pendingRequests.forEach(({ reject }) => {
      reject(new Error(`SQLite worker error: ${error.message}`));
    });
    pendingRequests.clear();
  };

  return worker;
}

/**
 * Send an action to the worker and await its response.
 *
 * @param {string} action - Action name (see src/sqlite-worker.js)
 * @param {object} [params={}] - Action parameters
 * @returns {Promise<any>} The action result
 */
function callWorker(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pendingRequests.set(id, { resolve, reject });
    getWorker().postMessage({ id, action, params });
  });
}

/**
 * Report whether the database is persisted (OPFS) or transient,
 * along with the SQLite version.
 *
 * @returns {Promise<{persistent: boolean, filename: string, sqliteVersion: string}>}
 */
export function getStatus() {
  return callWorker('status');
}

/**
 * Create the notes table if it does not exist yet.
 * Safe to call on every app start.
 *
 * @returns {Promise<void>}
 */
export async function initSchema() {
  await callWorker('exec', {
    sql: `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  });
}

/**
 * Insert a note and return its new row id.
 *
 * @param {string} content - The note text
 * @returns {Promise<number>} The id of the inserted row
 */
export async function addNote(content) {
  await callWorker('exec', {
    sql: 'INSERT INTO notes (content, created_at) VALUES (?, ?)',
    params: [content, new Date().toISOString()],
  });
  const rows = await callWorker('query', { sql: 'SELECT last_insert_rowid() AS id' });
  return rows[0].id;
}

/**
 * List all notes, newest first.
 *
 * @returns {Promise<Array<{id: number, content: string, created_at: string}>>}
 */
export function listNotes() {
  return callWorker('query', {
    sql: 'SELECT id, content, created_at FROM notes ORDER BY id DESC',
  });
}

/**
 * Delete a note by id.
 *
 * @param {number} id - The note id
 * @returns {Promise<void>}
 */
export async function deleteNote(id) {
  await callWorker('exec', {
    sql: 'DELETE FROM notes WHERE id = ?',
    params: [id],
  });
}

/**
 * Generate an index on the notes table (created_at column).
 * Idempotent: uses CREATE INDEX IF NOT EXISTS.
 *
 * @returns {Promise<void>}
 */
export async function createNotesIndex() {
  await callWorker('exec', {
    sql: 'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)',
  });
}

/**
 * List the user-created indexes currently in the database.
 *
 * @returns {Promise<Array<{name: string, tbl_name: string}>>}
 */
export function listIndexes() {
  return callWorker('query', {
    sql: `SELECT name, tbl_name FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  });
}

/**
 * Serialize the whole database to bytes (SQLite file format).
 * Pair with the File System Access API to save it to disk.
 *
 * @returns {Promise<Uint8Array>} The database file image
 */
export function exportDatabase() {
  return callWorker('export');
}

/**
 * Replace the current database contents with a database file image
 * previously produced by exportDatabase() (or any SQLite file).
 *
 * @param {Uint8Array} bytes - The database file image
 * @returns {Promise<void>}
 */
export async function importDatabase(bytes) {
  await callWorker('import', { bytes });
}
