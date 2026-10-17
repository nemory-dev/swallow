import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// No imports from the checkout, dist-electron, or the project's Electron package.
const [appArgument, fixtureArgument, absentSourceArgument] = process.argv.slice(2);
if (process.platform !== 'darwin' || !appArgument || !fixtureArgument) {
  throw new Error('사용법: node scripts/test-packaged-macos-ui.mjs /absolute/Swallow.app /absolute/pdf-fixtures [실행 중 없어야 할 소스 폴더]');
}
assert.ok(isAbsolute(appArgument) && isAbsolute(fixtureArgument), '앱·fixture는 절대 경로로 지정하세요.');
const appPath = await realpath(resolve(appArgument));
const executablePath = join(appPath, 'Contents/MacOS/Swallow');
await access(executablePath, constants.X_OK);
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
let electron;
try { ({ _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')); }
catch { throw new Error('SWALLOW_PLAYWRIGHT_MODULE에 별도 설치한 playwright/index.mjs 절대 경로를 지정하세요.'); }
const directory = await realpath(await mkdtemp(join(tmpdir(), 'swallow-packaged-ui-')));
const data = join(directory, 'user-data');
const cwd = join(directory, 'unrelated-cwd');
const emptyPath = join(directory, 'empty-path');
const screenshots = join(directory, 'screenshots');
for (const path of [data, cwd, emptyPath, screenshots]) await mkdir(path);
for (const name of ['diagram.pdf', 'scan.pdf']) await copyFile(join(fixtureArgument, name), join(directory, name));
const errors = [];
const answer = '작은 부분을 읽고, 내 말로 답하고, 요점노트로 남깁니다.';
let sampleId, pdfId, scanId, runtime;

async function assertSourceAbsent() {
  if (!absentSourceArgument) return;
  assert.ok(isAbsolute(absentSourceArgument));
  try { await access(absentSourceArgument); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('소스 폴더가 남아 있어 소스 없는 실행을 검증할 수 없습니다.');
}

async function usingApp(operation) {
  await assertSourceAbsent();
  const env = { ...process.env, PATH: emptyPath, SWALLOW_DATA_DIR: data,
    // A packaged app must ignore even an invalid development URL.
    SWALLOW_DEV_URL: 'https://packaged-must-ignore.invalid' };
  for (const name of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH']) delete env[name];
  const app = await electron.launch({ executablePath, args: [], cwd, env, timeout: 30000 });
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    runtime = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath,
      executablePath: process.execPath, cwd: process.cwd(), path: process.env.PATH,
      userData: app.getPath('userData'), arch: process.arch, version: app.getVersion(),
    }));
    assert.equal(runtime.packaged, true);
    assert.equal(runtime.arch, 'arm64');
    assert.equal(runtime.executablePath, executablePath);
    assert.equal(runtime.appPath, join(appPath, 'Contents/Resources/app.asar'));
    assert.equal(runtime.resourcesPath, join(appPath, 'Contents/Resources'));
    assert.equal(runtime.cwd, cwd);
    assert.equal(runtime.path, emptyPath);
    assert.equal(runtime.userData, data);
    await access(join(runtime.resourcesPath, 'native/swallow-pdf'), constants.X_OK);
    await page.waitForFunction(() => !!window.swallow);
    await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
    assert.match(page.url(), /^swallow:\/\/app\//);
    await operation({ app, page });
    assert.deepEqual(errors, [], 'renderer pageerror');
  } catch (error) {
    if (page) await page.screenshot({ path: join(screenshots, 'failure.png') }).catch(() => {});
    console.error('패키지 검증 임시 저장소: ' + directory);
    throw error;
  } finally { await app.close(); }
  await assertSourceAbsent();
}

async function waitForPdfImage(page) {
  await page.locator('.pdf-page-preview img').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.pdf-page-preview img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }, undefined, { timeout: 30000 });
}

