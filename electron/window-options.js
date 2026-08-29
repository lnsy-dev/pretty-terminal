/**
 * BrowserWindow Options
 *
 * Shared window configuration for the Electron main process.
 *
 * A hidden title bar makes the menu/title bar area transparent on macOS
 * so the app content extends up to the window chrome. The renderer adds
 * top padding to keep text clear of the traffic-light buttons.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('electron').BrowserWindowConstructorOptions} */
export const WINDOW_OPTIONS = {
  width: 1024,
  height: 768,
  icon: path.resolve(__dirname, '..', 'assets', 'logo.png'),
  titleBarStyle: 'hidden',
  // Match the dark-mode theme background so any area not covered by the
  // terminal component (e.g. the bottom padding gap) blends in instead of
  // showing the default black window background.
  backgroundColor: '#1b1c25',
  webPreferences: {
    // Secure defaults: the renderer is plain web code, no Node access.
    contextIsolation: true,
    nodeIntegration: false,
    // The preload bridge needs to load as a CommonJS script so it can
    // require Electron's IPC modules and forward them to the renderer.
    sandbox: false,
    preload: path.resolve(__dirname, 'preload.cjs'),
  },
};
