import { OLLAMA_PROTOCOL_VERSIONS } from './ai.js';
import { catalogs, translate, type AppLanguage, type MessageKey, type TranslationArguments } from './i18n.js';

type SimpleKey = { [K in MessageKey]: TranslationArguments<K> extends [] ? K : never }[MessageKey];
export type PublicErrorCode = Extract<SimpleKey, `errors.${string}` | `public.${string}` | 'language.saveFailed' | 'language.invalidSettings'>;
export interface PublicErrorMessage { readonly code: PublicErrorCode }
const codes = new Set<string>(Object.keys(catalogs.ko).filter(key => {
  const value = catalogs.ko[key as MessageKey];
  return /^(errors\.|public\.|language\.(saveFailed|invalidSettings)$)/.test(key) && typeof value === 'string' && !/\{\w+\}/.test(value);
}));
const knownText = new Map<string, SimpleKey>();
for (const catalog of Object.values(catalogs)) {
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === 'string' && !/\{\w+\}/.test(value) && (!knownText.has(value) || codes.has(key))) knownText.set(value, key as SimpleKey);
  }
}

knownText.set(`Ollama 버전의 로컬 모델 판별 계약을 확인하지 못했습니다. 현재 API 계약 범위는 ${OLLAMA_PROTOCOL_VERSIONS.join(', ')}입니다.`, 'public.ollamaVersion');

export class PublicError extends Error {
  readonly code: PublicErrorCode;
  constructor(code: PublicErrorCode) {
    const safeCode = codes.has(code) ? code : 'errors.unexpected';
    super(translate('ko', safeCode));
    this.name = 'PublicError'; this.code = safeCode;
  }
}
export function toPublicError(error: unknown): PublicErrorMessage {
  if (error instanceof PublicError && codes.has(error.code)) return { code: error.code };
  if (error && typeof error === 'object' && Object.hasOwn(error, 'code')) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string' && codes.has(code)) return { code: code as PublicErrorCode };
  }
  if (error instanceof Error) {
    const key = knownText.get(error.message);
    if (key && codes.has(key)) return { code: key as PublicErrorCode };
  }
  return { code: 'errors.unexpected' };
}
export function restorePublicError(value: unknown): PublicError {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'code')) {
    const code = (value as { code: unknown }).code;
    if (typeof code === 'string' && codes.has(code)) return new PublicError(code as PublicErrorCode);
  }
  return new PublicError('errors.unexpected');
}
export function errorText(error: unknown, language: AppLanguage, fallback: MessageKey = 'errors.unexpected'): string {
  const result = toPublicError(error);
  // Fallback is an app-owned display key, never a raw Error.message.
  if (result.code === 'errors.unexpected' && fallback !== 'errors.unexpected') {
    const value = catalogs[language][fallback];
    if (typeof value === 'string' && !/\{\w+\}/.test(value)) return value;
  }
  return translate(language, result.code);
}
/** Existing status text is translated only by exact catalog membership. Empty state remains empty. */
export function localizeText(text: string, language: AppLanguage): string {
  if (!text) return '';
  const key = knownText.get(text);
  return key ? translate(language, key) : translate(language, 'errors.unexpected');
}
