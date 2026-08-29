/**
 * WebdriverIO Configuration
 *
 * End-to-end test configuration for the Pochade-Electron template.
 *
 * For LLMs: WebdriverIO tests drive a real (headless) Chrome against
 * the webpack dev server. They exercise the full stack: webpack
 * bundling, the dev server, custom elements, web workers,
 * WebAssembly, OPFS persistence, and (mocked) File System Access
 * dialogs.
 *
 * The File System Access pickers are NATIVE dialogs — no automation
 * tool can click them. The e2e suite therefore stubs
 * window.showSaveFilePicker / window.showOpenFilePicker via
 * browser.addInitScript() and asserts how our code drives the dialog
 * API (see tests/e2e/file-storage-component.spec.js).
 *
 * Unlike Playwright, a WebdriverIO session is REUSED across tests in
 * a spec file (and OPFS data persists between navigations). Specs
 * that touch the database must clean up leftover entries in
 * beforeEach — see clearExistingEntries() in tests/helpers/e2e-utils.js.
 */

import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import chromedriver from 'chromedriver';

// Load the project-specific dev server port so WebdriverIO uses the same
// URL as `npm start` and `npm run electron`.
dotenv.config();

const port = process.env.PORT || 3000;
const baseURL = `http://localhost:${port}`;

/** @type {import('node:child_process').ChildProcess|null} */
let devServer = null;

/**
 * Whether we spawned the dev server ourselves (and thus must stop it).
 * If something is already listening on the port we reuse it, mirroring
 * Playwright's `webServer.reuseExistingServer` behavior.
 */
let ownsDevServer = false;

/**
 * Poll the dev server until it answers (or time out).
 */
async function waitForServer(url, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Dev server at ${url} did not start within ${timeoutMs}ms`);
}

export const config = {
  //
  // ====================
  // Runner Configuration
  // ====================
  //
  runner: 'local',

  /**
   * Directory containing test files. Vitest owns tests/unit/, so only
   * tests/e2e/ is matched here.
   */
  specs: ['./tests/e2e/**/*.spec.js'],

  /**
   * One browser instance at a time keeps the shared webpack dev server
   * and console noise predictable.
   */
  maxInstances: 1,

  /**
   * Capabilities: headless system Chrome covers both the web target and
   * (via the same engine family) the Electron renderer. ChromeDriver
   * is downloaded automatically to match the installed Chrome.
   */
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless=new', '--disable-gpu', '--window-size=1280,900'],
      },
      'wdio:chromedriverOptions': {
        binary: chromedriver.path,
      },
    },
  ],

  //
  // ==================
  // Services & Options
  // ==================
  //

  logLevel: 'warn',

  baseUrl: baseURL,

  /**
   * Default timeout for waitFor* commands and implicit waits.
   */
  waitforTimeout: 10000,

  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  //
  // ==================
  // Framework Settings
  // ==================
  //

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],

  /**
   * Start the webpack dev server before the browser sessions launch
   * and shut it down when everything is done (same behavior as
   * Playwright's `webServer` option).
   */
  async onPrepare() {
    // Reuse an already-running dev server instead of failing with
    // EADDRINUSE (set CI=1 to always require a fresh server).
    try {
      await fetch(baseURL, { signal: AbortSignal.timeout(2000) });
      console.log(`Reusing dev server already running at ${baseURL}`);
      return;
    } catch {
      // nothing listening — spawn one below
    }

    ownsDevServer = true;
    devServer = spawn('npm', ['start'], {
      detached: true,
      stdio: 'inherit',
    });
    await waitForServer(baseURL);
  },

  onComplete() {
    if (ownsDevServer && devServer && devServer.pid) {
      try {
        process.kill(-devServer.pid);
      } catch {
        // already gone
      }
    }
  },
};
