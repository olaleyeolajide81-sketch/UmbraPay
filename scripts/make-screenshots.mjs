/**
 * Render captured terminal output into terminal-style SVG images.
 *
 *   node scripts/make-screenshots.mjs
 *
 * Reads screenshots/*.txt (real command output, captured by
 * scripts/capture-screenshots.sh) and writes a matching .svg next to it.
 *
 * WHY GENERATED IMAGES
 * ----------------------------------------------------------------------------
 * These are terminal captures rendered as SVG, not photographs of a screen.
 * They are produced from the actual output of the commands in the README, so
 * they cannot drift from reality: re-run the capture script after any change
 * and the images regenerate.
 *
 * SVG is used because GitHub renders it inline from a Markdown image link,
 * unlike a .txt file, and because it stays crisp at any zoom.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'screenshots');

// ── layout constants ─────────────────────────────────────────────────────────

const FONT_SIZE = 13.5;
const CHAR_WIDTH = FONT_SIZE * 0.601; // JetBrains Mono / Menlo advance ratio
const LINE_HEIGHT = FONT_SIZE * 1.55;
const PAD_X = 18;
const PAD_TOP = 14; // below the title bar
const TITLEBAR_H = 34;
const PAD_BOTTOM = 18;
const MAX_COLS = 100; // wrap anything wider so images stay readable

const BG = '#0d1117';
const TITLEBAR_BG = '#161b22';
const BORDER = '#30363d';
const FG = '#c9d1d9';
const DIM = '#8b949e';
const GREEN = '#3fb950';
const CYAN = '#79c0ff';
const YELLOW = '#d29922';
const MAGENTA = '#d2a8ff';

/** Escape the five XML entities so raw terminal text cannot break the SVG. */
const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Per-line colouring so prompts and results read like a real terminal. */
function colourFor(line) {
  if (/^[$>]\s/.test(line)) return GREEN; // command prompt
  if (/^#/.test(line)) return DIM; // comment
  if (/✓|✅|pass/i.test(line)) return GREEN;
  if (/✗|❌|Error|error:|fail/i.test(line)) return '#f85149';
  if (/contract address|CONTRACT ADDRESS/i.test(line)) return MAGENTA;
  if (/^\s*[│┌└├╔╚]/.test(line)) return CYAN;
  if (/^\s*\d+×|Compiling|Test Files|Tests\s/i.test(line)) return YELLOW;
  return FG;
}

/** Hard-wrap to MAX_COLS without breaking mid-token where avoidable. */
function wrap(line) {
  if (line.length <= MAX_COLS) return [line];
  const out = [];
  let rest = line;
  while (rest.length > MAX_COLS) {
    let cut = rest.lastIndexOf(' ', MAX_COLS);
    if (cut <= 0) cut = MAX_COLS;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

function render(title, body) {
  const rawLines = body.replace(/\t/g, '  ').split('\n');
  // Drop trailing blank lines so the image does not end with dead space.
  while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();

  const lines = rawLines.flatMap(wrap);
  const cols = Math.max(title.length + 8, ...lines.map((l) => l.length), 40);

  const width = Math.round(PAD_X * 2 + cols * CHAR_WIDTH);
  const height = Math.round(TITLEBAR_H + PAD_TOP + lines.length * LINE_HEIGHT + PAD_BOTTOM);

  const text = lines
    .map((line, i) => {
      const y = Math.round(TITLEBAR_H + PAD_TOP + i * LINE_HEIGHT + FONT_SIZE);
      return `    <text x="${PAD_X}" y="${y}" fill="${colourFor(line)}">${esc(line) || ' '}</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'JetBrains Mono','SF Mono',Menlo,Consolas,monospace" font-size="${FONT_SIZE}">
  <defs>
    <clipPath id="round"><rect x="0" y="0" width="${width}" height="${height}" rx="10"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="${width}" height="${height}" fill="${BG}"/>
    <rect width="${width}" height="${TITLEBAR_H}" fill="${TITLEBAR_BG}"/>
    <line x1="0" y1="${TITLEBAR_H}" x2="${width}" y2="${TITLEBAR_H}" stroke="${BORDER}"/>
    <circle cx="19" cy="17" r="6" fill="#ff5f56"/>
    <circle cx="39" cy="17" r="6" fill="#ffbd2e"/>
    <circle cx="59" cy="17" r="6" fill="#27c93f"/>
    <text x="${Math.round(width / 2)}" y="21" fill="${DIM}" text-anchor="middle" font-size="12">${esc(title)}</text>
${text}
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="${BORDER}"/>
</svg>
`;
}

// ── run ──────────────────────────────────────────────────────────────────────

const TITLES = {
  '01-compact-compile': 'compact compile contracts/counter.compact managed/counter',
  '02-managed-artifacts': 'managed/counter — generated circuits, keys and ZKIR',
  '03-test-run': 'npm test — 16 passing',
  '04-deploy-preview': 'npm run deploy -- --network preview',
  '05-deploy-preprod': 'npm run deploy -- --network preprod',
  '06-interact-preview': 'npm run interact -- --network preview',
  '06-interact-preprod': 'npm run interact -- --network preprod',
};

const files = fs
  .readdirSync(OUT_DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort();

if (files.length === 0) {
  console.error(`No .txt captures found in ${OUT_DIR}. Run scripts/capture-screenshots.sh first.`);
  process.exit(1);
}

for (const file of files) {
  const base = file.replace(/\.txt$/, '');
  const body = fs.readFileSync(path.join(OUT_DIR, file), 'utf-8');
  const title = TITLES[base] ?? base;
  const svg = render(title, body);
  fs.writeFileSync(path.join(OUT_DIR, `${base}.svg`), svg);
  console.log(`  ✓ screenshots/${base}.svg`);
}

console.log(`\n  ${files.length} image(s) written to screenshots/\n`);
