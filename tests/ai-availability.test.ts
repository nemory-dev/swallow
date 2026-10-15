import { describe, expect, it } from 'vitest';
import type { AppState } from '../src/shared/types.js';
import { aiUnavailableReason, pdfAIBlocked } from '../src/shared/ai.js';
import { emptyLibrary } from '../src/learning/document.js';
const state: AppState = { library: { ...emptyLibrary(), selectedModel: 'ollama:fixture' }, models: [{ slug: 'ollama:fixture', displayName: 'Fixture', providerId: 'ollama' }],
  ollama: { status: 'ready', endpoint: { host: '127.0.0.1', port: 11434 }, revision: 1, models: [], message: '' }, busy: null, streamText: '', notice: null };
describe('로컬 모델 가용성', () => {
  it('선택한 로컬 모델만 허용하고 PDF 이미지 추론은 차단한다', () => {
    expect(aiUnavailableReason(state, true)).toBeNull(); expect(pdfAIBlocked(state)).toBe(true);
  });
  it('과거 모델 선택을 다른 모델로 바꾸지 않고 사용 불가로 표시한다', () => {
    const historical = { ...state, library: { ...state.library, selectedModel: 'previous-model' } };
    expect(aiUnavailableReason(historical, true)).toContain('모델');
    expect(historical.library.selectedModel).toBe('previous-model');
  });
  it('로컬 서버 미연결과 빈 목록·브라우저 요청을 차단한다', () => {
    expect(aiUnavailableReason({ ...state, ollama: { ...state.ollama!, status: 'disconnected' } }, true)).toContain('서버');
    expect(aiUnavailableReason({ ...state, models: [] }, true)).toContain('모델');
    expect(aiUnavailableReason(state, false)).toContain('데스크톱');
  });
});
