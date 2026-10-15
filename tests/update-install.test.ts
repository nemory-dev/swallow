import { describe, expect, it, vi } from 'vitest';
import { saveAndInstallUpdate } from '../src/renderer/update-install.js';

describe('업데이트 전 학습 저장', () => {
  it('진행 중 작업이 있으면 저장·설치 요청을 하지 않는다', async () => {
    const save = vi.fn(), install = vi.fn();
    await expect(saveAndInstallUpdate(() => true, [save], install)).rejects.toThrow('작업');
    expect(save).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
  });
  it('모든 답변 저장을 순서대로 기다린 뒤 설치한다', async () => {
    const calls: string[] = []; let finish!: () => void;
    const task = saveAndInstallUpdate(() => false, [async () => { calls.push('legacy'); await new Promise<void>(resolve => { finish = resolve; }); }, async () => { calls.push('study'); }], async () => { calls.push('install'); });
    expect(calls).toEqual(['legacy']); finish(); await task; expect(calls).toEqual(['legacy', 'study', 'install']);
  });
  it('어느 저장이든 실패하면 설치하지 않고 오류를 반환한다', async () => {
    const install = vi.fn();
    await expect(saveAndInstallUpdate(() => false, [async () => {}, async () => { throw new Error('저장 공간 부족'); }], install)).rejects.toThrow('저장 공간');
    expect(install).not.toHaveBeenCalled();
  });
  it('저장 중 새 작업이 시작되어도 설치를 막는다', async () => {
    let busy = false; const install = vi.fn();
    await expect(saveAndInstallUpdate(() => busy, [async () => { busy = true; }], install)).rejects.toThrow('작업');
    expect(install).not.toHaveBeenCalled();
  });
});
