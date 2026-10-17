import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const { createTranslator } = await import('../dist-electron/src/shared/i18n.js');
const ko = createTranslator('ko'), en = createTranslator('en');
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
const { _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const data = await mkdtemp(join(tmpdir(), 'swallow-i18n-ui-'));
const errors = [], requests = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : undefined;
  requests.push({ path: req.url, body }); res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/version') res.end('{"version":"0.40.4"}');
  else if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'i18n-fixture', model: 'i18n-fixture', digest: 'a'.repeat(64), size: 1024, details: { format: 'gguf' } }] }));
  else if (req.url === '/api/show') res.end(JSON.stringify({ capabilities: ['completion'], details: { format: 'gguf' }, model_info: { 'general.architecture': 'llama', 'llama.context_length': 32768 } }));
  else if (req.url === '/api/chat') {
    if (body.format.properties.verdict) {
      res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reason: 'Synthetic UI quality check', verdict: 'pass' }) } })); return;
    }
    const payload = JSON.parse(body.messages[1].content);
    const english = body.messages[0].content.includes('must be English');
    const content = payload.answer !== undefined
      ? { assessment: english ? 'Correctness is not automatically graded. Compare the source evidence below with your answer.' : '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', missingPoints: [payload.source.slice(0, 20)], nextStep: english ? 'Review it.' : '다시 확인하세요.' }
      : { overview: english ? 'English fixture explanation.' : '한국어 시험 설명.', keyPoints: [{ title: english ? 'Source' : '원문', explanation: english ? 'An idea.' : '내용 확인.', quote: payload.source.slice(0, 20) }], question: english ? 'What did you learn?' : '무엇을 배웠나요?' };
    res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }));
  } else { res.statusCode = 404; res.end('{}'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
const chats = () => requests.filter(request => request.path === '/api/chat');
let app, db;
const closeApp = async () => {
  if (!app) return;
  const current = app; app = undefined;
  const child = current.process();
  const watchdog = setTimeout(() => child.kill('SIGTERM'), 5000);
  try {
    // This is an isolated fixture app. Avoid native unsaved-work dialogs blocking test cleanup.
    await current.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await current.close().catch(() => {});
  } finally { clearTimeout(watchdog); }
};
const launch = async () => {
  const env = { ...process.env, SWALLOW_DATA_DIR: data }; delete env.SWALLOW_DEV_URL;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => window.swallow?.getState().then(state => !!state.language));
  return page;
};
const preferences = (page, uiLocale, responseLanguage) => page.evaluate(async values => {
  await window.swallow.setLanguagePreferences(values);
}, { uiLocale, responseLanguage });
try {
  let page = await launch();
  await preferences(page, 'ko', 'ko');
  await page.locator('.account-toggle').click();
  await page.getByRole('spinbutton', { name: ko('account.ollamaPort'), exact: true }).fill(String(port));
  await page.getByRole('button', { name: ko('account.connectLocal'), exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.ollama?.status === 'ready'));
  await page.getByRole('button', { name: ko('account.closePanel'), exact: true }).click();
  const source = '사용자 원문과 인용은 그대로 유지합니다. '.repeat(90);
  await page.evaluate(async source => {
    await window.swallow.addDocument({ title: '사용자 제목', source, goal: '사용자 목표' });
    const state = await window.swallow.getState();
    await window.swallow.study({ type: 'select-model', model: state.models.find(model => model.providerId === 'ollama').slug });
  }, source);
  const initial = await page.evaluate(() => window.swallow.getState());
  const id = initial.library.activeDocumentId;
  await page.getByRole('button', { name: ko('study.start'), exact: true }).click();
  await page.getByRole('button', { name: ko('study.briefRequest'), exact: true }).click();
  await page.getByText('한국어 시험 설명.', { exact: true }).waitFor();
  await page.getByRole('button', { name: ko('study.tryQuestion'), exact: true }).click();
  const answer = page.getByRole('textbox', { name: ko('study.answer'), exact: true });
  await answer.fill('사용자 답변 초안'); await answer.press('End'); await answer.pressSequentially(' abc');
  const originalNode = await answer.elementHandle();
  const selection = await answer.evaluate(node => { node.setSelectionRange(3, 6); return [node.selectionStart, node.selectionEnd]; });
  const draft = await page.evaluate(() => localStorage.getItem('swallow.study-drafts.v1'));
  const beforeSwitch = await page.evaluate(async id => ({ state: await window.swallow.getState(), workspace: await window.swallow.getStudyWorkspace(id), speech: await window.swallow.getSpeechState() }), id);
  const chatCount = chats().length;
  await preferences(page, 'en', 'ko');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await originalNode.evaluate(node => node === document.querySelector('.study-answer')), true);
  assert.equal(await originalNode.evaluate(node => document.activeElement === node), true);
  assert.deepEqual(await originalNode.evaluate(node => [node.selectionStart, node.selectionEnd]), selection);
  assert.equal(await originalNode.inputValue(), '사용자 답변 초안 abc');
  assert.equal(await page.evaluate(() => localStorage.getItem('swallow.study-drafts.v1')), draft);
  const afterSwitch = await page.evaluate(async id => ({ state: await window.swallow.getState(), workspace: await window.swallow.getStudyWorkspace(id), speech: await window.swallow.getSpeechState() }), id);
  assert.deepEqual(afterSwitch.state.library, beforeSwitch.state.library);
  assert.deepEqual(afterSwitch.workspace, beforeSwitch.workspace); assert.deepEqual(afterSwitch.speech, beforeSwitch.speech);
  assert.equal(chats().length, chatCount);
  await page.getByRole('button', { name: en('language.settings'), exact: true }).click();
  const languageDialog = page.getByRole('dialog', { name: en('language.settings'), exact: true });
  await languageDialog.getByRole('combobox', { name: en('language.responseLabel'), exact: true }).selectOption('en');
  await page.waitForFunction(() => window.swallow.getState().then(state => state.language.preferences.responseLanguage === 'en'));
  assert.equal((await page.evaluate(id => window.swallow.getStudyWorkspace(id), id)).session.responseLanguage, 'ko');
  assert.equal(chats().length, chatCount);
  await languageDialog.getByRole('button', { name: en('common.close'), exact: true }).click();
  await page.getByRole('button', { name: en('study.answerFeedback'), exact: true }).click();
  await page.getByText('정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', { exact: true }).waitFor();
  await page.getByRole('button', { name: en('study.saveAndNote'), exact: true }).click();
  await page.getByRole('button', { name: en('study.saveNote'), exact: true }).click();
  const note = (await page.evaluate(id => window.swallow.getStudyWorkspace(id), id)).notes[0];
  assert.equal(note.userAnswer, '사용자 답변 초안 abc'); assert.equal(note.responseLanguage, 'ko');
  await page.getByRole('button', { name: en('study.next'), exact: true }).click();
  await page.getByRole('button', { name: en('study.briefRequest'), exact: true }).click();
  await page.getByText('English fixture explanation.', { exact: true }).waitFor();
  const newSession = (await page.evaluate(id => window.swallow.getStudyWorkspace(id), id)).session;
  assert.equal(newSession.responseLanguage, 'en'); assert.equal(newSession.guide.identity.responseLanguage, 'en');
  const cachedCount = chats().length;
  await preferences(page, 'ko', 'en'); await page.evaluate(id => window.swallow.explainStudy(id, 'brief'), id);
  assert.equal(chats().length, cachedCount);
  await preferences(page, 'en', 'en');
  db = new DatabaseSync(join(data, 'library.sqlite'));
  db.exec("CREATE TRIGGER fail_language BEFORE UPDATE ON settings WHEN NEW.key='language-preferences' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  await page.getByRole('button', { name: en('language.settings'), exact: true }).click();
  await languageDialog.getByRole('combobox', { name: en('language.uiLabel'), exact: true }).selectOption('ko');
  await languageDialog.getByRole('alert').filter({ hasText: 'Language settings could not be saved' }).waitFor();
  assert.equal(await languageDialog.getByRole('combobox', { name: en('language.uiLabel'), exact: true }).inputValue(), 'en');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  db.exec('DROP TRIGGER fail_language'); db.close(); db = undefined;
  await closeApp();
  page = await launch();
  const restored = await page.evaluate(async id => ({ state: await window.swallow.getState(), workspace: await window.swallow.getStudyWorkspace(id) }), id);
  assert.deepEqual(restored.state.language.preferences, { uiLocale: 'en', responseLanguage: 'en' });
  assert.equal(restored.state.library.documents[0].source, source); assert.deepEqual(restored.workspace.notes[0], note);
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.screenshot({ path: join(data, 'i18n-en.png') });
  assert.deepEqual(errors, []);
  console.log('i18n Electron UI passed: four UI/response combinations, focus/selection/DOM/draft/source preservation, current/next passage language, synthetic guide/feedback/cache, failed settings write, restart. No real AI/account calls.');
  console.log('Synthetic data directory: ' + data);
} finally {
  db?.close(); await closeApp();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

console.log('i18n UI fixture cleanup completed.');
