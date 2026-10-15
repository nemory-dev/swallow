import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserPreview } from '../src/renderer/browser-preview.js';
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const entries = new Map<string, string>(); vi.stubGlobal('window', { speechSynthesis: undefined });
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  return { entries, bridge: createBrowserPreview() };
}
it('브라우저 기존 자료를 미분류로 열고 폴더 소속과 학습 세션을 재시작 후 보존한다', async () => {
  const { bridge } = setup(); await bridge.addDocument({ title: '기존 자료', source: '공통 원문', goal: '' });
  const id = (await bridge.getState()).library.activeDocumentId!; await bridge.studySession({ type: 'start', documentId: id });
  const workspace = await bridge.getStudyWorkspace(id); const folder = await bridge.createFolder('AI');
  await bridge.moveDocument(id, folder.id); await bridge.renameFolder(folder.id, 'Agent');
  const reopened = createBrowserPreview(); expect((await reopened.getState()).documents?.[0]?.folderId).toBe(folder.id);
  expect((await reopened.getState()).folders?.[0]?.name).toBe('Agent'); expect(await reopened.getStudyWorkspace(id)).toEqual(workspace);
  expect(await reopened.searchLibrary('공통', { kind: 'unfiled' })).toEqual([]);
  await reopened.deleteFolder(folder.id); expect((await reopened.getState()).documents?.[0]?.folderId).toBeNull();
  expect(await reopened.getStudyWorkspace(id)).toEqual(workspace);
});
it('브라우저 폴더 지정 추가는 한 번에 저장하고 quota 실패 시 기존 상태를 유지한다', async () => {
  const { bridge, entries } = setup(); const folder = await bridge.createFolder('AI');
  await bridge.addDocument({ title: '폴더 자료', source: '공통 원문', goal: '', folderId: folder.id });
  const before = entries.get('swallow.library.v1'), state = await bridge.getState();
  await expect(bridge.addDocument({ title: '실패 자료', source: '원문', goal: '', folderId: 'missing' })).rejects.toThrow('폴더');
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: () => { throw new Error('quota'); } });
  await expect(bridge.moveDocument(state.library.activeDocumentId!, null)).rejects.toThrow('저장');
  await expect(bridge.deleteFolder(folder.id)).rejects.toThrow('저장');
  await expect(bridge.createFolder('새 폴더')).rejects.toThrow('저장');
  await expect(bridge.renameFolder(folder.id, '새 이름')).rejects.toThrow('저장');
  await expect(bridge.addDocument({ title: '저장 실패', source: '실패 원문', goal: '', folderId: folder.id })).rejects.toThrow('저장');
  expect(entries.get('swallow.library.v1')).toBe(before); expect(await bridge.getState()).toEqual(state);
});
it('폴더 필드가 없는 기존 브라우저 JSON과 손상된 폴더 JSON을 안전하게 구분한다', async () => {
  const { bridge, entries } = setup(); await bridge.addDocument({ title: '기존 자료', source: '원문', goal: '' });
  entries.set('swallow.library.v1', JSON.stringify((await bridge.getState()).library));
  const next = createBrowserPreview(); expect((await next.getState()).folders).toEqual([]);
  expect((await next.getState()).documents?.[0]?.folderId).toBeNull();
  const broken = JSON.stringify({ ...(await next.getState()).library, folders: [], documentFolders: { missing: 'missing' } });
  entries.set('swallow.library.v1', broken); await expect(createBrowserPreview().getState()).rejects.toThrow('보존');
  expect(entries.get('swallow.library.v1')).toBe(broken);
});
