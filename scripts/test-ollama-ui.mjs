import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
const root = fileURLToPath(new URL('..', import.meta.url));
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
const { _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const data = await mkdtemp(join(tmpdir(), 'swallow-ollama-ui-'));
const errors = [], requests = [];
await mkdir(join(data, 'chatgpt'));
await writeFile(join(data, 'chatgpt', 'chatgpt-auth.json'), 'SYNTHETIC_AUTH_NOT_REAL');
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : undefined;
  requests.push({ path: req.url, body }); res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/version') res.end('{"version":"0.40.4"}');
  else if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'ui-fixture:latest', model: 'ui-fixture:latest', digest: 'a'.repeat(64), size: 1024, details: { format: 'gguf', family: 'llama' } }] }));
  else if (req.url === '/api/show') res.end(JSON.stringify({ capabilities: ['completion'], details: { format: 'gguf' }, model_info: { 'general.architecture': 'llama', 'llama.context_length': 32768 } }));
  else if (req.url === '/api/chat') {
    if (body.format.properties.verdict) {
      res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reason: 'Synthetic UI quality check', verdict: 'pass' }) } })); return;
    }
    const payload = JSON.parse(body.messages[1].content);
    const content = payload.answer !== undefined
      ? { assessment: '정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', missingPoints: [payload.source.slice(0, 25)], nextStep: '원문과 대조하세요.' }
      : { overview: '시험 서버의 로컬 학습 설명입니다.', keyPoints: [{ title: '원문 근거', explanation: '자료에서 확인한 내용을 살펴보세요.', quote: payload.source.slice(0, 25) }], question: '어떤 내용을 배웠나요?' };
    res.end(JSON.stringify({ model: body.model, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }));
  } else { res.statusCode = 404; res.end('{}'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const port = server.address().port;
let app;
const launch = async () => {
  const env = { ...process.env, SWALLOW_DATA_DIR: data }; delete env.SWALLOW_DEV_URL;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => window.swallow?.getState().then(state => !!state.language));
  await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
  await page.getByRole('heading', { name: '내 학습', exact: true }).waitFor(); return page;
};
try {
  let page = await launch();
  await page.locator('.account-toggle').click();
  await page.getByRole('spinbutton', { name: 'Ollama 포트', exact: true }).fill(String(port));
  await page.getByRole('button', { name: '로컬 서버 연결', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(state => state.ollama?.status === 'ready'));
  await page.getByRole('button', { name: '연결 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
  await page.locator('.study-model-settings > summary').click();
  const state = await page.evaluate(() => window.swallow.getState());
  const slug = state.models.find(model => model.providerId === 'ollama').slug;
  assert.equal('session' in state, false);
  assert.equal(await page.evaluate(() => ['signIn', 'connectGemini', 'openUsage'].some(key => key in window.swallow)), false);
  assert.equal(await page.getByRole('button', { name: /ChatGPT|Gemini|Google/ }).count(), 0);
  await page.getByRole('combobox', { name: '학습 모델', exact: true }).selectOption(slug);
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '짧게 설명해줘', exact: true }).click();
  await page.getByText('시험 서버의 로컬 학습 설명입니다.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill('작은 부분부터 배웁니다.');
  await page.getByRole('button', { name: '답변 저장하고 피드백 받기', exact: true }).click();
  await page.getByText('정오를 자동 판정하지 않습니다. 아래 원문 근거를 자신의 답변과 비교하세요.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
  await page.getByRole('button', { name: '요점노트 저장', exact: true }).click();
  await page.waitForFunction(() => window.swallow.getState().then(async state => (await window.swallow.getStudyWorkspace(state.library.activeDocumentId)).notes.length === 1));
  const chats = requests.filter(request => request.path === '/api/chat');
  assert.equal(chats.length, 3); // Guide generation + meaning check, feedback quote selection only.
  assert.equal(chats.filter(request => request.body.format.properties.assessment).length, 1);
  assert.equal(chats.filter(request => request.body.format.properties.verdict).length, 1);
  for (const { body } of requests.filter(request => request.path === '/api/chat')) { assert.equal(body.stream, false); assert.equal(body.format.additionalProperties, false); assert.equal(body.truncate, false); }
  await app.close(); app = undefined;
  page = await launch();
  const restored = await page.evaluate(() => window.swallow.getState());
  assert.equal(restored.library.selectedModel, slug); assert.equal(restored.ollama.endpoint.port, port); assert.equal(restored.ollama.status, 'disconnected');
  await page.locator('.account-toggle').click();
  await page.getByRole('button', { name: '로컬 연결 상태 확인', exact: true }).click();
  await page.waitForFunction(slug => window.swallow.getState().then(state => state.models.some(model => model.slug === slug)), slug);
  assert.equal((await page.evaluate(() => window.swallow.getState())).library.selectedModel, slug);
  const workspace = await page.evaluate(async () => { const state = await window.swallow.getState(); return window.swallow.getStudyWorkspace(state.library.activeDocumentId); });
  assert.equal(workspace.notes[0].userAnswer, '작은 부분부터 배웁니다.');
  assert.equal(await readFile(join(data, 'chatgpt', 'chatgpt-auth.json'), 'utf8'), 'SYNTHETIC_AUTH_NOT_REAL');
  assert.deepEqual(errors, []);
  console.log('Ollama UI passed: 좁은 IPC 연결 설정, 구독 API 없는 텍스트 설명·피드백·노트, schema 요청, 재시작 주소·선택 보존. 실제 AI·계정 호출 없음.');
  console.log('임시 저장소: ' + data);
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
