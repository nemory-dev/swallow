import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LibraryStore } from '../electron/library.js';
import { initializeSchema } from '../electron/library-schema.js';
import { createDocument, applyStudyAction } from '../src/learning/document.js';
import { createStudySession } from '../src/learning/session.js';
import { pdfSource } from '../src/learning/pdf.js';
import { errorText, restorePublicError, toPublicError } from '../src/shared/public-errors.js';

const roots: string[] = [], stores: LibraryStore[] = [];
const doc = (id: string) => createDocument({ title: id, source: '공통 검색 원문과 학습 기록입니다.', goal: '' }, { id });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'swallow-folders-')); roots.push(root);
  const store = new LibraryStore(join(root, 'library.json')); stores.push(store); await store.load();
  return { root, store };
}
async function reopen(root: string) {
  const store = new LibraryStore(join(root, 'library.json')); stores.push(store); await store.load(); return store;
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('학습 폴더', () => {
  it('삭제된 대상 폴더 오류를 공개 IPC code로 전달하고 원문·선택을 보존한다', async () => {
    const { store } = await setup();
    const folder = await store.createFolder('삭제할 폴더');
    await store.addDocument(doc('existing'));
    await store.deleteFolder(folder.id);
    const before = store.exportLibrary();
    const error = await store.addDocument(doc('rejected'), folder.id).catch(error => error);
    const envelope = JSON.parse(JSON.stringify(toPublicError(error)));
    expect(envelope).toEqual({ code: 'public.folderMissing' });
    const restored = restorePublicError(envelope);
    expect(errorText(restored, 'ko')).toContain('다른 폴더');
    expect(errorText(restored, 'en')).toContain('another folder');
    expect(store.exportLibrary()).toEqual(before);
    expect(store.catalog().map(item => item.id)).toEqual(['existing']);
  });
  it('중복 폴더 이름은 공개 오류로 안내하고 기존 이름을 유지한다', async () => {
    const { store } = await setup();
    const first = await store.createFolder('AI');
    const second = await store.createFolder('번역');
    const error = await store.renameFolder(second.id, first.name).catch(error => error);
    expect(toPublicError(error)).toEqual({ code: 'public.folderDuplicate' });
    expect(errorText(restorePublicError(toPublicError(error)), 'en')).toContain('different name');
    expect(store.folders().map(folder => folder.name)).toEqual(['AI', '번역']);
  });
  it('빈 폴더 생성·이름 변경·자료 이동을 재시작 후 유지하며 문서는 변경하지 않는다', async () => {
    const { root, store } = await setup(); const folder = await store.createFolder('  AI   Agent  ');
    expect(folder.name).toBe('AI Agent'); await store.addDocument(doc('one'), folder.id);
    await store.createFolder('빈 폴더'); const before = store.exportLibrary();
    await store.renameFolder(folder.id, 'LangGraph'); store.close(); const next = await reopen(root);
    expect(next.folders().map(value => value.name)).toEqual(['LangGraph', '빈 폴더']);
    expect(next.catalog()[0]?.folderId).toBe(folder.id); expect(next.exportLibrary()).toEqual(before);
    await next.moveDocument('one', null); expect(next.catalog()[0]?.folderId).toBeNull();
  });
  it('폴더 삭제와 압축 자료 이동·복원이 원문·세션·노트·회상을 보존한다', async () => {
    const { store } = await setup(); const folder = await store.createFolder('학습'); await store.addDocument(doc('one'), folder.id);
    await store.update(state => applyStudyAction(state, { type: 'save-recall', documentId: 'one', unitId: 'unit-0', answer: '내 답변' }));
    await store.updateStudySession('one', (_, document, ref) => ({ ...createStudySession(document, ref.sourceHash), step: 'note', answer: '공통 노트', unknown: false }));
    await store.saveStudyNote('one'); const before = store.exportLibrary(), workspace = store.studyWorkspace('one');
    await store.archive('one'); await store.moveDocument('one', null); await store.moveDocument('one', folder.id);
    expect(store.search('공통', { kind: 'folder', folderId: folder.id })).toHaveLength(1);
    await store.deleteFolder(folder.id); expect(store.catalog()[0]?.folderId).toBeNull();
    await store.restore('one'); await store.select('one'); expect(store.exportLibrary()).toEqual(before);
    expect(store.studyWorkspace('one')).toEqual(workspace); expect(store.history('one', 'unit-0')).toHaveLength(1);
  });
  it('검색 제한 전에 폴더 범위를 적용하고 노트 검색도 범위를 따른다', async () => {
    const { store } = await setup(); const folder = await store.createFolder('대상'); await store.addDocument(doc('target'), folder.id);
    await store.updateStudySession('target', (_, document, ref) => ({ ...createStudySession(document, ref.sourceHash), step: 'note', answer: '공통 노트', unknown: false }));
    await store.saveStudyNote('target');
    for (let index = 0; index < 22; index++) await store.addDocument(doc(`other-${index}`));
    expect(store.search('공통')).toHaveLength(20);
    expect(store.search('공통', { kind: 'folder', folderId: folder.id }).map(hit => hit.documentId)).toEqual(['target']);
    expect(store.search('공통', { kind: 'unfiled' }).every(hit => hit.documentId !== 'target')).toBe(true);
    expect(store.searchStudyNotes('공통', { kind: 'unfiled' })).toEqual([]);
    expect(store.searchStudyNotes('공통', { kind: 'folder', folderId: folder.id })).toHaveLength(1);
  });
  it('잘못된 이름·ID는 거부하고 실패한 추가와 이동은 기존 기록을 유지한다', async () => {
    const { store, root } = await setup(); const folder = await store.createFolder('AI'); await store.addDocument(doc('one'), folder.id);
    for (const name of ['', ' '.repeat(4), 'a'.repeat(51), 'ai', 'ＡＩ']) await expect(store.createFolder(name)).rejects.toThrow();
    const before = store.exportLibrary();
    await expect(store.addDocument(doc('missing'), 'missing')).rejects.toThrow('폴더');
    await expect(store.moveDocument('one', 'missing')).rejects.toThrow('폴더');
    await expect(store.moveDocument('missing', folder.id)).rejects.toThrow('자료');
    await expect(store.renameFolder('missing', 'new')).rejects.toThrow('폴더');
    expect(() => store.search('공통', { kind: 'folder', folderId: 'missing' })).toThrow('폴더');
    expect(store.exportLibrary()).toEqual(before);
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec("CREATE TRIGGER prevent_move BEFORE DELETE ON document_folders BEGIN SELECT RAISE(ABORT,'blocked'); END;");
    await expect(store.deleteFolder(folder.id)).rejects.toThrow();
    expect(store.folders()).toHaveLength(1); expect(store.catalog()[0]?.folderId).toBe(folder.id); db.close();
  });
  it('v2 이전 백업과 PDF·노트·진행·설정을 보존하고 반복 실행하지 않는다', async () => {
    const { root, store } = await setup(); const pdf = pdfSource([{ text: 'PDF 공통 원문', method: 'text' }]);
    const document = createDocument({ title: 'PDF', source: pdf.source, goal: '', pdf: { assetId: 'a'.repeat(64), pages: pdf.pages } }, { id: 'pdf' });
    await store.addDocument(document);
    await store.update(state => ({ ...applyStudyAction(state, { type: 'save-recall', documentId: 'pdf', unitId: 'unit-0', answer: '기존 답변' }), selectedModel: 'existing-model' }));
    await store.updateStudySession('pdf', (_, document, ref) => ({ ...createStudySession(document, ref.sourceHash), step: 'note', unknown: true }));
    await store.saveStudyNote('pdf'); const before = store.exportLibrary(), workspace = store.studyWorkspace('pdf'); store.close();
    const db = new DatabaseSync(join(root, 'library.sqlite')); db.exec('DROP TABLE document_folders; DROP TABLE learning_folders; PRAGMA user_version=2;'); db.close();
    const next = await reopen(root); expect(next.exportLibrary()).toEqual(before); expect(next.studyWorkspace('pdf')).toEqual(workspace);
    expect(next.catalog()[0]?.folderId).toBeNull(); expect(next.folders()).toEqual([]);
    const backup = join(root, 'library.pre-folders-v2.sqlite'); const inspect = new DatabaseSync(backup, { readOnly: true });
    expect(inspect.prepare('PRAGMA user_version').get()!.user_version).toBe(2); expect(inspect.prepare('SELECT COUNT(*) n FROM study_notes').get()!.n).toBe(1); inspect.close();
    next.close(); await reopen(root); expect((await readdir(root)).filter(name => name.includes('pre-folders'))).toEqual(['library.pre-folders-v2.sqlite']);
  });
  it('소속 INSERT 실패는 문서·검색 색인·선택 위치까지 롤백하고 다음 저장은 성공한다', async () => {
    const { store, root } = await setup(); const folder = await store.createFolder('대상'); await store.addDocument(doc('existing'));
    const before = store.exportLibrary(), catalog = store.catalog(), hits = store.search('공통');
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec("CREATE TRIGGER prevent_add BEFORE INSERT ON document_folders BEGIN SELECT RAISE(ABORT,'blocked'); END;");
    await expect(store.addDocument(doc('failed'), folder.id)).rejects.toThrow();
    expect(store.exportLibrary()).toEqual(before); expect(store.catalog()).toEqual(catalog); expect(store.search('공통')).toEqual(hits);
    expect(store.snapshot().activeDocumentId).toBe('existing'); store.close(); const next = await reopen(root);
    expect(next.exportLibrary()).toEqual(before); expect(next.search('공통')).toEqual(hits);
    db.exec('DROP TRIGGER prevent_add;'); db.close(); await next.addDocument(doc('success'), folder.id);
    expect(next.snapshot().activeDocumentId).toBe('success'); expect(next.catalog()[0]?.folderId).toBe(folder.id);
  });
  it('v2 스키마 이전 실패는 두 새 테이블과 버전 변경을 롤백한다', () => {
    const db = new DatabaseSync(':memory:'); initializeSchema(db);
    db.exec('DROP TABLE document_folders; DROP TABLE learning_folders; PRAGMA user_version=2; CREATE TABLE document_folders (sentinel TEXT);');
    expect(() => initializeSchema(db)).toThrow(); expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='learning_folders'").get()).toBeUndefined(); db.close();
  });
  it('v1에서 폴더 이전 실패 시 세션·노트 테이블도 만들지 않고 v1을 유지한다', () => {
    const db = new DatabaseSync(':memory:'); initializeSchema(db);
    db.exec('DROP TABLE document_folders; DROP TABLE learning_folders; DROP TABLE study_sessions; DROP TABLE study_notes; PRAGMA user_version=1; CREATE TABLE document_folders (sentinel TEXT);');
    expect(() => initializeSchema(db)).toThrow(); expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='study_sessions'").get()).toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='study_notes'").get()).toBeUndefined(); db.close();
  });
});
