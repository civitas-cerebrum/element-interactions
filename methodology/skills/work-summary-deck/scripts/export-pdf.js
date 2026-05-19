#!/usr/bin/env node
// Export a Civitas Cerebrum work-summary deck (HTML) to PDF using the project's
// existing `@playwright/test` peer dep — no extra dependency, no user prompt.
//
// Usage:  node export-pdf.js <html-path> [pdf-path]
// Output: prints the resolved PDF path to stdout.

const path = require('path');
const fs = require('fs');

async function main() {
  const htmlArg = process.argv[2];
  if (!htmlArg) {
    console.error('Usage: node export-pdf.js <html-path> [pdf-path]');
    process.exit(2);
  }

  const htmlPath = path.resolve(htmlArg);
  if (!fs.existsSync(htmlPath)) {
    console.error(`HTML file not found: ${htmlPath}`);
    process.exit(2);
  }

  const pdfPath = path.resolve(process.argv[3] || htmlPath.replace(/\.html?$/i, '.pdf'));

  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    console.error('Cannot load `@playwright/test`. Install it first: npm i -D @playwright/test');
    process.exit(2);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: pdfPath,
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await browser.close();
  }

  console.log(pdfPath);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
