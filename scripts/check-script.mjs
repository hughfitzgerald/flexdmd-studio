#!/usr/bin/env node
// Headless checker for FlexDMD scene scripts.
// Runs a .vbs through FlexDMD Studio's engine in headless Chromium, reports syntax/runtime errors and the actor
// tree, optionally calls a Sub, and saves screenshots at given times.
//
//   node scripts/check-script.mjs scene.vbs [--sub Name] [--args "1, \"x\""] [--shots 0.5,2] [--out dir]
//                                            [--url http://host/]   (skip the built-in preview server)
//                                            [--json result.json]   (machine readable result)
//
// Requires: npm install (playwright) and a build (npm run build) in FlexDMDStudio; a Chromium for Playwright
// (or CHROMIUM_PATH pointing at one). Exit code 1 when the script fails.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const studioDir = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const file = args.find((a) => !a.startsWith('--') && !args.includes('--' + a) && (args.indexOf(a) === 0 || !args[args.indexOf(a) - 1].startsWith('--')));
if (!file) { console.error('usage: check-script.mjs scene.vbs [--sub Name] [--args "..."] [--shots 0.5,2] [--out dir] [--url url]'); process.exit(2); }
const source = readFileSync(file, 'utf8');
const sub = opt('--sub');
const subArgs = opt('--args', '');
const shots = (opt('--shots', '1') || '').split(',').map(Number).filter((n) => !Number.isNaN(n));
const out = resolve(opt('--out', 'check-out'));
mkdirSync(out, { recursive: true });
const jsonPath = opt('--json');
const result = { file, error: null, subError: null, logs: [], snapshots: [] };

let url = opt('--url');
let server = null;
if (!url) {
  if (!existsSync(resolve(studioDir, 'dist/index.html'))) {
    console.error('No build found: run "npm run build" in FlexDMDStudio first (or pass --url of a running studio).');
    process.exit(2);
  }
  const port = 4200 + Math.floor(Math.random() * 500);
  server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: studioDir, stdio: 'ignore' });
  url = `http://localhost:${port}/`;
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url); if (r.ok) break; } catch { /* not up yet */ }
    if (Date.now() - t0 > 20000) { console.error('Preview server did not start'); server.kill(); process.exit(2); }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function readTree(page) {
  return page.evaluate(() => {
    const items = [];
    const visit = (a, depth, path) => {
      const p = path ? `${path}/${a.Name}` : a.Name;
      items.push({ depth, path: p, name: a.Name, type: a.typeName, x: Math.round(a.X * 100) / 100, y: Math.round(a.Y * 100) / 100, w: Math.round(a.Width), h: Math.round(a.Height), visible: !!a.Visible, actions: a.actions.map((x) => x.describe()) });
      if (a.Children) for (const c of a.Children) visit(c, depth + 1, p);
    };
    visit(window.studio.runner.flex.Stage, 0, '');
    return items;
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('pageerror', (e) => { console.error('page error:', e.message); failed = true; });
  await page.goto(url);
  await page.waitForFunction(() => window.studio && window.studio.runner.lastRunSource !== null, null, { timeout: 20000 });
  // Load the script, pause the clock so screenshots are deterministic, and run it
  await page.evaluate(() => { window.studio.runner.playing = false; });
  const err = await page.evaluate(async (src) => {
    window.studio.editor.setText(src);
    return await window.studio.runner.run(src);
  }, source);
  result.error = err;
  if (err) {
    console.error(`SCRIPT ERROR${err.line ? ` (line ${err.line})` : ''}: ${err.message}`);
    failed = true;
  } else {
    console.log('Script ran without errors.');
  }
  const logs = await page.evaluate(() => Array.from(document.querySelectorAll('#tab-log .log-line')).map((e) => e.textContent));
  result.logs = logs;
  for (const l of logs) console.log('  log:', l);
  if (sub && !err) {
    const e2 = await page.evaluate(([name, a]) => window.studio.runner.callSub(name, a), [sub, subArgs]);
    result.subError = e2;
    if (e2) { console.error(`SUB ERROR in ${sub}${e2.line ? ` (line ${e2.line})` : ''}: ${e2.message}`); failed = true; }
    else console.log(`Called ${sub}(${subArgs}) without errors.`);
  }
  // Step the simulated clock and take screenshots
  let t = 0;
  for (const target of shots.sort((a, b) => a - b)) {
    const frames = Math.max(0, Math.round((target - t) * 60));
    await page.evaluate((n) => { for (let i = 0; i < n; i++) window.studio.runner.flex.step(1 / 60); window.studio.runner.dirty = true; }, frames);
    t = target;
    await page.waitForTimeout(50);
    const path = resolve(out, `t${target.toFixed(2)}s.png`);
    await page.locator('#preview').screenshot({ path });
    console.log(`screenshot at t=${target}s -> ${path}`);
    result.snapshots.push({ t: target, screenshot: path, tree: await readTree(page) });
  }
  if (result.snapshots.length === 0) result.snapshots.push({ t, screenshot: null, tree: await readTree(page) });
  const last = result.snapshots[result.snapshots.length - 1];
  console.log('Actor tree at t=' + last.t + 's:\n' + last.tree.map((a) => `${'  '.repeat(a.depth)}${a.name || '(unnamed)'} [${a.type}] ${a.x},${a.y} ${a.w}x${a.h}${a.visible ? '' : ' hidden'}${a.actions.length ? ` actions: ${a.actions.join('; ')}` : ''}`).join('\n'));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  if (server) server.kill();
}
process.exit(failed ? 1 : 0);
