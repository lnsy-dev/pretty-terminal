/**
 * Vitest Configuration
 *
 * Unit test configuration for the Pochade-Electron template.
 *
 * For LLMs: Vitest runs the fast unit tests in tests/unit/. It is
 * deliberately scoped to that directory so it never picks up the
 * WebdriverIO e2e specs under tests/e2e/ (WebdriverIO likewise only
 * matches tests/e2e/ via its specs glob in wdio.conf.js).
 *
 * Unit tests import modules from src/ directly. Worker-based and
 * browser-API code is tested with explicit mocks (see
 * tests/unit/database.test.js) or against the Node build of
 * sqlite-wasm (see tests/unit/sqlite-worker.test.js).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      /**
       * src/sqlite-worker.js imports the wasm binary URL with:
       *   import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
       * In the browser build webpack turns that into an asset URL.
       * Under Vitest (Node), alias it to a stub module that exports the
       * real file path so the Node build of sqlite-wasm can load it
       * from disk.
       */
      {
        find: '@sqlite.org/sqlite-wasm/sqlite3.wasm',
        replacement: path.resolve(__dirname, 'tests/helpers/sqlite3-wasm-url.js'),
      },
      /**
       * @xterm/addon-ligatures ships its `module` entry as `.mjs` and its
       * `main` entry points to a missing `.js`. Webpack follows `module`,
       * but Vitest follows `main` and fails to resolve. Alias to a stub.
       */
      {
        find: '@xterm/addon-ligatures',
        replacement: path.resolve(__dirname, 'tests/helpers/xterm-addon-ligatures-stub.js'),
      },
    ],
  },
  test: {
    /**
     * Only run unit tests — never WebdriverIO e2e specs.
     */
    include: ['tests/unit/**/*.test.js'],

    /**
     * Unit tests run in Node. Browser APIs are stubbed per-test
     * (vi.stubGlobal) rather than pulling in a DOM emulation layer.
     */
    environment: 'node',
  },
});