await usingApp(async ({ page }) => {
  await page.getByRole('heading', { name: '막막하면, 한 부분부터 같이 시작해요.', exact: true }).waitFor();
  await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.locator('.study-original > summary').click();
  assert.ok((await page.locator('.study-source').innerText()).trim());
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill(answer);
  await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
  await page.getByRole('button', { name: '요점노트 저장', exact: true }).click();
  await page.getByRole('heading', { name: '한 부분을 공부하고 노트로 남겼어요.', exact: true }).waitFor();
  const state = await page.evaluate(() => window.swallow.getState());
  sampleId = state.library.activeDocumentId;
  const workspace = await page.evaluate(id => window.swallow.getStudyWorkspace(id), sampleId);
  assert.equal(workspace.notes.length, 1);
  assert.equal(workspace.notes[0].userAnswer, answer);
  assert.equal(workspace.notes[0].summaryOrigin, 'source');
  await page.screenshot({ path: join(screenshots, 'first-study.png'), fullPage: true });
});

await usingApp(async ({ app, page }) => {
  const workspace = await page.evaluate(id => window.swallow.getStudyWorkspace(id), sampleId);
  assert.equal(workspace.notes[0].userAnswer, answer);
  for (const name of ['diagram.pdf', 'scan.pdf']) {
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(directory, name));
    await page.getByRole('button', { name: /^파일 가져오기/ }).click();
    await page.getByRole('heading', { name: name.replace('.pdf', ''), exact: true }).waitFor();
    // The reading view stays open when importing the second PDF in this launch.
    if (name === 'diagram.pdf') await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
    await waitForPdfImage(page);
    const state = await page.evaluate(() => window.swallow.getState());
    const doc = state.library.documents.find(item => item.id === state.library.activeDocumentId);
    if (name === 'diagram.pdf') {
      pdfId = doc.id;
      assert.match(await page.locator('.source-text').innerText(), /Water moves from reservoir A/);
      await page.locator('.pdf-note summary').click();
      await page.getByRole('textbox', { name: 'PDF 1쪽 그림 메모' }).fill('패키지에서 저장한 A → B');
      await page.getByRole('button', { name: '메모 저장', exact: true }).click();
    } else {
      scanId = doc.id;
      assert.equal(doc.pdf.pages[0].method, 'ocr');
      assert.match(doc.source, /Heat turns water into vapor/);
      assert.match(doc.source, /수증기/);
    }
    await page.screenshot({ path: join(screenshots, name.replace('.pdf', '.png')), fullPage: true });
  }
});

await usingApp(async ({ page }) => {
  const state = await page.evaluate(() => window.swallow.getState());
  assert.equal(state.library.documents.find(item => item.id === scanId).pdf.pages[0].method, 'ocr');
  assert.equal(state.documents.length, 3);
  // The bridge deliberately loads only the active document; select the other PDF through the UI.
  await page.locator('.document-item').filter({ hasText: /^diagram/ }).click();
  await page.getByRole('heading', { name: 'diagram', exact: true }).waitFor();
  const selected = await page.evaluate(() => window.swallow.getState());
  const doc = selected.library.documents.find(item => item.id === pdfId);
  assert.equal(doc.pdf.pages[0].note, '패키지에서 저장한 A → B');
  const workspace = await page.evaluate(id => window.swallow.getStudyWorkspace(id), sampleId);
  assert.equal(workspace.notes[0].userAnswer, answer);
  await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
  await waitForPdfImage(page);
  await page.screenshot({ path: join(screenshots, 'reopened.png'), fullPage: true });
});
await access(join(data, 'library.sqlite'));
const result = { status: 'passed', directory, runtime, sourceAbsent: absentSourceArgument ?? null,
  checks: ['static packaged startup', 'empty PATH without Node/Swift', 'first study', 'answer/note SQLite persistence', 'three launches', 'PDF import/render/note', 'Korean/English OCR', 'PDF persistence'], rendererErrors: errors };
await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
