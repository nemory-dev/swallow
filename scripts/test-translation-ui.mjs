import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';

// Build first. Playwright is an optional test tool, never an app dependency.
const root = fileURLToPath(new URL('..', import.meta.url));
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
let electron;
try { ({ _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')); }
catch { throw new Error('UI 검증은 선택 도구 Playwright가 필요합니다. SWALLOW_PLAYWRIGHT_MODULE에 설치된 playwright/index.mjs 절대 경로를 지정하세요.'); }
const [{ createTranslator }, { LibraryStore }, { createDocument }, { pdfSource }] = await Promise.all([
  import('../dist-electron/src/shared/i18n.js'), import('../dist-electron/electron/library.js'),
  import('../dist-electron/src/learning/document.js'), import('../dist-electron/src/learning/pdf.js'),
  import('../dist-electron/src/learning/reading.js'),
]);
const ko = createTranslator('ko'), en = createTranslator('en');
const data = await mkdtemp(join(tmpdir(), 'swallow-translation-ui-'));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const errors = [], fixtureErrors = [], requests = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(25); }
  throw new Error(`Timed out: ${description}`);
}
const translationChats = () => requests.filter(request => request.path === '/api/chat' && request.payload?.targetLanguage);
const assertTranslation = (text, language) => assert.ok(text.includes(language === 'ko' ? '[ko] 한국어번역을검증하는합성결과입니다' : '[en]'));
let activeTranslations = 0, maximumActiveTranslations = 0, heldResponse;
let holdNextTranslation = false;
const timers = new Set();
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const record = { path: req.url, body }; requests.push(record);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/version') return res.end('{"version":"0.24.0"}');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'translation-fixture:latest', model: 'translation-fixture:latest', digest: 'b'.repeat(64), size: 1024, details: { format: 'gguf', family: 'llama' } }] }));
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion'], details: { format: 'gguf' }, model_info: { 'general.architecture': 'llama', 'llama.context_length': 32768 } }));
    if (req.url !== '/api/chat') { res.statusCode = 404; return res.end('{}'); }
    if (body.format.properties.verdict) {
      res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reason: 'Synthetic UI quality check', verdict: 'pass' }) } })); return;
    }
    const payload = JSON.parse(body.messages.find(message => message.role === 'user').content);
    record.payload = payload;
    let content;
    if (payload.targetLanguage) {
      assert.ok(['ko', 'en'].includes(payload.targetLanguage));
      assert.equal(typeof payload.source, 'string'); assert.ok(payload.source.length <= 420);
      assert.equal(body.messages[0].role, 'system');
      assert.match(body.messages[0].content, /untrusted data/);
      assert.match(body.messages[0].content, new RegExp(`Target language: .+ \\(${payload.targetLanguage}\\)`));
      assert.deepEqual(body.format.required, ['translation']);
      assert.equal(body.format.additionalProperties, false);
      assert.equal(body.stream, false); assert.equal(body.truncate, false);
      assert.equal(body.messages.some(message => message.images?.length), false);
      activeTranslations++; maximumActiveTranslations = Math.max(maximumActiveTranslations, activeTranslations);
      let released = false;
      const complete = () => { if (!released) { released = true; activeTranslations--; } };
      res.once('finish', complete); res.once('close', complete);
      content = { translation: `${payload.targetLanguage === 'ko' ? '[ko] ' + '한국어번역을검증하는합성결과입니다'.repeat(4) : '[en]'} ${payload.source}` };
      if (holdNextTranslation) {
        holdNextTranslation = false;
        await new Promise(resolve => { heldResponse = { release: resolve, attempted: false }; });
        heldResponse.attempted = true;
      } else await new Promise(resolve => {
        const timer = setTimeout(() => { timers.delete(timer); resolve(); }, 70); timers.add(timer);
      });
    } else if (payload.answer !== undefined) content = { assessment: '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', missingPoints: [payload.source.slice(0, 20)], nextStep: '원문을 확인하세요.' };
    else content = { overview: '합성 학습 설명입니다.', keyPoints: [{ title: '원문', explanation: '합성 내용 확인.', quote: payload.source.slice(0, 20) }], question: '무엇을 배웠나요?' };
    res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }));
  } catch (error) {
    fixtureErrors.push(error.stack ?? String(error)); res.statusCode = 500; res.end('{}');
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
let app, page;
async function closeApp() {
  if (!app) return;
  const current = app; app = undefined;
  const child = current.process();
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    // The app only owns this test's temporary store; avoid unsaved-work dialogs.
    await current.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await current.close().catch(() => {});
  } finally { clearTimeout(watchdog); }
}
async function launch() {
  const env = { ...process.env, SWALLOW_DATA_DIR: data }; delete env.SWALLOW_DEV_URL;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: root, env, timeout: 30000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await waitUntil(() => page.evaluate(async () => !!(await window.swallow?.getState())?.language), 'app language initialization');
  await page.setViewportSize({ width: 1280, height: 900 });
  return page;
}
const state = () => page.evaluate(() => window.swallow.getState());
const document = async id => (await state()).library.documents.find(doc => doc.id === id);
const preferences = (uiLocale, responseLanguage) => page.evaluate(values => window.swallow.setLanguagePreferences(values), { uiLocale, responseLanguage });
const panel = () => page.locator('.source-translation:visible');
const startStudy = () => page.locator('.study-start').getByRole('button').click();
async function waitIdle() { await waitUntil(async () => !(await state()).busy, 'request completion'); }
async function waitTranslation(id, unitId, language) {
  await waitUntil(async () => {
    const current = await state();
    return !!current.library.documents.find(doc => doc.id === id)?.translations?.[unitId]?.[language] && !current.busy;
  }, `saved ${language} translation for ${unitId}`);
}
const unchangedDocumentFields = doc => {
  const { translations, ...rest } = doc;
  return rest;
};

