import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { LibraryStore } from '../electron/library.js';
import { applyStudyAction, createDocument, emptyLibrary } from '../src/learning/document.js';
import type { LibraryState } from '../src/shared/types.js';
import { initializeSchema } from '../electron/library-schema.js';
const roots: string[] = []; const stores: LibraryStore[] = [];
async function setup() { const root = await mkdtemp(join(tmpdir(), 'swallow-sqlite-')); roots.push(root); const store = new LibraryStore(join(root, 'library.json')); stores.push(store); return { root, store }; }
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const doc = (id = 'one') => createDocument({ title: '능동적 회상과 작업 기억', source: '# 기억\n\n작업 기억은 정보를 잠시 유지한다. 능동적 회상은 기억에서 꺼내는 연습이다.', goal: '이해하기' }, { id, now: '2026-01-01T00:00:00.000Z' });
describe('SQLite 이전·검색·압축 보관', () => {
  it('기존 모든 필드를 보존하고 압축 백업·이전 보고서를 남기며 재실행해도 중복되지 않는다', async () => {
    const { root, store } = await setup();
    let legacy: LibraryState = { ...emptyLibrary(), documents: [doc(), doc('two')], activeDocumentId: 'two', selectedModel: 'test-model' };
    legacy = applyStudyAction(legacy, { type: 'save-recall', documentId: 'one', unitId: 'unit-0', answer: '기억을 꺼낸다' }, '2026-01-02T00:00:00.000Z');
    legacy = applyStudyAction(legacy, { type: 'rate-recall', documentId: 'one', unitId: 'unit-0', rating: 'hard' }, '2026-01-02T00:00:00.000Z');
    legacy.documents[0]!.guides['unit-0'] = { model: 'test-model', guide: { overview: '기억에서 꺼내기', keyPoints: [{ title: '회상', explanation: '꺼내는 연습', quote: '능동적 회상은 기억에서 꺼내는 연습이다.' }], question: '회상이란?' } };
    const original = JSON.stringify(legacy); await writeFile(join(root, 'library.json'), original);
    const view = await store.load();
    expect(view.documents.map(d => d.id)).toEqual(['two']);
    expect(store.exportLibrary()).toEqual(legacy);
    expect(await readFile(join(root, 'library.json'), 'utf8')).toBe(original);
    const report = store.storageInfo().migration!;
    expect(report.verified).toBe(true); expect(report.documents).toBe(2);
    expect(gunzipSync(await readFile(join(root, report.backup))).toString()).toBe(original);
    store.close(); const reopened = new LibraryStore(join(root, 'library.json')); stores.push(reopened);
    await reopened.load(); expect(reopened.exportLibrary()).toEqual(legacy);
    expect(reopened.history('one', 'unit-0')).toHaveLength(1);
  });
  it('이전 중 DB 오류는 롤백하고 손상 JSON/지원하지 않는 DB는 덮어쓰지 않는다', async () => {
    const { root, store } = await setup(); await writeFile(join(root, 'library.json'), '{broken');
    await expect(store.load()).rejects.toThrow('이전');
    expect(await readFile(join(root, 'library.json'), 'utf8')).toBe('{broken');
    store.close(); await writeFile(join(root, 'library.sqlite'), 'not sqlite');
    const broken = new LibraryStore(join(root, 'library.json')); stores.push(broken);
    await expect(broken.load()).rejects.toThrow();
    expect(await readFile(join(root, 'library.sqlite'), 'utf8')).toBe('not sqlite');
  });
  it('원문만 검색하고 한글 부분·짧은 질의·기호를 안전하게 처리하며 근거 버전을 검사한다', async () => {
    const { store } = await setup(); await store.load(); await store.update(state => ({ ...state, documents: [doc()], activeDocumentId: 'one' }));
    await store.update(state => applyStudyAction(state, { type: 'save-recall', documentId: 'one', unitId: 'unit-0', answer: '정답에 없는 비밀단어' }));
    const hits = store.search('능동적 회상'); expect(hits.length).toBe(1);
    expect(store.search('회상')).toHaveLength(1); expect(store.search('비밀단어')).toEqual([]);
    expect(store.search('" OR * NOT (')).toEqual([]); expect(store.search('')).toEqual([]);
    const evidence = store.evidence(hits[0]!, 20); expect(evidence.text.length).toBeLessThanOrEqual(20);
    expect(() => store.evidence({ ...hits[0]!, sourceHash: '0'.repeat(64) })).toThrow('변경');
    await store.update(state => applyStudyAction(state, { type: 'delete-document', documentId: 'one' }));
    expect(store.search('회상')).toEqual([]); expect(() => store.evidence(hits[0]!)).toThrow();
  });
  it('회상 이력을 누적하고 보관→검색→복원→재시작 후 답안·근거를 유지한다', async () => {
    const { root, store } = await setup(); await store.load(); await store.update(state => ({ ...state, documents: [doc()], activeDocumentId: 'one' }));
    for (const answer of ['첫 답안', '둘째 답안']) await store.update(state => applyStudyAction(state, { type: 'save-recall', documentId: 'one', unitId: 'unit-0', answer }));
    const before = store.exportLibrary().documents[0]; expect(store.history('one', 'unit-0')).toHaveLength(2);
    await store.archive('one'); expect(store.snapshot().documents).toEqual([]);
    expect(store.catalog()[0]?.archived).toBe(true); const hit = store.search('작업 기억')[0]!;
    expect(hit.archived).toBe(true); expect(store.evidence(hit).text).toContain('작업 기억');
    await store.restore('one'); await store.select('one'); expect(store.snapshot().documents[0]).toEqual(before);
    store.close(); const next = new LibraryStore(join(root, 'library.json')); stores.push(next); await next.load();
    expect(next.snapshot().documents[0]).toEqual(before); expect(next.history('one', 'unit-0')).toHaveLength(2);
    await next.compact(); expect(next.search('회상')).toHaveLength(1);
  });
  it('손상된 압축 자료는 복원하지 않고 원본 압축을 유지한다', async () => {
    const { root, store } = await setup(); await store.load(); await store.update(state => ({ ...state, documents: [doc()], activeDocumentId: 'one' }));
    await store.archive('one'); store.close();
    const db = new DatabaseSync(join(root, 'library.sqlite')); db.prepare('UPDATE documents SET archive_payload=?').run(Buffer.from('broken')); db.close();
    const next = new LibraryStore(join(root, 'library.json')); stores.push(next); await next.load();
    await expect(next.restore('one')).rejects.toThrow('압축'); expect(next.catalog()[0]?.archived).toBe(true);
  });
  it('90일 자동 보관은 선택형이며 현재 문서·복습 예정 자료를 제외한다', async () => {
    const { store } = await setup(); await store.load();
    await store.update(state => ({ ...state, documents: [doc(), doc('two'), doc('three')], activeDocumentId: 'three' }));
    await store.select('two');
    await store.update(state => applyStudyAction(applyStudyAction(state, { type: 'save-recall', documentId: 'two', unitId: 'unit-0', answer: '복습' }), { type: 'rate-recall', documentId: 'two', unitId: 'unit-0', rating: 'good' }));
    await store.select('three');
    expect(await store.maintain('2027-10-11T00:00:00.000Z')).toBe(0);
    await store.setAutoArchive(true); expect(await store.maintain('2027-10-11T00:00:00.000Z')).toBe(1);
    expect(store.catalog().filter(d => d.archived).map(d => d.id)).toEqual(['one']);
  });
  it('DB와 현재 문서만 읽으며 많은 문서를 추가해도 검색 범위를 제한한다', async () => {
    const { root, store } = await setup(); await store.load();
    for (let i = 0; i < 30; i++) await store.update(state => ({ ...state, documents: [...state.documents, doc(String(i))], activeDocumentId: String(i) }));
    expect(store.catalog()).toHaveLength(30); expect(store.snapshot().documents).toHaveLength(1);
    expect(store.search('회상')).toHaveLength(20);
    expect((await readFile(join(root, 'library.sqlite'))).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    expect(await readdir(root)).not.toContain('library.json');
  });
  it('짧은 검색어의 Unicode 차이로 실제 결과가 후보 제한 밖으로 밀리지 않는다', async () => {
    const { store } = await setup(); await store.load();
    for (let i = 0; i <= 20; i++) await store.update(state => ({ ...state, documents: [...state.documents, createDocument({ title: '자료', source: i ? 'é' : 'e', goal: '' }, { id: String(i) })], activeDocumentId: String(i) }));
    expect(store.search('e').map(hit => hit.documentId)).toEqual(['0']);
    expect(store.search('é')).toHaveLength(20);
  });
  it('여러 근거를 중복 없이 총 문자 예산 안에서만 반환한다', async () => {
    const { store } = await setup(); await store.load();
    await store.update(state => ({ ...state, documents: [doc(), doc('two')], activeDocumentId: 'two' }));
    const hits = store.search('기억'); const context = store.evidenceContext([...hits, ...hits], 70);
    expect(context.reduce((n, item) => n + item.text.length, 0)).toBeLessThanOrEqual(70);
    expect(new Set(context.map(item => item.documentId)).size).toBe(context.length);
    expect(() => store.evidenceContext(hits, 0)).toThrow();
  });
  it('이전 중 두 번째 문서 쓰기 실패는 전부 롤백하고 재시작 시 다시 이전한다', async () => {
    const { root, store } = await setup();
    const legacy = { ...emptyLibrary(), documents: [doc(), doc('two')], activeDocumentId: 'two' };
    await writeFile(join(root, 'library.json'), JSON.stringify(legacy));
    const db = new DatabaseSync(join(root, 'library.sqlite')); initializeSchema(db);
    db.exec("CREATE TRIGGER fail_migrate BEFORE INSERT ON documents WHEN NEW.id='two' BEGIN SELECT RAISE(ABORT,'test failure'); END"); db.close();
    await expect(store.load()).rejects.toThrow();
    const inspect = new DatabaseSync(join(root, 'library.sqlite'));
    expect(inspect.prepare('SELECT COUNT(*) n FROM documents').get()!.n).toBe(0);
    expect(inspect.prepare("SELECT value FROM settings WHERE key='initialized'").get()).toBeUndefined();
    inspect.exec('DROP TRIGGER fail_migrate'); inspect.close();
    await store.load(); expect(store.exportLibrary()).toEqual(legacy);
  });
  it('보관 중 저장 실패는 원문·답안을 유지하고 다음 시도는 성공한다', async () => {
    const { root, store } = await setup(); await store.load(); await store.update(state => ({ ...state, documents: [doc()], activeDocumentId: 'one' }));
    const before = store.snapshot(); const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec("CREATE TRIGGER fail_archive BEFORE UPDATE ON documents WHEN NEW.archived_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await expect(store.archive('one')).rejects.toThrow(); expect(store.snapshot()).toEqual(before);
    expect(store.exportLibrary()).toEqual(before); expect(store.search('회상')).toHaveLength(1);
    db.exec('DROP TRIGGER fail_archive'); db.close(); await store.archive('one'); expect(store.catalog()[0]?.archived).toBe(true);
  });
  it('자동 보관 후보가 실행 전에 선택되면 보관하지 않는다', async () => {
    const { store } = await setup(); await store.load(); await store.update(state => ({ ...state, documents: [doc(), doc('two')], activeDocumentId: 'two' }));
    await store.setAutoArchive(true);
    const selected = store.select('one'); const maintenance = store.maintain('2027-10-11T00:00:00.000Z');
    await selected; await maintenance; expect(store.catalog().find(item => item.id === 'one')?.archived).toBe(false);
  });
  it('현재 문서 삭제 후 다른 활성 문서를 선택하고 저장 원문 변경은 거부한다', async () => {
    const { store } = await setup(); await store.load();
    await store.update(state => ({ ...state, documents: [doc(), doc('two')], activeDocumentId: 'two' }));
    await store.update(state => applyStudyAction(state, { type: 'delete-document', documentId: 'two' }));
    expect(store.snapshot().activeDocumentId).toBe('one');
    await expect(store.update(state => ({ ...state, documents: [createDocument({ title: '변경', source: '다른 원문', goal: '' }, { id: 'one' })] }))).rejects.toThrow('새 문서');
    expect(store.search('회상')).toHaveLength(1);
  });
  it('긴 원문을 압축하고 구간·검색·복원 내용을 그대로 유지한다', async () => {
    const { root, store } = await setup(); await store.load();
    const long = createDocument({ title: '긴 학습 자료', source: '능동적 회상은 배운 내용을 기억에서 꺼내는 연습입니다.\n\n'.repeat(8000), goal: '' }, { id: 'long' });
    expect(long.source.length).toBeGreaterThan(250_000);
    await store.update(state => ({ ...state, documents: [long], activeDocumentId: long.id }));
    await store.archive(long.id);
    const inspect = new DatabaseSync(join(root, 'library.sqlite'), { readOnly: true });
    const packed = inspect.prepare('SELECT length(archive_payload) bytes,source,metadata FROM documents').get()!;
    expect(Number(packed.bytes)).toBeLessThan(JSON.stringify(long).length / 10);
    expect(packed.source).toBeNull(); expect(packed.metadata).toBe('{}'); inspect.close();
    expect(store.search('능동적 회상')).toHaveLength(20);
    await store.restore(long.id); await store.select(long.id);
    expect(store.snapshot().documents[0]).toEqual(long);
  });
});
