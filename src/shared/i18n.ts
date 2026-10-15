import { ko } from './locales/ko.js';
import { en } from './locales/en.js';

export type AppLanguage = 'ko' | 'en';
export interface LanguagePreferences {
  readonly uiLocale: AppLanguage;
  readonly responseLanguage: AppLanguage;
}
export interface LanguageResolution {
  readonly preferences: LanguagePreferences;
  readonly status: 'missing' | 'valid' | 'invalid';
  readonly invalidFields: readonly (keyof LanguagePreferences)[];
}

/** Strict storage/IPC allowlist; OS locale normalization must not be used for stored settings. */
export function validateLanguagePreferences(value: unknown): LanguagePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid language preferences.');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'uiLocale') || !Object.hasOwn(raw, 'responseLanguage')
    || !isLanguage(raw.uiLocale) || !isLanguage(raw.responseLanguage)) throw new TypeError('Invalid language preferences.');
  return { uiLocale: raw.uiLocale, responseLanguage: raw.responseLanguage };
}

export const catalogs = { ko, en } as const;
export type MessageKey = keyof typeof ko;
type MessageTemplate<K extends MessageKey> = typeof ko[K] extends string ? typeof ko[K]
  : typeof ko[K] extends { readonly one: infer One extends string; readonly other: infer Other extends string } ? One | Other : never;
type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
type NumericParameter = 'count' | 'max' | 'page' | 'total' | 'index' | 'active' | 'archived';
export type MessageParams<K extends MessageKey> = {
  readonly [P in Placeholders<MessageTemplate<K>>]: P extends NumericParameter ? number : string;
};
export type TranslationArguments<K extends MessageKey> = [Placeholders<MessageTemplate<K>>] extends [never]
  ? [] : [params: MessageParams<K>];
export type Translator = <K extends MessageKey>(key: K, ...args: TranslationArguments<K>) => string;

// Screen adapters use domain values as stable keys; no stored enum or content is translated.
export const studyStepMessageKeys = {
  explain: 'study.step.explain', check: 'study.step.check', note: 'study.step.note', done: 'study.step.done',
} as const satisfies Record<'explain' | 'check' | 'note' | 'done', MessageKey>;
export const explanationStyleMessageKeys = {
  brief: 'study.brief', simple: 'study.simple', example: 'study.example', relearn: 'study.relearn',
} as const satisfies Record<'brief' | 'simple' | 'example' | 'relearn', MessageKey>;
export const reviewRatingMessageKeys = {
  again: 'review.again', hard: 'review.hard', good: 'review.good',
} as const satisfies Record<'again' | 'hard' | 'good', MessageKey>;
export const libraryScopeMessageKeys = {
  all: 'folder.all', unfiled: 'folder.unfiled', folder: 'folder.heading',
} as const satisfies Record<'all' | 'unfiled' | 'folder', MessageKey>;
export const pdfMethodMessageKeys = {
  text: 'pdf.textHelp', ocr: 'pdf.ocrHelp', empty: 'pdf.emptyHelp',
} as const satisfies Record<'text' | 'ocr' | 'empty', MessageKey>;

function isLanguage(value: unknown): value is AppLanguage { return value === 'ko' || value === 'en'; }

function canonicalLocale(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try { return Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0]; }
  catch { return undefined; }
}

/** Regional UI tags collapse to ko/en. Unsupported or malformed input uses the supplied fallback. */
export function normalizeLocale(value: unknown, fallback: AppLanguage = 'ko'): AppLanguage {
  const primary = canonicalLocale(value)?.split('-')[0];
  return isLanguage(primary) ? primary : isLanguage(fallback) ? fallback : 'ko';
}

export function displayLocale(language: AppLanguage): 'ko-KR' | 'en-US' {
  return normalizeLocale(language) === 'en' ? 'en-US' : 'ko-KR';
}

/** No environment reads, writes, migration, or AI requests. `stored: undefined` alone means missing.
 * The caller must determine installation history from reliable storage, not the active document count.
 * Pass a malformed stored value (e.g. null) after a parse failure; never turn it into a missing value.
 */
export function resolveLanguagePreferences(input: {
  readonly installation: 'existing' | 'new';
  readonly systemLocales?: readonly string[];
  readonly stored?: unknown;
}): LanguageResolution {
  if (input.stored === undefined) {
    // The first well-formed OS preference wins, including an unsupported language (which defaults to en).
    const systemLocale = input.systemLocales?.map(canonicalLocale).find(value => value !== undefined);
    const language = input.installation === 'existing' ? 'ko' : normalizeLocale(systemLocale, 'en');
    return { preferences: { uiLocale: language, responseLanguage: language }, status: 'missing', invalidFields: [] };
  }
  const stored = input.stored && typeof input.stored === 'object' && !Array.isArray(input.stored)
    ? input.stored as Record<string, unknown> : {};
  const invalidFields: (keyof LanguagePreferences)[] = [];
  function read(field: keyof LanguagePreferences): AppLanguage {
    const value = Object.hasOwn(stored, field) ? stored[field] : undefined;
    if (isLanguage(value)) return value;
    invalidFields.push(field);
    return 'ko';
  }
  const preferences = { uiLocale: read('uiLocale'), responseLanguage: read('responseLanguage') };
  return { preferences, status: invalidFields.length ? 'invalid' : 'valid', invalidFields };
}

export function formatNumber(language: AppLanguage, value: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(value)) throw new RangeError('Expected a finite number.');
  return new Intl.NumberFormat(displayLocale(language), options).format(value);
}

/** Display only. Omit timeZone to use the device time zone; ISO storage and scheduling stay with the caller. */
export function formatDate(language: AppLanguage, value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return translate(language, 'common.unknownDate');
  return new Intl.DateTimeFormat(displayLocale(language), options).format(date);
}

const numericParameters: ReadonlySet<string> = new Set([
  'count', 'max', 'page', 'total', 'index', 'active', 'archived',
]);

function render(language: AppLanguage, key: MessageKey, params?: unknown): string {
  const locale = normalizeLocale(language);
  const catalog = catalogs[locale];
  // Unknown runtime keys never echo arbitrary provider text or read Object.prototype properties.
  if (!Object.hasOwn(catalog, key)) return catalog['errors.unexpected'];
  const message = catalog[key];
  const values = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
  let template: string;
  if (typeof message === 'string') template = message;
  else {
    const count = Object.hasOwn(values, 'count') ? values.count : undefined;
    if (typeof count !== 'number') throw new TypeError('Expected a numeric count.');
    if (!Number.isFinite(count) || count < 0) throw new RangeError('Expected a finite, nonnegative count.');
    const category = new Intl.PluralRules(displayLocale(locale)).select(count);
    template = category === 'one' ? message.one : message.other;
  }
  // Return plain text. React escapes it; callers must not use dangerouslySetInnerHTML.
  // A single replacement pass preserves braces/$ sequences in user-provided names.
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (numericParameters.has(name)) {
      if (typeof value !== 'number') throw new TypeError('Expected a numeric message parameter.');
      return formatNumber(locale, value);
    }
    if (typeof value !== 'string') throw new TypeError('Expected a text message parameter.');
    return value;
  });
}

export function translate<K extends MessageKey>(language: AppLanguage, key: K, ...args: TranslationArguments<K>): string {
  return render(language, key, args[0]);
}

export function createTranslator(language: AppLanguage): Translator {
  return <K extends MessageKey>(key: K, ...args: TranslationArguments<K>) => render(language, key, args[0]);
}
