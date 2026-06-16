import path from 'path';
import { test, expect } from './fixture/StepFixture';
import { Page } from '@playwright/test';
import { Interactions } from '../src/interactions/Interaction';
import { WebElement } from '@civitas-cerebrum/element-repository';

// Unit tests for the two methods introduced in the upload/drop-files PR:
//   - Interactions.uploadFile(element, string | string[])
//   - Interactions.dropFiles(element, filenames[], options?)
//   - Steps.uploadFile delegation (string and string[])
//   - Steps.dropFiles delegation
//
// Interactions.uploadFile/dropFiles tests use page.setContent() — no server required.
// Steps.* tests navigate to the local vue-test-site's /file-upload page
// (served by docker-compose at the configured baseURL).

const FILE_UPLOAD_PATH = '/file-upload';

const FILE1 = path.resolve(__dirname, 'test-files/test-upload.txt');
const FILE2 = path.resolve(__dirname, 'fixture/StepFixture.ts');

// ── Helpers ────────────────────────────────────────────────────────────────

async function pageWithFileInput(page: Page, multiple = false) {
    await page.setContent(`<input type="file" id="fi" ${multiple ? 'multiple' : ''} />`);
    return new WebElement(page.locator('#fi'));
}

async function pageWithDropZone(page: Page) {
    await page.setContent(`
        <div id="dz" style="width:200px;height:200px">Drop here</div>
        <ul id="log"></ul>
        <script>
            const dz = document.getElementById('dz');
            const log = document.getElementById('log');
            ['dragenter','dragover','drop'].forEach(evt => {
                dz.addEventListener(evt, e => {
                    e.preventDefault();
                    if (evt === 'drop') {
                        Array.from(e.dataTransfer.files).forEach(f => {
                            const li = document.createElement('li');
                            li.textContent = f.name + '|' + f.type;
                            log.appendChild(li);
                        });
                    }
                });
            });
        </script>
    `);
    return new WebElement(page.locator('#dz'));
}

// ── Interactions.uploadFile ────────────────────────────────────────────────

test.describe('Interactions.uploadFile', () => {

    test('single string — attaches one file', async ({ page }) => {
        const element = await pageWithFileInput(page);
        const interact = new Interactions(page);

        await interact.uploadFile(element, FILE1);

        const count = await page.evaluate(() =>
            (document.querySelector('#fi') as HTMLInputElement).files!.length
        );
        expect(count).toBe(1);
    });

    test('string[] — attaches multiple files to a multi-file input', async ({ page }) => {
        const element = await pageWithFileInput(page, true);
        const interact = new Interactions(page);

        await interact.uploadFile(element, [FILE1, FILE2]);

        const count = await page.evaluate(() =>
            (document.querySelector('#fi') as HTMLInputElement).files!.length
        );
        expect(count).toBe(2);
    });

    test('string[] with one item — attaches exactly one file', async ({ page }) => {
        const element = await pageWithFileInput(page, true);
        const interact = new Interactions(page);

        await interact.uploadFile(element, [FILE1]);

        const count = await page.evaluate(() =>
            (document.querySelector('#fi') as HTMLInputElement).files!.length
        );
        expect(count).toBe(1);
    });

    test('single string — filename is correct', async ({ page }) => {
        const element = await pageWithFileInput(page);
        const interact = new Interactions(page);

        await interact.uploadFile(element, FILE1);

        const name = await page.evaluate(() =>
            (document.querySelector('#fi') as HTMLInputElement).files![0].name
        );
        expect(name).toBe('test-upload.txt');
    });

    test('string[] — both filenames are correct', async ({ page }) => {
        const element = await pageWithFileInput(page, true);
        const interact = new Interactions(page);

        await interact.uploadFile(element, [FILE1, FILE2]);

        const names = await page.evaluate(() =>
            Array.from((document.querySelector('#fi') as HTMLInputElement).files!).map(f => f.name)
        );
        expect(names).toContain('test-upload.txt');
        expect(names).toContain('StepFixture.ts');
    });

});

// ── Interactions.dropFiles ─────────────────────────────────────────────────
// Backed by WebElement.dropFiles (element-repository >= 0.3.0).

test.describe('Interactions.dropFiles', () => {

    test('dispatches drop event with correct filenames', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['report.pdf', 'photo.png']);

        const items = await page.locator('#log li').allTextContents();
        const names = items.map((t: string) => t.split('|')[0]);
        expect(names).toContain('report.pdf');
        expect(names).toContain('photo.png');
    });

    test('single filename — drop event carries exactly one file', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['document.txt']);

        const items = await page.locator('#log li').allTextContents();
        expect(items).toHaveLength(1);
        expect(items[0]).toContain('document.txt');
    });

    test('default mimeType is application/octet-stream', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['data.bin']);

        const items = await page.locator('#log li').allTextContents();
        expect(items[0]).toContain('application/octet-stream');
    });

    test('custom mimeType is forwarded to the DataTransfer', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['invoice.pdf'], { mimeType: 'application/pdf' });

        const items = await page.locator('#log li').allTextContents();
        expect(items[0]).toContain('application/pdf');
    });

    test('empty filenames[] — no-op drop event does not throw', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, []);

        const items = await page.locator('#log li').allTextContents();
        expect(items).toHaveLength(0);
    });

});

// ── Steps.uploadFile ───────────────────────────────────────────────────────
// Navigate to the local vue-test-site /file-upload page (resolved against baseURL).

test.describe('Steps.uploadFile', () => {

    test('single string — filename appears after upload', async ({ page, steps }) => {
        await page.goto(FILE_UPLOAD_PATH);

        await steps.uploadFile('singleFileInput', 'FileUploadPage', FILE1);

        await steps.verifyTextContains('singleFileName', 'FileUploadPage', 'test-upload.txt');
    });

    test('string[] — both filenames appear in the multi-file list', async ({ page, steps }) => {
        await page.goto(FILE_UPLOAD_PATH);

        await steps.uploadFile('multipleFileInput', 'FileUploadPage', [FILE1, FILE2]);

        await steps.verifyTextContains('multipleFileList', 'FileUploadPage', 'test-upload.txt');
        await steps.verifyTextContains('multipleFileList', 'FileUploadPage', 'StepFixture.ts');
    });

});

// ── Steps.dropFiles ────────────────────────────────────────────────────────

test.describe('Steps.dropFiles', () => {

    test('filenames appear in the drop list', async ({ page, steps }) => {
        await page.goto(FILE_UPLOAD_PATH);

        await steps.dropFiles('dropZone', 'FileUploadPage', ['report.pdf', 'photo.png']);

        await steps.verifyTextContains('dropList', 'FileUploadPage', 'report.pdf');
        await steps.verifyTextContains('dropList', 'FileUploadPage', 'photo.png');
    });

    test('custom mimeType does not break the drop', async ({ page, steps }) => {
        await page.goto(FILE_UPLOAD_PATH);

        await steps.dropFiles('dropZone', 'FileUploadPage', ['data.bin'], { mimeType: 'application/octet-stream' });

        await steps.verifyTextContains('dropList', 'FileUploadPage', 'data.bin');
    });

});
