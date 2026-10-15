import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryStore } from '../electron/library.js';
import { createDocument } from '../src/learning/document.js';
const paths: string[] = [];
const stores: LibraryStore[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'swallow-test-')); paths.push(path); return path; }
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
describe('원자적 로컬 저장', () => {
  it('동시 변경을 순서대로 저장하고 재시작 후 복구한다', async () => {
    const path = join(await directory(), 'library.json');
    const store = new LibraryStore(path);
    stores.push(store);
    await store.load();
    await Promise.all(['one', 'two'].map(id => store.update(state => {
      state.documents.push(createDocument({ title: id, source: '배울 자료', goal: '' }, { id }));
      state.activeDocumentId = id;
      return state;
    })));
    const reopened = new LibraryStore(path);
    stores.push(reopened);
    expect((await reopened.load()).documents.map(doc => doc.id)).toEqual(['two']);
    expect(reopened.exportLibrary().documents.map(doc => doc.id)).toEqual(['one', 'two']);
    expect(reopened.exportLibrary().activeDocumentId).toBe('two');
  });
  it('손상된 파일을 빈 라이브러리로 덮어쓰지 않는다', async () => {
    const path = join(await directory(), 'library.json');
    await writeFile(path, '{BROKEN');
    const store = new LibraryStore(path);
    stores.push(store);
    await expect(store.load()).rejects.toThrow('저장');
    await expect(store.update(state => state)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('{BROKEN');
  });
  it('쓰기 실패 시 메모리 상태도 유지하며 다시 시도할 수 있다', async () => {
    const directoryPath = await directory();
    const path = join(directoryPath, 'library.json');
    const store = new LibraryStore(path);
    stores.push(store);
    await store.load();
    await rm(directoryPath, { recursive: true });
    await writeFile(directoryPath, '경로를 가로막는 파일');
    await expect(store.update(state => ({ ...state, selectedModel: 'model' }))).rejects.toThrow();
    expect(store.snapshot().selectedModel).toBeNull();
  });
});
