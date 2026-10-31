/**
 * Prints de conferência do MÍSSIL SM39 (Exocet): cápsula subindo, saída da água, separação, acelerador, cruzeiro,
 * impacto na fragata classe Tamandaré e depois (câmera "Míssil cinematográfica" na Visualização 3D), e a tela Armas.
 *
 * Uso: npm run dev (ou npx vite preview --port 4173) em outro terminal
 *      node scripts/prints/missil.mjs [url] [saida]
 * Saída: build/prints/missil/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? join('build', 'prints', 'missil');
const VIEW = process.env.VISTA ?? 'missilCine';
// CENARIO=exocet_terra ALVO="Alvo em terra" para o ataque ao alvo em terra; SUBIDA=vertical para a cápsula quase vertical
const SCEN = process.env.CENARIO ?? 'ataque_exocet';
const ALVO = process.env.ALVO ?? 'Fragata';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 940 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('ERRO NA PÁGINA', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 200)));
await page.addInitScript((view) => {
  if (sessionStorage.getItem('sx1.print.init')) return;
  sessionStorage.setItem('sx1.print.init', '1');
  localStorage.clear();
  localStorage.setItem('sx1.prefs.v2', JSON.stringify({ screen: 'armas', eng: false }));
  localStorage.setItem('sx1.quality.v1', 'alta');
  localStorage.setItem('sx1.ui.armas.vista', JSON.stringify(view));
  localStorage.setItem('sx1.ui.v3d.view', JSON.stringify(view));
  localStorage.setItem('sx1.ui.armas.modo', JSON.stringify('auto'));
}, VIEW);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
for (const t of ['Entendi', 'Descartar']) {
  const b = page.getByRole('button', { name: t, exact: true });
  if (await b.count()) await b.first().click();
}
await page.selectOption('select[aria-label="Cenário"]', SCEN);
await page.getByRole('button', { name: 'Carregar', exact: true }).click();
await page.waitForTimeout(2500);
const btn = (name) => page.getByRole('button', { name, exact: true });
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log('print', name);
};
const simT = async () => {
  const s = (await page.locator('body').innerText()).match(/(\d\d):(\d\d):(\d\d)/);
  return s ? +s[1] * 3600 + +s[2] * 60 + +s[3] : 0;
};
const tableText = async () => ((await page.locator('.weapons-screen table').allTextContents()) ?? []).join(' ');

await page.screenshot({ path: join(OUT, '00_inicio.png') });
log('tubos', (await page.locator('button.wx-tube').allTextContents()).join(' | '));
await page.locator('button.wx-tube', { hasText: 'Tubo 5' }).click();
await page.waitForTimeout(600);
log('painéis', (await page.locator('.wx-fire').allTextContents()).map((x) => x.slice(0, 80)).join(' | '));
await page.locator('.wx-fire .wx-target', { hasText: ALVO }).first().click();
if (process.env.SUBIDA === 'vertical') await page.locator('.wx-fire .seg button', { hasText: 'Quase vertical' }).click();
await page.locator('.wx-fire .wx-warhead button', { hasText: 'Combate' }).click();
await shot('01_armas_sm39');
await btn('🛠️Preparar')
  .click()
  .catch(async () => page.locator('.wx-auto button', { hasText: 'Preparar' }).first().click());
await page.getByRole('button', { name: /Executar/ }).click();
await btn('×20').click();
for (let i = 0; i < 120; i++) {
  if (/PRONTO PARA DISPARO/.test(await page.locator('.wx-launch').innerText())) break;
  await page.waitForTimeout(500);
}
await btn('×1').click();
await page.waitForTimeout(500);
await shot('02_tubo_pronto');
await page.locator('.wx-auto button', { hasText: 'FOGO' }).first().click();
const t0 = await simT();
log('FOGO em', t0);
// tela grande de visualização 3D
await page.locator('button', { hasText: 'Apresentação' }).first().click();
await page.locator('button', { hasText: 'Visualização 3D' }).first().click();
await page.waitForTimeout(1200);
const at = async (dt, name) => {
  while ((await simT()) < t0 + dt) await page.waitForTimeout(150);
  await shot(name);
};
await at(3, '03_capsula_subindo');
await at(6, '04_rompe_superficie');
await at(7, '05_separacao');
await at(8, '06_acelerador');
await at(11, '07_acelerador_2');
await at(16, '08_cruzeiro_perseguicao');
await at(20, '09a_cruzeiro');
await at(22, '09_cruzeiro_passagem');
await at(24, '09b_cruzeiro_passagem');
await at(30, '10_cruzeiro_lateral');
await btn('×5').click();
await at(75, '11_cruzeiro');
await btn('×1').click();
// fase terminal e impacto
for (let i = 0; i < 400; i++) {
  const body = await page.locator('body').innerText();
  if (/IMPACTO|TERMINAL/.test(body)) break;
  await page.waitForTimeout(200);
}
const tT = await simT();
await shot('12_terminal');
await at(tT - t0 + 4, '13_aproximacao');
for (let i = 0; i < 200; i++) {
  if (/IMPACTO/.test(await page.locator('body').innerText())) break;
  await page.waitForTimeout(100);
}
await page.waitForTimeout(250);
await shot('14_impacto');
await page.waitForTimeout(1500);
await shot('15_impacto_2');
await btn('×5').click();
await page.waitForTimeout(6000);
await shot('16_fragata_em_chamas');
await btn('×1').click();
// tela Armas e mapa tático
await page.locator('button', { hasText: 'Operação' }).first().click();
await page.locator('button', { hasText: 'Armas' }).first().click();
await page.waitForTimeout(1500);
await shot('17_tela_armas');
await page.locator('.weapons-3d').scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await shot('18_tela_armas_3d');
await page.locator('button', { hasText: 'Mapa tático' }).first().click();
await page.waitForTimeout(2500);
await shot('19_mapa_tatico');
log('mísseis', await tableText());
await browser.close();
