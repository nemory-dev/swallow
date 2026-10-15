import type { ReadingGuide, RecallFeedback, VisualEvidence } from '../shared/types.js';
import { validateAIResultIdentity } from '../shared/ai-identity.js';

function jsonObject(text: string): Record<string, unknown> {
  const clean = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  if (clean.length > 30_000) throw new Error('AI 응답이 너무 깁니다. 다시 요청해 주세요.');
  let value: unknown;
  try { value = JSON.parse(clean); } catch { throw new Error('AI 응답을 해석할 수 없습니다. 완성된 JSON 응답이 필요합니다.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 응답 형식이 잘못되었습니다.');
  return value as Record<string, unknown>;
}
export function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}이(가) 없거나 너무 깁니다.`);
  return value;
}
export function validateGuide(value: unknown, source: string, pages: number[] = []): ReadingGuide {
  if (!value || typeof value !== 'object') throw new Error('학습 안내 형식이 잘못되었습니다.');
  const raw = value as Record<string, unknown>;
  const visualEvidence = validateVisualEvidence(raw.visualEvidence, pages);
  const overview = requireText(raw.overview, '개요', 2000);
  const question = requireText(raw.question, '회상 질문', 1500);
  if (!Array.isArray(raw.keyPoints) || raw.keyPoints.length < 1 || raw.keyPoints.length > 5) throw new Error('핵심 개념은 1~5개여야 합니다.');
  const keyPoints = raw.keyPoints.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('핵심 개념 형식이 잘못되었습니다.');
    const point = item as Record<string, unknown>;
    const quote = point.quote === '' && visualEvidence?.length ? '' : requireText(point.quote, '근거 인용', 800);
    if (!source.includes(quote)) throw new Error('AI가 제시한 인용이 이 원문에 없습니다. 안내를 저장하지 않았습니다.');
    return { title: requireText(point.title, '개념 이름', 150), explanation: requireText(point.explanation, '개념 설명', 2000), quote };
  });
  return { overview, keyPoints, question, ...(visualEvidence ? { visualEvidence } : {}),
    ...(raw.identity === undefined ? {} : { identity: validateAIResultIdentity(raw.identity) }) };
}
export function validateFeedback(value: unknown, pages: number[] = []): RecallFeedback {
  if (!value || typeof value !== 'object') throw new Error('피드백 형식이 잘못되었습니다.');
  const raw = value as Record<string, unknown>;
  const visualEvidence = validateVisualEvidence(raw.visualEvidence, pages);
  if (!Array.isArray(raw.missingPoints) || raw.missingPoints.length > 5) throw new Error('보완점 형식이 잘못되었습니다.');
  return {
    ...(raw.identity === undefined ? {} : { identity: validateAIResultIdentity(raw.identity) }),
    ...(visualEvidence ? { visualEvidence } : {}),
    assessment: requireText(raw.assessment, '피드백', 3000),
    missingPoints: raw.missingPoints.map((item: unknown) => requireText(item, '보완점', 1000)),
    nextStep: requireText(raw.nextStep, '다음 행동', 1500),
  };
}
function validateVisualEvidence(value: unknown, pages: number[]): VisualEvidence[] | undefined {
  if (value === undefined && !pages.length) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new Error('그림 확인 결과와 페이지 근거가 필요합니다. 다시 요청하세요.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || !pages.includes(item.page)) throw new Error('AI가 제시한 PDF 페이지가 현재 근거와 다릅니다.');
    return { page: item.page, description: requireText(item.description, '그림 설명', 2000), uncertainty: requireText(item.uncertainty, '그림 해석의 불확실성', 1000) };
  });
}
// Provider content cannot supply app-owned provenance. Only storage validators preserve identity.
export const parseGuide = (text: string, source: string, pages: number[] = []) => {
  const raw = jsonObject(text); delete raw.identity; return validateGuide(raw, source, pages);
};
export const parseFeedback = (text: string, pages: number[] = []) => {
  const raw = jsonObject(text); delete raw.identity; return validateFeedback(raw, pages);
};
