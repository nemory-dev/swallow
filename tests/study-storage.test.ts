import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeSchema } from '../electron/library-schema.js';
import { readingPassages } from '../src/learning/reading.js';
import { LibraryStore } from '../electron/library.js';
import { createDocument, applyStudyAction } from '../src/learning/document.js';
import { applySessionAction, createStudySession } from '../src/learning/session.js';
import { pdfSource } from '../src/learning/pdf.js';
const roots: string[] = [], stores: LibraryStore[] = [];
const doc = (id = 'doc') => createDocument({ title: '회상하기', source: '한글 회상과 SQLite 원문을 보존합니다.\n'.repeat(100), goal: '' }, { id, now: '2026-01-01T00:00:00.000Z' });
async function setup() { const root = await mkdtemp(join(tmpdir(), 'swallow-study-')); roots.push(root); const store = new LibraryStore(join(root, 'library.json')); stores.push(store); await store.load(); await store.update(state => ({ ...state, documents: [doc()], activeDocumentId: 'doc' })); return { root, store }; }
async function ready(store: LibraryStore, answer = '  실제 답변 SQLite\n', unknown = false) {
  await store.updateStudySession('doc', (_, document, ref) => createStudySession(document, ref.sourceHash));
  await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'step', documentId: 'doc', step: 'check' }));
  await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'answer', documentId: 'doc', answer, unknown }));
  await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'step', documentId: 'doc', step: 'note' }));
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe('세션·노트 SQLite 저장', () => {
  it('피드백 포함 노트를 재열기·검색하고 기존 노트는 변경하지 않는다', async () => {
    const { root, store } = await setup(); await ready(store); const legacy = await store.saveStudyNote('doc');
    await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'next', documentId: 'doc' }));
    await store.updateStudySession('doc', session => ({ ...session!, step: 'note', answer: '새 답변', answerFeedback: {
      question: '이 구간의 핵심 내용을 자신의 말로 설명해 보세요.', answer: '새 답변', model: 'gemini:test',
      result: { assessment: '질문평가검증어', missingPoints: ['보완검증어'], nextStep: '다음검증어' },
    } }));
    const note = await store.saveStudyNote('doc');
    expect(note.answerFeedback?.result.assessment).toBe('질문평가검증어');
    store.close(); const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened); await reopened.load();
    const workspace = reopened.studyWorkspace('doc');
    expect(workspace.notes.find(n => n.id === legacy.id)).toEqual(legacy);
    expect(workspace.notes.find(n => n.id === note.id)).toEqual(note);
    expect(workspace.session?.answerFeedback).toEqual(note.answerFeedback);
    for (const query of ['질문평가검증어', '보완검증어', '다음검증어']) expect(reopened.searchStudyNotes(query)).toEqual([note]);
  });
  it('재학습 중 재시작해도 막힌 질문과 답변을 복원하고 노트에서 검색한다', async () => {
    const { root, store } = await setup(); await ready(store);
    await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'step', documentId: 'doc', step: 'check' }));
    await store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'relearn', documentId: 'doc', answer: '로드밸런싱만 알아요' }));
    store.close(); const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened); await reopened.load();
    expect(reopened.studyWorkspace('doc').session).toMatchObject({ step: 'explain', answer: '로드밸런싱만 알아요', relearning: [{ answer: '로드밸런싱만 알아요' }] });
    await reopened.updateStudySession('doc', session => ({ ...session!, step: 'note', answer: '자원을 함께 관리합니다.', unknown: false }));
    const note = await reopened.saveStudyNote('doc');
    expect(note.relearning?.[0]?.answer).toBe('로드밸런싱만 알아요');
    expect(reopened.searchStudyNotes('로드밸런싱')).toEqual([note]);
  });
  it('현재 PDF 페이지 메모 변경은 설명·피드백을 무효화하고 저장한 노트는 보존한다', async () => {
    const { store } = await setup();
    const pdf = pdfSource([{ text: 'PDF page content.', method: 'text' }]);
    const document = createDocument({ title: 'PDF', source: pdf.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: pdf.pages } }, { id: 'pdf' });
    await store.update(state => ({ ...state, documents: [...state.documents, document], activeDocumentId: 'pdf' }));
    await store.updateStudySession('pdf', (_, doc, ref) => ({ ...createStudySession(doc, ref.sourceHash), step: 'note', answer: 'PDF를 설명합니다.', unknown: false, answerFeedback: { question: '질문?', answer: 'PDF를 설명합니다.', model: 'test-model', result: { assessment: '현재 그림을 해석했습니다.', missingPoints: [], nextStep: '그림을 확인하세요.', visualEvidence: [{ page: 1, description: '근거', uncertainty: '없음' }] } }, guideModel: 'test-model', guideStyle: 'brief', guide: { overview: '이전 메모 설명', question: '질문?', keyPoints: [{ title: '본문', explanation: '설명', quote: 'PDF page content.' }], visualEvidence: [{ page: 1, description: '그림', uncertainty: '불확실' }] } }));
    const saved = await store.saveStudyNote('pdf');
    await store.update(state => applyStudyAction(state, { type: 'save-pdf-note', documentId: 'pdf', page: 1, note: '변경된 메모' }));
    expect(store.studyWorkspace('pdf').session?.guide).toBeUndefined();
    expect(store.studyWorkspace('pdf').session?.guideModel).toBeUndefined();
    expect(store.studyWorkspace('pdf').session?.answerFeedback).toBeUndefined();
    expect(store.studyWorkspace('pdf').notes).toEqual([saved]);
  });
  it('재시작 후 현재 세션과 실제 답변을 복원하고 노트 재저장은 중복을 만들지 않는다', async () => {
    const { root, store } = await setup(); await ready(store);
    const first = await store.saveStudyNote('doc'); expect(first.userAnswer).toBe('  실제 답변 SQLite\n');
    expect(store.studyWorkspace('doc').session?.step).toBe('done');
    const again = await store.saveStudyNote('doc'); expect(again.id).toBe(first.id); expect(again.createdAt).toBe(first.createdAt);
    expect(store.studyWorkspace('doc').notes).toHaveLength(1);
    store.close(); const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened); await reopened.load();
    expect(reopened.studyWorkspace('doc').session?.answer).toBe(first.userAnswer); expect(reopened.studyWorkspace('doc').notes).toEqual([again]);
    expect(reopened.searchStudyNotes('sqlite')).toEqual([again]); expect(reopened.searchStudyNotes('" OR * NOT (')).toEqual([]); expect(reopened.searchStudyNotes('  ')).toEqual([]);
  });
  it('reducer 실행을 직렬화하여 빠른 저장에서 갱신 손실을 방지한다', async () => {
    const { store } = await setup(); await ready(store);
    await Promise.all(['첫째', '둘째'].map(term => store.updateStudySession('doc', (session, document) => applySessionAction(document, session!, { type: 'add-term', documentId: 'doc', term: { term, explanation: term, kind: 'ai' } }))));
    expect(store.studyWorkspace('doc').session?.terms.map(t => t.term)).toEqual(['첫째', '둘째']);
  });
  it('쓰기 실패 시 노트와 완료 상태를 함께 롤백하고 다음 저장은 성공한다', async () => {
    const { root, store } = await setup(); await ready(store);
    const before = store.studyWorkspace('doc'); const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec("CREATE TRIGGER fail_session BEFORE UPDATE ON study_sessions BEGIN SELECT RAISE(ABORT,'test write failure'); END");
    await expect(store.saveStudyNote('doc')).rejects.toThrow(); expect(store.studyWorkspace('doc')).toEqual(before);
    db.exec('DROP TRIGGER fail_session'); db.close(); await store.saveStudyNote('doc'); expect(store.studyWorkspace('doc').notes).toHaveLength(1);
  });
  it('모름은 빈 답변을 저장하지만 잘못된 세션과 빈 답변 노트는 거절한다', async () => {
    const { store } = await setup();
    await store.updateStudySession('doc', (_, document, ref) => createStudySession(document, ref.sourceHash));
    await expect(store.saveStudyNote('doc')).rejects.toThrow();
    await expect(store.updateStudySession('doc', session => ({ ...session!, passageIndex: 1000 }))).rejects.toThrow();
    await ready(store, '', true); const note = await store.saveStudyNote('doc'); expect(note.unknown).toBe(true); expect(note.userAnswer).toBe('');
  });
  it('보관·복원은 노트를 유지하고 자료 삭제는 관련 세션·노트를 함께 삭제한다', async () => {
    const { root, store } = await setup(); await ready(store); const note = await store.saveStudyNote('doc');
    await store.archive('doc'); expect(store.studyWorkspace('doc').notes).toEqual([note]); expect(store.searchStudyNotes('회상')).toHaveLength(1);
    await store.restore('doc'); await store.select('doc'); expect(store.studyWorkspace('doc').notes).toEqual([note]);
    await store.update(state => applyStudyAction(state, { type: 'delete-document', documentId: 'doc' }));
    expect(store.searchStudyNotes('회상')).toEqual([]); const db = new DatabaseSync(join(root, 'library.sqlite'));
    expect(db.prepare('SELECT COUNT(*) n FROM study_sessions').get()!.n).toBe(0); expect(db.prepare('SELECT COUNT(*) n FROM study_notes').get()!.n).toBe(0); db.close();
  });
  it('미완료 세션은 자동 보관에서 제외한다', async () => {
    const { store } = await setup(); await ready(store);
    await store.update(state => ({ ...state, documents: [...state.documents, doc('other')], activeDocumentId: 'other' }));
    await store.setAutoArchive(true); expect(await store.maintain('2027-10-11T00:00:00.000Z')).toBe(0);
    expect(store.catalog().find(item => item.id === 'doc')?.archived).toBe(false);
  });
  it('노트 목록은 최신 100개, 전체 문서 검색은 20개까지 반환한다', async () => {
    const { store } = await setup();
    const long = createDocument({ title: '많은 노트', source: '반복 원문 SQLite '.repeat(5000), goal: '' }, { id: 'long' });
    await store.update(state => ({ ...state, documents: [...state.documents, long], activeDocumentId: 'long' }));
    let count = 0;
    for (const unit of long.units) {
      for (let passageIndex = 0; passageIndex < readingPassages(unit.text).length && count < 105; passageIndex++, count++) {
        await store.updateStudySession('long', (_, document, reference) => ({ ...createStudySession(document, reference.sourceHash), unitId: unit.id, passageIndex, step: 'note', unknown: true }));
        await store.saveStudyNote('long');
      }
      if (count === 105) break;
    }
    expect(count).toBe(105); expect(store.studyWorkspace('long').notes).toHaveLength(100);
    expect(store.searchStudyNotes('SQLITE')).toHaveLength(20);
    expect(() => store.searchStudyNotes('x'.repeat(201))).toThrow();
  }, 30_000);
  it('v1 스키마 이전 실패는 새 테이블과 버전 변경을 롤백한다', async () => {
    const { root, store } = await setup(); const before = store.exportLibrary(); store.close();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('DROP TABLE document_folders; DROP TABLE learning_folders; DROP TABLE study_notes; DROP TABLE study_sessions; PRAGMA user_version=1; CREATE TABLE study_notes (sentinel TEXT);');
    expect(() => initializeSchema(db)).toThrow();
    expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='study_sessions'").get()).toBeUndefined();
    db.exec('DROP TABLE study_notes'); db.close();
    const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened); await reopened.load();
    expect(reopened.exportLibrary()).toEqual(before);
  });
  it('v1 SQLite를 v3로 올려도 원문·회상·설정·기존 검색을 보존한다', async () => {
    const { root, store } = await setup(); await store.update(state => applyStudyAction(state, { type: 'save-recall', documentId: 'doc', unitId: 'unit-0', answer: '기존 답변' }));
    const before = store.exportLibrary(); store.close(); const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('DROP TABLE document_folders; DROP TABLE learning_folders; DROP TABLE study_notes; DROP TABLE study_sessions; PRAGMA user_version=1;'); db.close();
    const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened); await reopened.load();
    expect(reopened.exportLibrary()).toEqual(before); expect(reopened.search('회상').length).toBeGreaterThan(0); expect(reopened.studyWorkspace('doc')).toEqual({ session: null, notes: [] });
    const inspect = new DatabaseSync(join(root, 'library.sqlite')); expect(inspect.prepare('PRAGMA user_version').get()!.user_version).toBe(3); inspect.close();
  });
});
