import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const shots = process.env.E2E_OUT ?? 'e2e-out';
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(process.env.E2E_URL ?? 'http://localhost:4173/');
await page.waitForFunction(() => window.studio && window.studio.runner.lastRunSource !== null, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(800);
console.log('status:', await page.textContent('#status'));
console.log('info:', await page.textContent('#preview-info'));
await page.screenshot({ path: `${shots}/01-default.png` });
// Frame pixel check: count non-black pixels in the preview canvas
const stats = await page.evaluate(() => {
  const f = window.studio.runner.flex;
  const out = f.output();
  let lit = 0; for (let i = 0; i < out.data.length; i += 4) if (out.data[i] + out.data[i+1] + out.data[i+2] > 30) lit++;
  return { w: out.width, h: out.height, lit, actors: f.Stage.ChildCount };
});
console.log('frame stats:', JSON.stringify(stats));
// Select the score label by clicking its center in the preview and drag it 10px right, 3px down (dmd units)
const scale = await page.evaluate(() => window.studio.preview.scale);
const box = await page.locator('#preview').boundingBox();
const actorBox = await page.evaluate(() => { const a = window.studio.inspector; const s = window.studio.runner.flex.Stage.Get('Score').Get('Score'); return s.absoluteBounds(); });
console.log('score label bounds:', JSON.stringify(actorBox), 'scale', scale);
const cx = box.x + (actorBox.x + actorBox.w / 2) * scale, cy = box.y + (actorBox.y + actorBox.h / 2) * scale;
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx + 10 * scale, cy + 3 * scale, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(600);
const text = await page.evaluate(() => window.studio.editor.text);
const line = text.split('\n').find((l) => l.includes('score.SetAlignedPosition'));
console.log('after drag:', line);
console.log('status:', await page.textContent('#status'));
await page.screenshot({ path: `${shots}/02-dragged.png` });
// Resize the frame via its SE handle
const frameBox = await page.evaluate(() => window.studio.runner.flex.Stage.Get('Score').Get('Border').absoluteBounds());
const hx = box.x + (frameBox.x + frameBox.w) * scale, hy = box.y + (frameBox.y + frameBox.h) * scale;
await page.mouse.click(box.x + (frameBox.x + 1) * scale + 1, box.y + (frameBox.y + 1) * scale + 1); // click the border to select the frame
await page.waitForTimeout(100);
console.log('selected:', await page.evaluate(() => window.studio.preview.selected?.Name));
await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx - 6 * scale, hy - 4 * scale, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(600);
console.log('after resize:', (await page.evaluate(() => window.studio.editor.text)).split('\n').find((l) => l.includes('frame.SetBounds')));
// Call a Sub
await page.click('#tabs nav button[data-tab=subs]');
await page.fill('#tab-subs .sub-row:nth-child(2) input', '2500000');
await page.click('#tab-subs .sub-row:nth-child(2) button');
await page.waitForTimeout(300);
console.log('after jackpot:', await page.textContent('#status'), '| stage children:', await page.evaluate(() => window.studio.runner.flex.Stage.Children.map((c) => c.Name).join(',')));
await page.screenshot({ path: `${shots}/03-jackpot.png` });
// Load sample 1 and 3 and screenshot
for (const idx of [0, 2]) {
  await page.selectOption('#sel-sample', String(idx));
  await page.waitForTimeout(1500);
  console.log(`sample ${idx}:`, await page.textContent('#status'), '|', await page.textContent('#preview-info'));
  await page.screenshot({ path: `${shots}/04-sample${idx}.png` });
}
// Syntax error reporting
await page.evaluate(() => window.studio.editor.setText('Dim x\nx = (1 + \nFlexDMD.Stage.AddActor 5'));
await page.waitForTimeout(800);
console.log('error status:', await page.textContent('#status'));
console.log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
