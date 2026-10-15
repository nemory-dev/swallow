import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { LibraryStore } from '../dist-electron/electron/library.js';
import { studyPassage } from '../dist-electron/src/learning/session.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const modulePath = process.env.SWALLOW_PLAYWRIGHT_MODULE;
let electron;
try { ({ _electron: electron } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright')); }
catch { throw new Error('UI 검증은 선택 도구 Playwright가 필요합니다. SWALLOW_PLAYWRIGHT_MODULE에 설치된 playwright/index.mjs 절대 경로를 지정하세요. 먼저 npm run build로 앱을 빌드하세요.'); }
const data = await mkdtemp(join(tmpdir(), 'swallow-study-ui-'));
const artifacts = join(projectRoot, 'artifacts');
await mkdir(artifacts, { recursive: true });
const errors = [];
const screenshot = (page, name) => page.screenshot({ path: join(artifacts, `guided-study-${name}.png`), fullPage: true });
const draft = '작업 기억의 용량에는 한계가 있으므로 작은 단위로 나누어 이해합니다.\n이 답변은 앱을 다시 열어도 남아 있어야 합니다.';
let documentId, originalSource, savedLocation, syntheticQuote;
let speechResult = '음성이 설치되지 않아 듣기 검증 생략';

async function launch() {
  const env = { ...process.env, SWALLOW_DATA_DIR: data };
  delete env.SWALLOW_DEV_URL;
  const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: projectRoot, env, timeout: 30000 });
  let page;
  try {
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.waitForFunction(() => !!window.swallow);
    await page.evaluate(() => window.swallow.setLanguagePreferences({ uiLocale: 'ko', responseLanguage: 'ko' }));
    await page.getByRole('heading', { name: '내 학습', exact: true }).waitFor();
    const state = await page.evaluate(() => window.swallow.getState());
    assert.equal('session' in state, false, '구독 계정 state를 노출하지 않습니다.');
    assert.deepEqual(state.models, [], '테스트 전용 저장소에는 AI 서버나 계정을 연결하지 않습니다.');
    assert.equal(await page.evaluate(() => ['signIn', 'connectGemini', 'openUsage'].some(key => key in window.swallow)), false);
    return { app, page };
  } catch (error) { await app.close(); throw error; }
}
async function usingApp(operation) {
  const { app, page } = await launch();
  try { await operation(page); }
  catch (error) {
    await screenshot(page, 'failure').catch(() => undefined);
    console.error('실패 시 임시 저장소: ' + data);
    throw error;
  } finally { await app.close(); }
  assert.deepEqual(errors, [], 'renderer pageerror가 없어야 합니다.');
}
const workspace = page => page.evaluate(id => window.swallow.getStudyWorkspace(id), documentId);
const location = session => `${session.unitId}:${session.passageIndex}`;

await usingApp(async page => {
  await page.getByRole('heading', { name: '막막하면, 한 부분부터 같이 시작해요.', exact: true }).waitFor();
  await screenshot(page, 'welcome');
  await page.getByRole('button', { name: '짧은 예제 문서로 시작하기 →', exact: true }).click();
  await page.getByRole('button', { name: '공부 시작', exact: true }).click();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).waitFor();
  const state = await page.evaluate(() => window.swallow.getState());
  documentId = state.library.activeDocumentId;
  const doc = state.library.documents.find(item => item.id === documentId);
  assert.ok(doc); originalSource = doc.source;
  const first = await workspace(page); assert.equal(first.session.step, 'explain');
  assert.equal(first.session.passageIndex, 0); assert.equal(first.notes.length, 0);
  await page.locator('.study-original > summary').click();
  assert.ok((await page.locator('.study-source').innerText()).trim());
  const voices = await page.evaluate(() => window.swallow.getSpeechVoices());
  if (voices.length) {
    await page.getByRole('button', { name: '원문 듣기', exact: true }).click();
    await page.waitForFunction(async () => { const state = await window.swallow.getSpeechState(); return state.status === 'speaking' || !!state.error; });
    const spoken = await page.evaluate(() => window.swallow.getSpeechState());
    if (spoken.status === 'speaking') {
      await page.getByRole('button', { name: '듣기 중지', exact: true }).click();
      assert.equal((await page.evaluate(() => window.swallow.getSpeechState())).status, 'idle');
      speechResult = '설치된 음성으로 원문 듣기·듣기 중지 통과';
    } else {
      speechResult = '설치된 음성의 오디오 출력 불가로 재생 검증 생략: ' + spoken.error;
      await page.evaluate(() => window.swallow.controlSpeech('stop'));
    }
  }
  await screenshot(page, 'explain');
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill(draft);
  assert.equal((await workspace(page)).session.answer, '', 'DB 저장 전 초안은 별도로 유지합니다.');
  const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem('swallow.study-drafts.v1') ?? '{}'));
  assert.ok(Object.values(drafts).includes(draft));
  await screenshot(page, 'draft');
});

