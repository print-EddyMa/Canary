const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 4 / 3 });
  await p.goto('file://' + process.cwd() + '/endcard.html');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1000);
  await p.screenshot({ path: 'endcard.png' });
  await b.close();
})();
