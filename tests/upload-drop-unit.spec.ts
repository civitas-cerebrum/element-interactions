import path from 'path';
import { test, expect } from './fixture/StepFixture';
import { Interactions } from '../src/interactions/Interaction';
import { WebElement } from '@civitas-cerebrum/element-repository';

// Unit tests for the two methods introduced in the upload/drop-files PR:
//   - Interactions.uploadFile(element, string | string[])
//   - Interactions.dropFiles(element, filenames[], options?)    ← requires element-repository companion PR #47
//   - Steps.uploadFile delegation (string and string[])
//   - Steps.dropFiles delegation                               ← requires element-repository companion PR #47
//
// Interactions.uploadFile tests use page.setContent() — no server required.
// Steps.uploadFile tests navigate to the GitHub Pages app directly.
// dropFiles tests are marked fixme until WebElement.dropFiles lands in a
// published element-repository release (companion PR #47).

const GITHUB_FILE_UPLOAD = 'https://civitas-cerebrum.github.io/vue-test-app/file-upload';

const FILE1 = path.resolve(__dirname, 'test-files/test-upload.txt');
const FILE2 = path.resolve(__dirname, 'fixture/StepFixture.ts');

// ── Helpers ────────────────────────────────────────────────────────────────

async function pageWithFileInput(page: any, multiple = false) {
    await page.setContent(`<input type="file" id="fi" ${multiple ? 'multiple' : ''} />`);
    return new WebElement(page.locator('#fi'));
}

async function pageWithDropZone(page: any) {
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
// Blocked on element-repository companion PR #47 (WebElement.dropFiles).
// Tests are written and ready; un-fixme when ^0.2.x ships with the method.

test.describe('Interactions.dropFiles', () => {

    test.fixme('dispatches drop event with correct filenames', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['report.pdf', 'photo.png']);

        const items = await page.locator('#log li').allTextContents();
        const names = items.map((t: string) => t.split('|')[0]);
        expect(names).toContain('report.pdf');
        expect(names).toContain('photo.png');
    });

    test.fixme('single filename — drop event carries exactly one file', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['document.txt']);

        const items = await page.locator('#log li').allTextContents();
        expect(items).toHaveLength(1);
        expect(items[0]).toContain('document.txt');
    });

    test.fixme('default mimeType is application/octet-stream', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['data.bin']);

        const items = await page.locator('#log li').allTextContents();
        expect(items[0]).toContain('application/octet-stream');
    });

    test.fixme('custom mimeType is forwarded to the DataTransfer', async ({ page }) => {
        const element = await pageWithDropZone(page);
        const interact = new Interactions(page);

        await interact.dropFiles(element, ['invoice.pdf'], { mimeType: 'application/pdf' });

        const items = await page.locator('#log li').allTextContents();
        expect(items[0]).toContain('application/pdf');
    });

});

// ── Steps.uploadFile ───────────────────────────────────────────────────────
// Navigate directly to GitHub Pages — bypasses the localhost baseURL in
// playwright.config so no local dev server is required.

test.describe('Steps.uploadFile', () => {

    test('single string — filename appears after upload', async ({ page, steps }) => {
        await page.goto(GITHUB_FILE_UPLOAD);

        await steps.uploadFile('singleFileInput', 'FileUploadPage', FILE1);

        await steps.verifyTextContains('singleFileName', 'FileUploadPage', 'test-upload.txt');
    });

    test('string[] — both filenames appear in the multi-file list', async ({ page, steps }) => {
        await page.goto(GITHUB_FILE_UPLOAD);

        await steps.uploadFile('multipleFileInput', 'FileUploadPage', [FILE1, FILE2]);

        await steps.verifyTextContains('multipleFileList', 'FileUploadPage', 'test-upload.txt');
        await steps.verifyTextContains('multipleFileList', 'FileUploadPage', 'StepFixture.ts');
    });

});

// ── Steps.dropFiles ────────────────────────────────────────────────────────
// Blocked on element-repository companion PR #47 (same reason as above).

test.describe('Steps.dropFiles', () => {

    test.fixme('filenames appear in the drop list', async ({ page, steps }) => {
        await page.goto(GITHUB_FILE_UPLOAD);

        await steps.dropFiles('dropZone', 'FileUploadPage', ['report.pdf', 'photo.png']);

        await steps.verifyTextContains('dropList', 'FileUploadPage', 'report.pdf');
        await steps.verifyTextContains('dropList', 'FileUploadPage', 'photo.png');
    });

    test.fixme('custom mimeType does not break the drop', async ({ page, steps }) => {
        await page.goto(GITHUB_FILE_UPLOAD);

        await steps.dropFiles('dropZone', 'FileUploadPage', ['data.bin'], { mimeType: 'application/octet-stream' });

        await steps.verifyTextContains('dropList', 'FileUploadPage', 'data.bin');
    });

});