await usingApp(async page => {
  await page.getByRole('button', { name: '이어하기', exact: true }).click();
  const input = page.getByRole('textbox', { name: '내 답변', exact: true });
  await input.waitFor(); assert.equal(await input.inputValue(), draft);
  await page.getByRole('button', { name: '아직 모르겠어요', exact: true }).click();
  await page.getByRole('heading', { name: '아는 부분에서 다시 시작해요.', exact: true }).waitFor();
  const relearning = await workspace(page);
  assert.equal(relearning.session.step, 'explain'); assert.equal(relearning.notes.length, 0);
  assert.equal(relearning.session.relearning[0].answer, draft);
  assert.equal(relearning.session.unknown, true);
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  assert.equal(await input.inputValue(), draft);
  assert.equal((await workspace(page)).session.step, 'check');
  await page.locator('.term-lookup > summary').click();
  await page.getByRole('textbox', { name: '모르는 용어', exact: true }).fill('작업 기억');
  await page.getByRole('button', { name: '내 자료에서 찾기', exact: true }).click();
  await page.locator('.term-results article').first().waitFor();
  await page.getByRole('button', { name: '이 원문을 요점노트에 추가', exact: true }).first().click();
  await page.getByText('현재 구간의 요점노트에 추가했습니다. 노트 저장을 눌러 마무리하세요.', { exact: true }).waitFor();
  const withTerm = await workspace(page);
  assert.equal(withTerm.session.terms.length, 1); assert.equal(withTerm.session.terms[0].kind, 'source');
  assert.equal(withTerm.session.terms[0].reference.documentId, documentId);
  await screenshot(page, 'term-search');
  await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
  await page.getByRole('button', { name: '요점노트 저장', exact: true }).click();
  await page.getByRole('heading', { name: '한 부분을 공부하고 노트로 남겼어요.', exact: true }).waitFor();
  const saved = await workspace(page); assert.equal(saved.notes.length, 1); assert.equal(saved.session.step, 'done');
  assert.equal(saved.notes[0].userAnswer, draft); assert.equal(saved.notes[0].terms.length, 1); assert.equal(saved.notes[0].summaryOrigin, 'source');
  await page.locator('.study-notes > summary').click();
  await page.locator('.saved-note > summary').first().click();
  const note = page.locator('.saved-note .note-contents').first();
  assert.match(await note.innerText(), /AI 없이 원문 발췌로 저장/);
  assert.match(await note.innerText(), /작업 기억/);
  await screenshot(page, 'saved-note');
  const previous = location(saved.session);
  await page.getByRole('button', { name: '한 부분 더', exact: true }).click();
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).waitFor();
  const next = await workspace(page); savedLocation = location(next.session);
  assert.notEqual(savedLocation, previous); assert.equal(next.session.step, 'explain'); assert.equal(next.session.answer, ''); assert.deepEqual(next.session.terms, []);
});

