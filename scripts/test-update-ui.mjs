import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { LibraryStore } from '../dist-electron/electron/library.js';
import { translate } from '../dist-electron/src/shared/i18n.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
let electron;
try { ({ _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')); }
catch { throw new Error('SWALLOW_PLAYWRIGHT_MODULE에 설치된 playwright/index.mjs 경로를 지정하세요. 먼저 npm run build를 실행하세요.'); }
const data = await mkdtemp(join(tmpdir(), 'swallow-update-ui-'));
const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const errors = [];
const bootstrapRoot = await mkdtemp(join(tmpdir(), 'swallow-update-bootstrap-'));
const resources = join(bootstrapRoot, 'resources'); await mkdir(resources);
// Match the installed native/ and Windows pdf-runtime/ layout using local build resources.
await symlink(join(root, 'dist-electron/native'), join(resources, 'native'), process.platform === 'win32' ? 'junction' : 'dir');
if (process.platform === 'win32') await symlink(join(root, 'dist-electron/native/pdf-runtime'), join(resources, 'pdf-runtime'), 'junction');
await writeFile(join(bootstrapRoot, 'update-config.json'), JSON.stringify({ feeds: { [process.platform]: { [process.arch]: 'https://updates.example.com/test-only.json' } } }));
const bootstrap = join(bootstrapRoot, 'main.cjs');
// The actual main/preload/renderer/IPC run unchanged. Fake only native update
// network/installation and the exact Windows installer-presence probe.
await writeFile(bootstrap, `
const { app, autoUpdater } = require('electron');
Object.defineProperty(app, 'isPackaged', { value: true });
Object.defineProperty(process, 'resourcesPath', { value: ${JSON.stringify(resources)} });
app.getAppPath = () => ${JSON.stringify(bootstrapRoot)};
app.getVersion = () => '0.1.0';
if (process.platform === 'win32') {
  const fs = require('node:fs');
  const { dirname, resolve } = require('node:path');
  const installer = resolve(dirname(process.execPath), '..', 'Update.exe');
  const existsSync = fs.existsSync;
  fs.existsSync = path => path === installer ? process.env.SWALLOW_TEST_WINDOWS_INSTALLER === '1' : existsSync(path);
  require('node:module').syncBuiltinESMExports();
}
const harness = { native: autoUpdater, checks: 0, installs: 0 };
autoUpdater.setFeedURL = () => {};
autoUpdater.checkForUpdates = () => { harness.checks++; autoUpdater.emit('update-available'); };
autoUpdater.quitAndInstall = () => { harness.installs++; };
globalThis.__swallowUpdateTest = harness;
require(${JSON.stringify(join(root, 'dist-electron/electron/main.js'))});
`);
async function savedLibrary() {
  const store = new LibraryStore(join(data, 'library.json'));
  try { await store.load(); return store.exportLibrary(); } finally { store.close(); }
}
async function savedWorkspace(id) {
  const store = new LibraryStore(join(data, 'library.json'));
  try { await store.load(); return store.studyWorkspace(id); } finally { store.close(); }
}

async function withApp(synthetic, operation, { windowsInstaller = true } = {}) {
  const env = { ...process.env, SWALLOW_DATA_DIR: data, SWALLOW_TEST_WINDOWS_INSTALLER: windowsInstaller ? '1' : '0' }; delete env.SWALLOW_DEV_URL;
  const app = await electron.launch({ executablePath: electronPath, args: [synthetic ? bootstrap : '.'], cwd: root, env, timeout: 30_000 });
  let page;
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '내 학습', exact: true }).waitFor();
    await page.evaluate(async () => {
      globalThis.__updateState = await window.swallow.getUpdateState();
      window.swallow.onUpdateState(state => { globalThis.__updateState = state; });
      globalThis.__appState = await window.swallow.getState();
      window.swallow.onState(state => { globalThis.__appState = state; });
    });
    await operation(app, page);
  } catch (error) {
    await page?.screenshot({ path: join(artifacts, 'update-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    // Discard only this test instance's memory-only failure fixture; never close a user's app.
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
    await app.close();
  }
  assert.deepEqual(errors, []);
}
const panel = page => page.getByRole('dialog', { name: '앱 업데이트', exact: true });
async function openPanel(page) { await page.locator('.update-toggle').click(); await panel(page).waitFor(); }
async function settleVoiceLookup(page) {
  // Optional voice discovery is a tracked IPC operation. Wait for completion or
  // failure before testing installation; this test does not require OS voices.
  await page.evaluate(async () => { await Promise.allSettled([window.swallow.getSpeechVoices()]); });
}
async function ready(app, page) {
  await settleVoiceLookup(page);
  await openPanel(page); await panel(page).getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await panel(page).getByRole('progressbar', { name: '업데이트 다운로드 중' }).waitFor();
  await app.evaluate(() => globalThis.__swallowUpdateTest.native.emit('update-downloaded', {}, '<script>변경 내용을 일반 텍스트로 표시합니다.</script>', '0.2.0'));
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).waitFor();
}
await withApp(false, async (_app, page) => {
  await openPanel(page);
  await panel(page).getByText('현재 버전 · 0.1.0', { exact: true }).waitFor();
  assert.equal(await panel(page).getByRole('button', { name: '업데이트 확인', exact: true }).isDisabled(), true);
  await panel(page).getByText('개발 실행에서는 업데이트를 사용할 수 없습니다.', { exact: false }).waitFor();
  await page.screenshot({ path: join(artifacts, 'update-development.png'), fullPage: true });
});
if (process.platform === 'win32') await withApp(true, async (app, page) => {
  await openPanel(page);
  assert.equal((await page.evaluate(() => window.swallow.getUpdateState())).status, 'unavailable');
  await panel(page).getByText('이 설치 방식에서는 앱 내 업데이트를 지원하지 않습니다.', { exact: true }).waitFor();
  assert.equal(await panel(page).getByRole('button', { name: '업데이트 확인', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.swallow.checkForUpdates().then(() => false, () => true)), true);
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.checks), 0);
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 0);
  await page.screenshot({ path: join(artifacts, 'update-windows-zip.png'), fullPage: true });
}, { windowsInstaller: false });
let id;
const answer = '업데이트 전에 학습 답변을 저장합니다.';
await withApp(true, async (app, page) => {
  await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill(answer);
  id = (await page.evaluate(() => window.swallow.getState())).library.activeDocumentId;
  assert.equal((await page.evaluate(id => window.swallow.getStudyWorkspace(id), id)).session.answer, '');
  await ready(app, page);
  assert.equal(await panel(page).locator('script').count(), 0);
  await panel(page).getByText('<script>변경 내용을 일반 텍스트로 표시합니다.</script>', { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, 'update-ready.png'), fullPage: true });
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = () => new Promise(resolve => { globalThis.__finishImport = resolve; }); });
  await page.evaluate(() => { globalThis.__importWork = window.swallow.importDocument(); });
  const busyError = await page.evaluate(() => window.swallow.installUpdate().then(() => '', error => error.message));
  assert.match(busyError, /작업/, '실제 main IPC가 진행 중 파일 가져오기 동안 설치를 막습니다.');
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 0);
  await app.evaluate(() => globalThis.__finishImport({ canceled: true, filePaths: [] }));
  await page.evaluate(() => globalThis.__importWork);
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => globalThis.__updateState.status === 'installing');
  assert.equal((await savedWorkspace(id)).session.answer, answer);
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 1, JSON.stringify({ state: await page.evaluate(() => window.swallow.getUpdateState()), error: await panel(page).getByRole('alert').allTextContents() }));
  assert.match(await page.evaluate(() => window.swallow.study({ type: 'select-model', model: 'test' }).then(() => '', error => error.message)), /업데이트를 적용/, '설치 중 새 작업을 차단합니다.');
  await panel(page).getByText('앱을 재시작하고 업데이트를 적용합니다.', { exact: true }).waitFor();
});
await withApp(true, async (app, page) => {
  await page.getByRole('button', { name: '이어하기', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill('저장 실패 시 화면에 남아야 하는 답변');
  await ready(app, page);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('swallow:study-session');
    ipcMain.handle('swallow:study-session', () => ({ ok: false, error: { code: 'errors.storage' } }));
  });
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await panel(page).getByRole('alert').filter({ hasText: translate('ko', 'errors.storage') }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 0);
  assert.equal((await page.evaluate(id => window.swallow.getStudyWorkspace(id), id)).session.answer, answer);
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '내 답변', exact: true }).inputValue(), '저장 실패 시 화면에 남아야 하는 답변');
});
await withApp(true, async (app, page) => {
  await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
  await settleVoiceLookup(page);
  const legacyAnswer = '자유 읽기 답안도 재시작 전에 저장합니다.';
  await page.getByRole('textbox', { name: '회상 답안', exact: true }).fill(legacyAnswer);
  await openPanel(page);
  await panel(page).getByRole('button', { name: '업데이트 확인', exact: true }).click();
  await app.evaluate(() => globalThis.__swallowUpdateTest.native.emit('error', new Error('private detail')));
  await panel(page).getByRole('button', { name: '다시 시도', exact: true }).click();
  await app.evaluate(() => globalThis.__swallowUpdateTest.native.emit('update-downloaded', {}, '', '0.2.0'));
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => globalThis.__updateState.status === 'installing');
  const library = await savedLibrary(); const doc = library.documents.find(value => value.id === library.activeDocumentId);
  assert.equal(doc.recalls[doc.units[doc.position].id].answer, legacyAnswer);
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 1);
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.checks), 2);
});
await withApp(true, async (app, page) => {
  await page.getByRole('button', { name: '이어하기', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.__restoreStudyStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key === 'swallow.study-drafts.v1') throw new Error('test quota'); original.call(this, key, value); };
  });
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill('메모리에만 남은 공부 답변');
  await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
  await ready(app, page);
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.update-dialog [role="alert"]') || globalThis.__updateState.status === 'installing');
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 0, '공부 화면을 벗어나도 메모리 초안 오류가 있으면 설치하지 않습니다.');
  await panel(page).getByRole('alert').filter({ hasText: '임시' }).waitFor();
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '같이 공부하기', exact: true }).click();
  await page.getByRole('button', { name: '이어하기', exact: true }).click();
  await page.evaluate(() => globalThis.__restoreStudyStorage());
  await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
  await page.getByRole('heading', { name: '이번 부분을 요점노트로 남겨요.', exact: true }).waitFor();
  await openPanel(page);
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.update-dialog [role="alert"]') || globalThis.__updateState.status === 'installing');
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 1, '저장소 복구 후 답변 저장에 성공하면 설치 차단을 해제합니다.');
});
await withApp(true, async (app, page) => {
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, join(root, 'tests/fixtures/pdf/diagram.pdf'));
  await page.getByRole('button', { name: '파일 가져오기', exact: false }).click();
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '자유 읽기', exact: true }).click();
  await page.locator('.pdf-note > summary').click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem; globalThis.__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('swallow.pdf-note.')) throw new Error('test quota'); original.call(this, key, value); };
  });
  await page.getByRole('textbox', { name: 'PDF 1쪽 그림 메모', exact: true }).fill('재시작 전에 보호해야 하는 PDF 메모');
  await ready(app, page);
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.update-dialog [role="alert"]') || globalThis.__updateState.status === 'installing');
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 0, 'PDF 메모 저장소 오류를 무시하고 설치하지 않습니다.');
  await panel(page).getByRole('button', { name: '닫기', exact: true }).click();
  await page.evaluate(() => globalThis.__restoreStorage());
  await page.getByRole('button', { name: '메모 저장', exact: true }).click();
  await page.waitForFunction(() => globalThis.__appState.library.documents.find(doc => doc.id === globalThis.__appState.library.activeDocumentId)?.pdf?.pages[0]?.note === '재시작 전에 보호해야 하는 PDF 메모');
  await page.getByRole('textbox', { name: 'PDF 1쪽 그림 메모', exact: true }).fill('업데이트 버튼이 자동으로 저장한 PDF 메모');
  await openPanel(page);
  await panel(page).getByRole('button', { name: '재시작하고 업데이트', exact: true }).click();
  await page.waitForFunction(() => globalThis.__updateState.status === 'installing');
  assert.equal(await app.evaluate(() => globalThis.__swallowUpdateTest.installs), 1);
  const library = await savedLibrary();
  assert.equal(library.documents.find(doc => doc.id === library.activeDocumentId).pdf.pages[0].note, '업데이트 버튼이 자동으로 저장한 PDF 메모');
});
console.log('업데이트 UI 통과: 개발 실행 안내, 다운로드 상태, 변경 내용 텍스트, 실패 재시도, 공부/자유 읽기 답변 저장 후 설치 요청, 저장 실패·화면 전환 후 메모리 초안·PDF 메모 오류 시 설치 차단.');
if (process.platform === 'win32') console.log('Windows ZIP 업데이트 미지원·네이티브 호출 차단 및 합성 설치형 업데이트의 저장 보호를 각각 검증했습니다.');
console.log('합성 네이티브 이벤트 사용. 실제 다운로드·앱 교체·AI 요청·Google 인증 없음. Renderer pageerrors: 0');
console.log('임시 데이터: ' + data);
