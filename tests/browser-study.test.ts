import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPreview } from '../src/renderer/browser-preview.js';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const entries = new Map<string, string>();
  vi.stubGlobal('window', { speechSynthesis: undefined });
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  return { entries, bridge: createBrowserPreview() };
}
describe('브라우저 공부 세션 보존', () => {
  it('문서 삭제 시 관련 답변과 노트를 삭제하고 다른 문서는 유지한다', async () => {
    const { bridge, entries } = setup();
    await bridge.addDocument({ title: '삭제할 문서', source: '삭제할 원문', goal: '' });
    const id = (await bridge.getState()).library.activeDocumentId!;
    await bridge.studySession({ type: 'start', documentId: id });
    await bridge.studySession({ type: 'step', documentId: id, step: 'check' });
    await bridge.studySession({ type: 'answer', documentId: id, answer: '삭제할 답변', unknown: false });
    await bridge.studySession({ type: 'step', documentId: id, step: 'note' });
    await bridge.saveStudyNote(id);
    await bridge.addDocument({ title: '남길 문서', source: '남길 원문', goal: '' });
    const other = (await bridge.getState()).library.activeDocumentId!;
    await bridge.studySession({ type: 'start', documentId: other });
    await bridge.study({ type: 'delete-document', documentId: id });
    expect(entries.get('swallow.study.v1')).not.toContain('삭제할 답변');
    expect((await bridge.getStudyWorkspace(other)).session).not.toBeNull();
  });
  it('문서 삭제 저장 실패 시 세션 제거도 되돌린다', async () => {
    const { bridge, entries } = setup();
    await bridge.addDocument({ title: '유지할 문서', source: '유지할 원문', goal: '' });
    const id = (await bridge.getState()).library.activeDocumentId!;
    await bridge.studySession({ type: 'start', documentId: id });
    const previous = entries.get('swallow.study.v1');
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { if (key === 'swallow.library.v1') throw new Error('quota'); entries.set(key, value); },
    });
    await expect(bridge.study({ type: 'delete-document', documentId: id })).rejects.toThrow('저장');
    expect(entries.get('swallow.study.v1')).toBe(previous);
    expect((await bridge.getState()).library.activeDocumentId).toBe(id);
    expect((await bridge.getStudyWorkspace(id)).session).not.toBeNull();
  });
  it('AI 없이 답변·노트를 저장하고 새 bridge에서도 이어한다', async () => {
    const { bridge } = setup();
    await bridge.addDocument({ title: '학습', source: '검색으로 근거를 찾는다. '.repeat(70), goal: '' });
    const id = (await bridge.getState()).library.activeDocumentId!;
    await bridge.studySession({ type: 'start', documentId: id });
    await bridge.studySession({ type: 'step', documentId: id, step: 'check' });
    await bridge.studySession({ type: 'relearn', documentId: id, answer: '모르는 검색용 답변' });
    const retry = await createBrowserPreview().getStudyWorkspace(id);
    expect(retry.session?.step).toBe('explain'); expect(retry.notes).toHaveLength(0);
    await bridge.studySession({ type: 'step', documentId: id, step: 'check' });
    await bridge.studySession({ type: 'answer', documentId: id, answer: '검색으로 근거 찾기', unknown: false });
    await bridge.studySession({ type: 'step', documentId: id, step: 'note' });
    await bridge.saveStudyNote(id);
    const reopened = createBrowserPreview();
    expect((await reopened.getStudyWorkspace(id)).notes[0]?.userAnswer).toBe('검색으로 근거 찾기');
    await reopened.studySession({ type: 'next', documentId: id });
    expect((await createBrowserPreview().getStudyWorkspace(id)).session?.passageIndex).toBe(1);
    expect(await reopened.searchStudyNotes('근거')).toHaveLength(1);
    expect(await reopened.searchStudyNotes('모르는 검색용 답변')).toHaveLength(1);
  });
  it('손상 저장소를 덮어쓰지 않고 저장 실패 뒤 기존 상태를 유지한다', async () => {
    const { entries, bridge } = setup();
    await bridge.addDocument({ title: '자료', source: '현재 원문입니다.', goal: '' });
    const id = (await bridge.getState()).library.activeDocumentId!;
    entries.set('swallow.study.v1', '{broken');
    await expect(bridge.getStudyWorkspace(id)).rejects.toThrow('보존');
    await expect(bridge.studySession({ type: 'start', documentId: id })).rejects.toThrow('보존');
    expect(entries.get('swallow.study.v1')).toBe('{broken');
    entries.delete('swallow.study.v1');
    await bridge.studySession({ type: 'start', documentId: id });
    const before = entries.get('swallow.study.v1');
    vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: () => { throw new Error('quota'); } });
    await expect(bridge.studySession({ type: 'step', documentId: id, step: 'check' })).rejects.toThrow('저장');
    expect(entries.get('swallow.study.v1')).toBe(before);
    expect((await bridge.getStudyWorkspace(id)).session?.step).toBe('explain');
  });
});