// 종료한 앱의 로컬 저장소에 검증된 응답 모양만 주입한다. AI 요청이나 계정 연결은 하지 않는다.
const seeded = new LibraryStore(join(data, 'library.json'));
try {
  await seeded.load();
  await seeded.updateStudySession(documentId, (session, document) => {
    assert.equal(location(session), savedLocation);
    const passage = studyPassage(document, session);
    syntheticQuote = passage.slice(0, 80).trim();
    assert.ok(syntheticQuote);
    return { ...session, guideModel: 'ui-synthetic-model', guideStyle: 'brief', guide: {
      overview: '테스트 설명: 작은 단위의 핵심을 자신의 말로 확인합니다.',
      keyPoints: [{ title: '직접 떠올리기', explanation: '익숙함과 실제 이해를 구분하는 연습입니다.', quote: syntheticQuote }],
      question: '테스트 질문: 이 작은 구간의 핵심은 무엇인가요?',
    } };
  });
} finally { seeded.close(); }

await usingApp(async page => {
  await page.getByRole('button', { name: '이어하기', exact: true }).click();
  await page.locator('.study-explanation').waitFor();
  assert.equal(location((await workspace(page)).session), savedLocation);
  assert.match(await page.locator('.study-explanation').innerText(), /테스트 설명: 작은 단위의 핵심/);
  assert.ok((await page.locator('.study-explanation blockquote').innerText()).includes(syntheticQuote));
  await screenshot(page, 'resumed-explanation');
  await page.getByRole('button', { name: '한 가지 질문에 답해보기 →', exact: true }).click();
  assert.equal(await page.locator('.study-question').innerText(), '테스트 질문: 이 작은 구간의 핵심은 무엇인가요?');
  await page.getByRole('textbox', { name: '내 답변', exact: true }).fill('테스트 답변: 설명을 이해한 뒤 직접 떠올려 확인합니다.');
  await page.getByRole('button', { name: '답변 저장하고 요점노트 보기', exact: true }).click();
  await page.getByRole('button', { name: '요점노트 저장', exact: true }).click();
  await page.getByRole('heading', { name: '한 부분을 공부하고 노트로 남겼어요.', exact: true }).waitFor();
  const saved = await workspace(page); assert.equal(saved.notes.length, 2);
  const aiNote = saved.notes.find(note => note.summaryOrigin === 'ai');
  assert.ok(aiNote); assert.equal(aiNote.guideModel, 'ui-synthetic-model'); assert.deepEqual(aiNote.evidenceQuotes, [syntheticQuote]);
  await page.locator('.study-notes > summary').click();
  const savedNote = page.locator('.saved-note').filter({ hasText: '테스트 답변: 설명을 이해한 뒤 직접 떠올려 확인합니다.' });
  await savedNote.locator(':scope > summary').click();
  assert.match(await savedNote.innerText(), /설명 생성 모델 · ui-synthetic-model/);
  assert.match(await savedNote.innerText(), /테스트 질문: 이 작은 구간의 핵심은 무엇인가요/);
  await savedNote.getByText('AI 설명의 원문 근거', { exact: true }).click();
  assert.ok((await savedNote.innerText()).includes(syntheticQuote));
  await screenshot(page, 'ai-note');
});

const verification = new LibraryStore(join(data, 'library.json'));
try {
  await verification.load();
  const doc = verification.exportLibrary().documents.find(item => item.id === documentId);
  assert.equal(doc.source, originalSource, 'UI 공부 과정은 원본 자료를 변경하지 않습니다.');
  const saved = verification.studyWorkspace(documentId);
  assert.equal(saved.notes.length, 2); assert.equal(saved.session.step, 'done');
  assert.equal(saved.notes.find(note => note.summaryOrigin === 'source').userAnswer, draft);
  assert.equal(saved.notes.find(note => note.summaryOrigin === 'ai').guideModel, 'ui-synthetic-model');
} finally { verification.close(); }
assert.deepEqual(errors, []);
console.log('Guided study UI passed: 예제 → 공부 시작 → 질문 → 미저장 초안 재시작 복원 → 용어 로컬검색/추가 → 노트 저장 → 다음 → 이어하기.');
console.log('Synthetic AI UI passed: 설명·질문·모델·정확한 인용이 노트에 표시되고 재시작 후에도 원문과 답변을 보존합니다. 실제 AI 요청 없음.');
console.log(speechResult);
console.log('Renderer pageerrors: 0');
console.log('임시 저장소: ' + data);
console.log('스크린샷: ' + join(artifacts, 'guided-study-*.png'));
