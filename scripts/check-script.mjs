#!/usr/bin/env node
// Headless checker for FlexDMD scene scripts.
// Runs a .vbs through FlexDMD Studio's engine in headless Chromium, reports syntax/runtime errors and the actor
// tree, optionally calls a Sub, and saves screenshots at given times.
//
//   node scripts/check-script.mjs scene.vbs [--call "Name(args)"]... [--sub Name] [--args "1, \"x\""] [--shots 0.5,2] [--out dir]
//                                            [--each-frame "Tick()"]  (run this Sub before every frame, as a table's DMD timer does)
//                                            [--strict]               (report unknown names as errors instead of standing in for them)
//                                            [--url http://host/]   (skip the built-in preview server)
//                                            [--json result.json]   (machine readable result)
//
// Requires: npm install (playwright) and a build (npm run build); a Chromium for Playwright
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
// --call "DMD_Init" --call "DMD_Jackpot(1500000)" : Subs invoked in order after the script ran (before --sub)
const calls = args.map((a, i) => (a === '--call' ? args[i + 1] : null)).filter(Boolean).map((c) => { const m = c.match(/^\s*(\w+)\s*(?:\((.*)\))?\s*$/); return m ? { name: m[1], args: m[2] ?? '' } : null; }).filter(Boolean);
const shots = (opt('--shots', '1') || '').split(',').map(Number).filter((n) => !Number.isNaN(n));
const out = resolve(opt('--out', 'check-out'));
mkdirSync(out, { recursive: true });
const jsonPath = opt('--json');
const result = { file, error: null, subError: null, logs: [], stubbed: [], skipped: [], snapshots: [] };

let url = opt('--url');
let server = null;
if (!url) {
  if (!existsSync(resolve(studioDir, 'dist/index.html'))) {
    console.error('No build found: run "npm run build" first (or pass --url of a running studio).');
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
    const visit = (a, depth, path, ox, oy, shown) => {
      const p = path ? `${path}/${a.Name}` : a.Name;
      const ax = ox + a.X, ay = oy + a.Y, vis = shown && !!a.Visible;
      items.push({ depth, path: p, name: a.Name, type: a.typeName, x: Math.round(a.X * 100) / 100, y: Math.round(a.Y * 100) / 100, ax: Math.round(ax * 100) / 100, ay: Math.round(ay * 100) / 100, w: Math.round(a.Width), h: Math.round(a.Height), visible: !!a.Visible, shown: vis, actions: a.actions.map((x) => x.describe()) });
      if (a.Children) for (const c of a.Children) visit(c, depth + 1, p, ax, ay, vis);
    };
    visit(window.studio.runner.flex.Stage, 0, '', 0, 0, true);
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
  // Pause the clock and switch off auto-run so nothing re-runs the script behind our back, then run it once
  await page.evaluate(([perFrame, strict]) => {
    window.studio.runner.playing = false;
    const auto = document.querySelector('#chk-autorun');
    if (auto && auto.checked) auto.click();
    window.studio.runner.entryPoints = { onRun: '', perFrame };
    window.studio.runner.ghosts.enabled = !strict;
  }, [opt('--each-frame', '') ?? '', args.includes('--strict')]);
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
  result.stubbed = await page.evaluate(() => window.studio.runner.ghosts.list().map((g) => g.path));
  result.skipped = await page.evaluate(() => window.studio.runner.skipped);
  if (result.stubbed.length) console.log(`stood in for ${result.stubbed.length} unknown name(s): ${result.stubbed.slice(0, 8).join(', ')}${result.stubbed.length > 8 ? ' …' : ''}`);
  for (const sk of result.skipped) console.log(`  skipped line ${sk.line}: ${sk.message}`);
  for (const c of calls) {
    if (err || result.subError) break;
    const e3 = await page.evaluate(([name, a]) => window.studio.runner.callParsed(a ? `${name}(${a})` : name), [c.name, c.args]);
    if (e3) { result.subError = e3; console.error(`SUB ERROR in ${c.name}${e3.line ? ` (line ${e3.line})` : ''}: ${e3.message}`); failed = true; }
    else console.log(`Called ${c.name}(${c.args}) without errors.`);
  }
  if (sub && !err && !result.subError) {
    const e2 = await page.evaluate(([name, a]) => window.studio.runner.callParsed(a ? `${name}(${a})` : name), [sub, subArgs]);
    result.subError = e2;
    if (e2) { console.error(`SUB ERROR in ${sub}${e2.line ? ` (line ${e2.line})` : ''}: ${e2.message}`); failed = true; }
    else console.log(`Called ${sub}(${subArgs}) without errors.`);
  }
  // Step the simulated clock and take screenshots
  let t = 0;
  for (const target of shots.sort((a, b) => a - b)) {
    const frames = Math.max(0, Math.round((target - t) * 60));
    await page.evaluate((n) => {
      const r = window.studio.runner;
      for (let i = 0; i < n; i++) { r.stepOnce(); }
      r.dirty = true;
    }, frames);
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
