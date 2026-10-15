import type { ReadingUnit, TranslationScope } from '../shared/types.js';
import { validateAIResultIdentity } from '../shared/ai-identity.js';
import { PublicError } from '../shared/public-errors.js';

export const MAX_TRANSLATION_LENGTH = 30_000;

export function validateTranslationScope(value: unknown): TranslationScope {
  if (value !== 'unit' && value !== 'document') throw new PublicError('public.translationInvalid');
  return value;
}
export function validateTranslationText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TRANSLATION_LENGTH) throw new PublicError('public.translationInvalid');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicError('public.translationInvalid');
  return value as Record<string, unknown>;
}
export function validateTranslations(value: unknown, units: ReadingUnit[]): void {
  const unitTexts = new Map(units.map(unit => [unit.id, unit.text]));
  for (const [unitId, languages] of Object.entries(object(value))) {
    if (!unitTexts.has(unitId)) throw new PublicError('public.translationInvalid');
    for (const [language, result] of Object.entries(object(languages))) {
      if (language !== 'ko' && language !== 'en') throw new PublicError('public.translationInvalid');
      const raw = object(result);
      if (raw.sourceText !== unitTexts.get(unitId) || raw.targetLanguage !== language
        || typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 200
        || typeof raw.createdAt !== 'string' || raw.createdAt.length > 100 || !Number.isFinite(Date.parse(raw.createdAt))) {
        throw new PublicError('public.translationInvalid');
      }
      validateTranslationText(raw.text);
      try {
        if (validateAIResultIdentity(raw.identity).responseLanguage !== language) throw new PublicError('public.translationInvalid');
      } catch { throw new PublicError('public.translationInvalid'); }
    }
  }
}
