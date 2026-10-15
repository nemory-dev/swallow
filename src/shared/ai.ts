import type { AppState } from './types.js';

// API contract fixtures, not a claim of inference quality or offline certification.
export const OLLAMA_PROTOCOL_VERSIONS = ['0.12.0', '0.24.0', '0.40.4'] as const;
export const isOllamaModel = (model: string | null | undefined): boolean => !!model?.startsWith('ollama:');
// Historical model identifiers remain in saved records without enabling their providers.
export const explanationProvider = (model: string | null | undefined): string => isOllamaModel(model) ? 'Ollama' : 'AI';
export const pdfAIBlocked = (_state: AppState): boolean => true;
export function modelListed(state: AppState): boolean { return state.models.some(model => model.slug === state.library.selectedModel); }
export function aiUnavailableReason(state: AppState, desktop: boolean): string | null {
  if (!desktop) return 'AI 학습은 데스크톱 앱에서 로컬 서버를 연결하면 사용할 수 있습니다.';
  if (state.ollama?.status === 'checking') return 'Ollama 연결과 모델을 확인하는 중입니다.';
  if (state.ollama?.status !== 'ready') return state.ollama?.message || '실행 중인 Ollama 서버를 연결하세요.';
  return modelListed(state) ? null : '사용 가능한 모델을 선택해 주세요.';
}
