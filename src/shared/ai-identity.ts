import type { AIResultIdentity, ResponseLanguage } from './types.js';

export function validateResponseLanguage(value: unknown): ResponseLanguage {
  if (value !== 'ko' && value !== 'en') throw new Error('Invalid response language.');
  return value;
}
export function validateAIResultIdentity(value: unknown): AIResultIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI identity.');
  const raw = value as Record<string, unknown>;
  if (!['chatgpt', 'gemini', 'ollama'].includes(String(raw.providerId))) throw new Error('Invalid AI provider.');
  function text(key: string): string {
    const value = raw[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('Invalid AI identity field.');
    return value;
  }
  if (raw.promptRevision !== undefined && (!Number.isInteger(raw.promptRevision) || Number(raw.promptRevision) < 1 || Number(raw.promptRevision) > 1000)) throw new Error('Invalid AI prompt revision.');
  return { providerId: raw.providerId as AIResultIdentity['providerId'], connectionId: text('connectionId'), upstreamModelId: text('upstreamModelId'),
    responseLanguage: validateResponseLanguage(raw.responseLanguage),
    ...(raw.modelFingerprint === undefined ? {} : { modelFingerprint: text('modelFingerprint') }),
    ...(raw.promptRevision === undefined ? {} : { promptRevision: raw.promptRevision as number }) };
}
export function sameAIIdentity(first: AIResultIdentity | undefined, second: AIResultIdentity): boolean {
  return !!first && first.providerId === second.providerId && first.connectionId === second.connectionId
    && first.upstreamModelId === second.upstreamModelId && first.modelFingerprint === second.modelFingerprint
    && first.responseLanguage === second.responseLanguage && first.promptRevision === second.promptRevision;
}
