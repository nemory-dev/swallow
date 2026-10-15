// Uses an isolated data directory. Never logs in or sends AI requests.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const { _electron: electron } = await import(process.env.SWALLOW_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SWALLOW_PLAYWRIGHT_MODULE).href : 'playwright');
const data = await mkdtemp(join(tmpdir(), 'swallow-folders-ui-'));
const artifacts = join(projectRoot, 'artifacts', 'learning-folders-ui'); await mkdir(artifacts, { recursive: true });
const errors = []; let app, page;
async function launch() {
  const env = { ...process.env, SWALLOW_DATA_DIR: data }; delete env.SWALLOW_DEV_URL;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: projectRoot, env, timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '내 학습', exact: true }).waitFor();
  await page.evaluate(async () => { globalThis.__folderState = await window.swallow.getState(); window.swallow.onState(state => { globalThis.__folderState = state; }); });
}
const state = () => page.evaluate(() => window.swallow.getState());
async function createFolder(name) {
  await page.getByRole('button', { name: '새 학습 폴더', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await page.getByRole('dialog', { name: '새 학습 폴더', exact: true }).waitFor({ state: 'hidden' });
}
try {
  await launch(); await createFolder('AI Agent');
  const folderId = (await state()).folders[0].id;
  await page.getByRole('button', { name: '＋ 문서 추가', exact: true }).click();
  let dialog = page.locator('.document-dialog');
  await dialog.getByLabel(/^제목/).fill('폴더 자료');
  await dialog.getByLabel('원문', { exact: true }).fill('공통 원문에서 AI Agent를 학습합니다. '.repeat(60));
  await dialog.getByRole('button', { name: /추가|저장|시작/ }).last().click();
  await dialog.waitFor({ state: 'hidden' });
  let snapshot = await state(); const id = snapshot.library.activeDocumentId;
  assert.equal(snapshot.documents.find(doc => doc.id === id).folderId, folderId);
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).waitFor();
  let before = await page.evaluate(id => window.swallow.getStudyWorkspace(id), id);
  await page.getByRole('button', { name: '미분류', exact: true }).click();
  assert.equal(await page.locator('.document-list .document-item').count(), 0);
  assert.deepEqual(await page.evaluate(id => window.swallow.getStudyWorkspace(id), id), before);
  await page.locator('.term-lookup > summary').click();
  await page.getByLabel('모르는 용어', { exact: true }).fill('공통');
  await page.getByRole('button', { name: '내 자료에서 찾기', exact: true }).click();
  await page.getByText('일치하는 자료와 요점노트가 없습니다.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill('폴더를 바꿔도 유지할 임시 답변');
  await page.getByRole('button', { name: '전체 자료', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '내 답변', exact: true }).inputValue(), '폴더를 바꿔도 유지할 임시 답변');
  await page.getByRole('button', { name: '답변 저장', exact: true }).click();
  await page.getByText(/자 · 저장된 답변/).waitFor();
  before = await page.evaluate(id => window.swallow.getStudyWorkspace(id), id);
  await page.getByRole('button', { name: 'AI Agent 폴더 관리', exact: true }).click();
  await page.getByRole('button', { name: '이름 변경', exact: true }).click();
  await page.getByLabel('폴더 이름', { exact: true }).fill('LangGraph');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: 'LangGraph', exact: true }).waitFor();
  await page.getByRole('button', { name: '폴더 목록 접기', exact: true }).click();
  await page.getByRole('button', { name: 'LangGraph', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '폴더 목록 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '자료 메뉴: 폴더 자료', exact: true }).click();
  await page.getByLabel('폴더 자료 폴더로 이동', { exact: true }).selectOption('');
  await page.waitForFunction(id => globalThis.__folderState.documents.find(doc => doc.id === id).folderId === null, id);
  await page.getByLabel('폴더 자료 폴더로 이동', { exact: true }).selectOption(folderId);
  await page.getByRole('button', { name: 'LangGraph', exact: true }).click();
  await page.getByRole('button', { name: /원문 검색·보관/ }).click();
  await page.getByLabel('원문 검색어', { exact: true }).fill('공통');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await page.locator('.search-results li').first().waitFor();
  assert.match(await page.locator('.library-tools').innerText(), /LangGraph/);
  await page.locator('.library-tools').getByRole('button', { name: '닫기', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'desktop.png'), fullPage: true });
  await app.close(); app = null; await launch(); dialog = page.locator('.document-dialog');
  snapshot = await state(); assert.equal(snapshot.documents.find(doc => doc.id === id).folderId, folderId);
  assert.equal(snapshot.folders[0].name, 'LangGraph');
  assert.deepEqual(await page.evaluate(id => window.swallow.getStudyWorkspace(id), id), before);
  await page.getByRole('button', { name: 'LangGraph', exact: true }).click();
  await page.getByRole('button', { name: 'LangGraph 폴더 관리', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '폴더 삭제', exact: true }).click();
  await page.waitForFunction(() => globalThis.__folderState.folders.length === 0);
  snapshot = await state(); assert.equal(snapshot.documents.find(doc => doc.id === id).folderId, null);
  assert.deepEqual(await page.evaluate(id => window.swallow.getStudyWorkspace(id), id), before);
  await createFolder('가져오기'); const importFolderId = (await state()).folders[0].id;
  const textPath = join(data, 'import.md'); await writeFile(textPath, '# 가져온 자료\n\n공통 학습 원문입니다.');
  for (const path of [textPath, join(projectRoot, 'tests/fixtures/pdf/diagram.pdf')]) {
    const count = (await state()).documents.length;
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, path);
    await page.getByRole('button', { name: /^파일 가져오기/ }).click();
    await page.waitForFunction(count => globalThis.__folderState.documents.length === count + 1, count, { timeout: 30000 });
    snapshot = await state(); assert.equal(snapshot.documents.find(doc => doc.id === snapshot.library.activeDocumentId).folderId, importFolderId);
  }
  assert.ok((await state()).library.documents[0].pdf);
  // Main schedules reviews; only renderer time advances to make both due.
  await page.evaluate(async () => {
    Date.now = () => Date.parse('2030-01-01T00:00:00Z');
    const state = await window.swallow.getState(), doc = state.library.documents[0];
    await window.swallow.study({ type: 'save-recall', documentId: doc.id, unitId: doc.units[0].id, answer: '폴더 복습' });
    await window.swallow.study({ type: 'rate-recall', documentId: doc.id, unitId: doc.units[0].id, rating: 'good' });
    await window.swallow.addDocument({ title: '미분류 복습', source: '별도 복습 원문', goal: '' });
    const next = (await window.swallow.getState()).library.documents[0];
    await window.swallow.study({ type: 'save-recall', documentId: next.id, unitId: next.units[0].id, answer: '미분류 복습' });
    await window.swallow.study({ type: 'rate-recall', documentId: next.id, unitId: next.units[0].id, rating: 'good' });
  });
  await page.locator('.review-button strong').filter({ hasText: /^1$/ }).waitFor();
  await page.getByRole('button', { name: '전체 자료', exact: true }).click();
  await page.locator('.review-button strong').filter({ hasText: /^2$/ }).waitFor();
  await page.getByRole('button', { name: '미분류', exact: true }).click();
  await page.locator('.review-button strong').filter({ hasText: /^1$/ }).waitFor();
  await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await page.locator('.review-button strong').filter({ hasText: /^1$/ }).waitFor();
  // A deleted target must reject a pending add, retaining the user's input.
  await page.getByRole('button', { name: '＋ 문서 추가', exact: true }).click();
  await dialog.getByLabel(/^제목/).fill('저장하면 안 되는 자료'); await dialog.getByLabel('원문', { exact: true }).fill('작성 중인 입력을 보존합니다.');
  const count = (await state()).documents.length;
  await page.evaluate(id => window.swallow.deleteFolder(id), importFolderId);
  await dialog.getByRole('button', { name: '추가하고 공부하기', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '폴더' }).waitFor();
  assert.equal((await state()).documents.length, count); assert.equal(await dialog.locator('textarea.source-input').inputValue(), '작성 중인 입력을 보존합니다.');
  await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'en', responseLanguage: 'ko' }));
  await dialog.getByRole('alert').filter({ hasText: 'choose another folder' }).waitFor();
  assert.equal(await dialog.locator('textarea.source-input').inputValue(), '작성 중인 입력을 보존합니다.');
  await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
  await dialog.getByRole('button', { name: '문서 추가 닫기', exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ verified: true, data, documentId: id, folderCrud: true, move: true, restart: true, workspacePreserved: true, scopedSearch: true, scopedReviews: true, textAndPdfImport: true, staleTargetRejected: true }, null, 2));
  console.log('학습 폴더 UI 검증 통과 · 임시 저장소: ' + data);
} catch (error) {
  await page?.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
} finally { await app?.close(); }
