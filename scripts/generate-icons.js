/**
 * Icon generation
 *
 * Single source of truth: assets/logo.png
 *
 * Whenever the app is packaged (electron:build), every platform icon is
 * regenerated from assets/logo.png:
 *
 *   - assets/icons/icon.icns      macOS app icon
 *   - assets/icons/icon.ico       Windows app icon
 *   - assets/icons/icon.png       Linux source icon (electron-builder
 *                                 resizes this into the required size set)
 *
 * electron-builder is configured to consume the assets/icons directory
 * (see the "build" block in package.json).
 *
 * Usage: node scripts/generate-icons.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..');
const logoPath = path.join(root, 'assets', 'logo.png');
const outDir = path.join(root, 'assets', 'icons');

if (!fs.existsSync(logoPath)) {
  console.error(`generate-icons: missing source logo at ${logoPath}`);
  process.exit(1);
}

const input = fs.readFileSync(logoPath);

fs.mkdirSync(outDir, { recursive: true });

const written = [];

/** Write a file into assets/icons and record it for logging. */
function emit(name, data) {
  if (!data) return;
  fs.writeFileSync(path.join(outDir, name), data);
  written.push(name);
}

// macOS + Windows container formats (all sizes embedded in one file).
emit('icon.icns', png2icons.createICNS(input, png2icons.BICUBIC, 0));
emit('icon.ico', png2icons.createICO(input, png2icons.BICUBIC, 0, false));

// Linux: electron-builder takes a single large PNG and resizes it into
// the per-size set (16x16 ... 512x512) at package time.
emit('icon.png', input);

if (written.length === 0) {
  console.error('generate-icons: no icons were produced');
  process.exit(1);
}

console.log(`generate-icons: wrote ${written.length} icon(s) to assets/icons from assets/logo.png`);
