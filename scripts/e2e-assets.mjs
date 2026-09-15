// Loads a project folder (PNG, GIF, custom .fnt) through the folder picker and checks the assets render.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const shots = process.env.E2E_OUT ?? 'e2e-out';
mkdirSync(shots, { recursive: true });
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/e2e-assets.mjs <project folder with dmd/background.png, dmd/animation.gif, dmd/myfont.fnt>'); process.exit(1); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(process.env.E2E_URL ?? 'http://localhost:4173/');
await page.waitForFunction(() => window.studio && window.studio.runner.lastRunSource !== null, null, { timeout: 15000 });
const script = `FlexDMD.ProjectFolder = "./MyTable/"
FlexDMD.RenderMode = 2
Dim scene : Set scene = FlexDMD.NewGroup("Scene")
scene.SetSize 128, 32
Dim back : Set back = FlexDMD.NewImage("Back", "dmd/background.png")
back.SetBounds 0, 0, 64, 32
back.Scaling = 4
scene.AddActor back
Dim gif : Set gif = FlexDMD.NewVideo("Gif", "dmd/animation.gif")
gif.SetBounds 64, 0, 32, 16
scene.AddActor gif
Dim seq : Set seq = FlexDMD.NewVideo("Seq", "dmd/background.png|dmd/background.png&region=0,0,8,8")
seq.SetBounds 100, 0, 16, 16
scene.AddActor seq
Dim font : Set font = FlexDMD.NewFont("dmd/myfont.fnt", RGB(0,255,0), vbWhite, 0)
Dim lbl : Set lbl = FlexDMD.NewLabel("Lbl", font, "OK")
lbl.SetAlignedPosition 112, 24, 4
scene.AddActor lbl
FlexDMD.Stage.AddActor scene
`;
await page.evaluate((s) => window.studio.editor.setText(s), script);
await page.waitForTimeout(700);
console.log('before folder:', await page.textContent('#status'));
await page.setInputFiles('#file-folder', dir);
await page.waitForTimeout(1500);
console.log('after folder:', await page.textContent('#status'));
const info = await page.evaluate(() => {
  const f = window.studio.runner.flex;
  const scene = f.Stage.Get('Scene');
  const gif = scene.Get('Gif'), seq = scene.Get('Seq'), lbl = scene.Get('Lbl'), back = scene.Get('Back');
  const out = f.output();
  const px = (x, y) => { const i = (y * out.width + x) * 4; return [out.data[i], out.data[i+1], out.data[i+2]]; };
  return { children: scene.Children.map((c) => c.Name + ':' + c.typeName), gifLen: gif?.Length, gifPref: [gif?.PrefWidth, gif?.PrefHeight], seqLen: seq?.Length, lblSize: [lbl?.Width, lbl?.Height], backPref: [back?.PrefWidth, back?.PrefHeight], pxGif: px(70, 5), pxBack: px(10, 10), pxLbl: px(112, 24) };
});
console.log(JSON.stringify(info));
const log = await page.textContent('#tab-log');
console.log('log:', log.slice(0, 300));
await page.screenshot({ path: `${shots}/05-assets.png` });
await page.waitForTimeout(600);
const later = await page.evaluate(() => { const f = window.studio.runner.flex; const out = f.output(); const i = (5 * out.width + 70) * 4; return [out.data[i], out.data[i+1], out.data[i+2]]; });
console.log('gif pixel later:', JSON.stringify(later));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