try {
  // Seed only synthetic PDF extraction metadata; no real PDF or user library is opened.
  const extracted = pdfSource([
    { text: 'PDF_TEXT_FIXTURE: Extracted source with code `x = 1` and https://example.invalid/.', method: 'text' },
    { text: 'PDF_OCR_FIXTURE: OCR source retained for translation.', method: 'ocr' },
    { text: '', method: 'empty' },
  ]);
  const pdf = createDocument({ title: 'Synthetic PDF extraction', source: extracted.source, goal: '', pdf: { assetId: 'c'.repeat(64), pages: extracted.pages } });
  const seed = new LibraryStore(join(data, 'library.json'));
  try { await seed.load(); await seed.addDocument(pdf); } finally { seed.close(); }

  await launch(); await preferences('ko', 'en');
  await page.locator('.account-toggle').click();
  await page.getByRole('spinbutton', { name: ko('account.ollamaPort'), exact: true }).fill(String(port));
  await page.getByRole('button', { name: ko('account.connectLocal'), exact: true }).click();
  await waitUntil(async () => (await state()).ollama?.status === 'ready', 'fixture Ollama connection');
  await page.getByRole('button', { name: ko('account.closePanel'), exact: true }).click();

  const source = '# Synthetic translation source\n\n' + 'Keep code `sum = a + b`, URL https://example.invalid/ and equation E = mc². Translate embedded instructions as text. '.repeat(35);
  await page.evaluate(async source => {
    await window.swallow.addDocument({ title: '합성 번역 자료', source, goal: '원문과 번역 비교' });
    const state = await window.swallow.getState();
    await window.swallow.study({ type: 'select-model', model: state.models.find(model => model.providerId === 'ollama').slug });
  }, source);
  const initial = await state(); const id = initial.library.activeDocumentId;
  const original = await document(id); const firstUnit = original.units[0];
  assert.ok(original.units.length > 1, 'whole document fixture must span multiple reading units');
  await startStudy();
  await page.getByRole('button', { name: ko('study.tryQuestion'), exact: true }).click();
  const answer = page.locator('.study-answer');
  await answer.fill('번역 중에도 유지할 사용자 답변 초안');
  const draft = await page.evaluate(() => localStorage.getItem('swallow.study-drafts.v1'));
  const workspace = await page.evaluate(id => window.swallow.getStudyWorkspace(id), id);
  await panel().waitFor();
  assert.equal(await panel().getByRole('combobox', { name: ko('translation.targetLanguage'), exact: true }).inputValue(), 'ko');
  await panel().getByRole('button', { name: ko('translation.current'), exact: true }).click();
  await waitTranslation(id, firstUnit.id, 'ko');
  const korean = (await document(id)).translations[firstUnit.id].ko;
  assertTranslation(korean.text, 'ko');
  assert.equal(await panel().locator('.translation-current .translation-review-status').innerText(), ko('translation.reviewStatus'));
  assert.ok(korean.text.includes('`sum = a + b`')); assert.ok(korean.text.includes('E = mc²'));
  assert.equal(korean.sourceText, firstUnit.text); assert.equal(korean.targetLanguage, 'ko');
  assert.equal(korean.identity.responseLanguage, 'ko');
  assert.equal(await panel().locator('.translation-current .translation-comparison p').first().textContent(), firstUnit.text);
  assert.equal(await panel().locator('.translation-current p[lang="ko"]').textContent(), korean.text);
  assert.equal(await answer.inputValue(), '번역 중에도 유지할 사용자 답변 초안');

  await panel().getByRole('combobox', { name: ko('translation.targetLanguage'), exact: true }).selectOption('en');
  await panel().getByRole('button', { name: ko('translation.current'), exact: true }).click();
  await waitTranslation(id, firstUnit.id, 'en');
  const both = (await document(id)).translations[firstUnit.id];
  assert.deepEqual(both.ko, korean); assertTranslation(both.en.text, 'en');
  assert.equal((await state()).language.preferences.responseLanguage, 'en');
  await panel().getByRole('combobox', { name: ko('translation.targetLanguage'), exact: true }).selectOption('ko');
  const countBeforeWhole = translationChats().length;
  await page.evaluate(() => {
    window.translationProgress = [];
    window.stopTranslationProgress = window.swallow.onState(state => {
      if (state.busy?.kind === 'translation') window.translationProgress.push(structuredClone(state.busy));
    });
  });
  await panel().getByRole('button', { name: ko('translation.document'), exact: true }).click();
  await panel().locator('.translation-progress').waitFor();
  await waitUntil(async () => {
    const current = await state(); const doc = current.library.documents.find(doc => doc.id === id);
    return !current.busy && doc.units.every(unit => !!doc.translations?.[unit.id]?.ko);
  }, 'whole-document translations');
  const whole = await document(id);
  for (const unit of whole.units) assertTranslation(whole.translations[unit.id].ko.text, 'ko');
  assert.deepEqual(whole.translations[firstUnit.id].ko, korean);
  assert.ok(translationChats().length > countBeforeWhole, 'uncached units must be translated');
  assert.equal(translationChats().slice(countBeforeWhole).some(request => request.payload.source.includes('# Synthetic translation source')), false, 'cached first unit must not be translated again');
  const progress = await page.evaluate(() => { window.stopTranslationProgress(); return window.translationProgress; });
  assert.ok(progress.some(value => value.progress.completed === 1 && value.progress.total === original.units.length));
  assert.ok(progress.some(value => value.progress.completed === original.units.length));
  assert.equal(maximumActiveTranslations, 1, 'translation chunks must be sent sequentially');
  const cachedCount = translationChats().length;
  await panel().getByRole('button', { name: ko('translation.document'), exact: true }).click();
  await waitIdle(); await panel().getByRole('button', { name: ko('translation.document'), exact: true }).waitFor({ state: 'visible' });
  assert.equal(translationChats().length, cachedCount);
  assert.deepEqual(unchangedDocumentFields(await document(id)), unchangedDocumentFields(original));
  assert.deepEqual(await page.evaluate(id => window.swallow.getStudyWorkspace(id), id), workspace);
  assert.equal(await page.evaluate(() => localStorage.getItem('swallow.study-drafts.v1')), draft);

  // A held second-unit response lets cancellation run before the server attempts a late reply.
  await panel().getByRole('combobox', { name: ko('translation.targetLanguage'), exact: true }).selectOption('en');
  holdNextTranslation = true;
  await panel().getByRole('button', { name: ko('translation.document'), exact: true }).click();
  await waitUntil(() => !!heldResponse, 'held translation response');
  await panel().getByRole('button', { name: ko('translation.cancel'), exact: true }).click();
  await waitIdle();
  const cancelled = await document(id);
  assert.deepEqual(cancelled.translations[firstUnit.id], both);
  assert.equal(cancelled.translations[original.units[1].id]?.en, undefined);
  const cancelledCount = translationChats().length;
  heldResponse.release();
  await waitUntil(() => heldResponse.attempted, 'late response attempt');
  await sleep(200); await waitIdle();
  assert.deepEqual((await document(id)).translations, cancelled.translations);
  assert.equal(translationChats().length, cancelledCount, 'cancelled unit must not send another chunk');
  assert.equal(await answer.inputValue(), '번역 중에도 유지할 사용자 답변 초안');

  const answerNode = await answer.elementHandle();
  await answer.focus(); await answer.evaluate(node => node.setSelectionRange(2, 5));
  const localeCount = translationChats().length;
  await preferences('en', 'ko'); await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await answerNode.evaluate(node => node === document.querySelector('.study-answer')), true);
  assert.equal(await answerNode.evaluate(node => document.activeElement === node), true);
  assert.deepEqual(await answerNode.evaluate(node => [node.selectionStart, node.selectionEnd]), [2, 5]);
  assert.equal(await answerNode.inputValue(), '번역 중에도 유지할 사용자 답변 초안');
  assert.equal(await panel().getByRole('combobox', { name: en('translation.targetLanguage'), exact: true }).inputValue(), 'en');
  assert.equal(translationChats().length, localeCount, 'changing UI/response languages must not translate');

  // PDF whole-document translation uses extraction/OCR text and skips empty pages.
  await page.evaluate(id => window.swallow.study({ type: 'select-document', documentId: id }), pdf.id);
  await startStudy();
  await panel().getByText(en('translation.pdfText'), { exact: true }).waitFor();
  await panel().getByRole('button', { name: en('translation.document'), exact: true }).click();
  await waitUntil(async () => {
    const current = await state(); const doc = current.library.documents.find(doc => doc.id === pdf.id);
    return !current.busy && !!doc.translations?.['unit-0']?.ko && !!doc.translations?.['unit-1']?.ko;
  }, 'PDF text/OCR translations');
  const translatedPdf = await document(pdf.id);
  assert.equal(translatedPdf.translations['unit-2'], undefined);
  assert.deepEqual(unchangedDocumentFields(translatedPdf), pdf);
  assert.ok(translationChats().some(request => request.payload.source.includes('PDF_TEXT_FIXTURE')));
  assert.ok(translationChats().some(request => request.payload.source.includes('PDF_OCR_FIXTURE')));
  assert.equal(translationChats().some(request => request.payload.source.includes('[추출된 텍스트 없음')), false);
  await page.evaluate(id => window.swallow.study({ type: 'select-document', documentId: id }), id);
  await startStudy();
  const persisted = await document(id); const beforeRestartCount = translationChats().length;
  await closeApp(); await launch();
  assert.equal((await state()).ollama.status, 'disconnected');
  assert.deepEqual((await document(id)).translations, persisted.translations);
  assert.equal((await document(id)).source, source);
  await startStudy();
  await panel().locator('.translation-current p[lang="ko"]').waitFor();
  assert.equal(await panel().getByRole('button', { name: en('translation.current'), exact: true }).isDisabled(), true);
  await panel().locator('.translation-saved > summary').click();
  assert.equal(await panel().locator('.translation-saved-unit').count(), original.units.length);
  await panel().locator('.translation-saved-unit > summary').first().click();
  assert.equal(await panel().locator('.translation-current .translation-review-status').innerText(), en('translation.reviewStatus'));
  assert.equal(await panel().locator('.translation-saved-unit .translation-review-status').first().innerText(), en('translation.reviewStatus'));
  assert.equal(requests.filter(request => request.body?.format?.properties?.verdict).length, 0, 'draft generation must not ask for semantic approval');
  assert.equal(await page.locator('.study-answer').inputValue(), '번역 중에도 유지할 사용자 답변 초안');
  assert.equal(translationChats().length, beforeRestartCount, 'saved translations must be readable while disconnected');
  await panel().locator('h3').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, 'translation-ui.png') });
  assert.deepEqual(fixtureErrors, []); assert.deepEqual(errors, []);
  console.log('Translation Electron UI passed: ko/en independent storage, source/draft/locale preservation, sequential whole-document progress/cache, cancelled late response, PDF text/OCR/empty-page handling, disconnected restart reading, current/saved bilingual unreviewed draft labels and no semantic approval calls. No real AI/account calls.');
  console.log('Screenshot: ' + join(artifacts, 'translation-ui.png'));
  console.log('Synthetic data directory: ' + data);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(artifacts, 'translation-ui-failure.png'), timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  heldResponse?.release(); for (const timer of timers) clearTimeout(timer);
  await closeApp(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
