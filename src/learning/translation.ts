import type { ReadingUnit, SourceTranslation, TranslationScope } from '../shared/types.js';
import { validateAIResultIdentity } from '../shared/ai-identity.js';
import { PublicError } from '../shared/public-errors.js';
import { readingPassages } from './reading.js';

export const MAX_TRANSLATION_LENGTH = 30_000;
export const TRANSLATION_LITERALS = /^# PDF \d+쪽$|```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|`[^`\n]+`|https?:\/\/[^\s<>`]+(?<![.!?,;:])|\$\$[\s\S]*?\$\$|\$[^$\n]+\$(?!\d)|\b[A-Za-z]\w*(?:[²³]|\^\d+)?(?:[ \t]*[+*/−-][ \t]*[A-Za-z0-9]+)*[ \t]*=[ \t]*[A-Za-z0-9]+(?:[²³]|\^\d+)?(?:[ \t]*[+*/−-][ \t]*[A-Za-z0-9]+)*/gm;

export function validateTranslationScope(value: unknown): TranslationScope {
  if (value !== 'passage' && value !== 'unit' && value !== 'document') throw new PublicError('public.translationInvalid');
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
    const source = unitTexts.get(unitId);
    if (source === undefined) throw new PublicError('public.translationInvalid');
    validateDraftLanguages(languages, source);
  }
}
export function validatePassageTranslations(value: unknown, units: ReadingUnit[]): void {
  const unitTexts = new Map(units.map(unit => [unit.id, unit.text]));
  for (const [unitId, drafts] of Object.entries(object(value))) {
    const source = unitTexts.get(unitId);
    if (source === undefined) throw new PublicError('public.translationInvalid');
    const passages = readingPassages(source);
    for (const [index, languages] of Object.entries(object(drafts))) {
      const passage = passages[Number(index)];
      if (String(Number(index)) !== index || !passage?.trim()) throw new PublicError('public.translationInvalid');
      validateDraftLanguages(languages, passage);
    }
  }
}
function validateDraftLanguages(value: unknown, source: string): void {
  for (const [language, result] of Object.entries(object(value))) {
    if (language !== 'ko' && language !== 'en') throw new PublicError('public.translationInvalid');
    const raw = object(result);
    if (raw.sourceText !== source || raw.targetLanguage !== language
      || typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 200
      || typeof raw.createdAt !== 'string' || raw.createdAt.length > 100 || !Number.isFinite(Date.parse(raw.createdAt))) {
      throw new PublicError('public.translationInvalid');
    }
    const text = validateTranslationText(raw.text);
    if (raw.sentenceEnds !== undefined) validateSentenceEnds(raw.sentenceEnds, source, text);
    try {
      if (validateAIResultIdentity(raw.identity).responseLanguage !== language) throw new PublicError('public.translationInvalid');
    } catch { throw new PublicError('public.translationInvalid'); }
  }
}

function validateSentenceEnds(value: unknown, source: string, text: string): void {
  if (!Array.isArray(value) || !value.length || value.length > source.length) throw new PublicError('public.translationInvalid');
  let sourceStart = 0, textStart = 0;
  for (const item of value) {
    const { sourceEnd, textEnd } = object(item);
    if (typeof sourceEnd !== 'number' || !Number.isSafeInteger(sourceEnd) || sourceEnd <= sourceStart || sourceEnd > source.length
      || !source.slice(sourceStart, sourceEnd).trim()
      || typeof textEnd !== 'number' || !Number.isSafeInteger(textEnd) || textEnd < textStart || textEnd > text.length) {
      throw new PublicError('public.translationInvalid');
    }
    sourceStart = sourceEnd; textStart = textEnd;
  }
  if (sourceStart !== source.length || textStart !== text.length) throw new PublicError('public.translationInvalid');
}

export function translationSentencePairs(draft: SourceTranslation): { source: string; text: string }[] {
  if (!draft.sentenceEnds) return [{ source: draft.sourceText, text: draft.text }];
  let sourceStart = 0, textStart = 0;
  return draft.sentenceEnds.map(({ sourceEnd, textEnd }) => {
    const pair = { source: draft.sourceText.slice(sourceStart, sourceEnd), text: draft.text.slice(textStart, textEnd) };
    sourceStart = sourceEnd; textStart = textEnd;
    return pair;
  });
}

// Match common literal units and their Korean/English spellings without attempting unit conversion.
const unitPatterns = Object.entries({
  '%': 'percent|per cent|퍼센트|프로', kg: 'kilograms?|킬로그램', g: 'grams?|그램',
  mg: 'milligrams?|밀리그램', km: 'kilometers?|kilometres?|킬로미터', m: 'meters?|metres?|미터',
  cm: 'centimeters?|centimetres?|센티미터', mm: 'millimeters?|millimetres?|밀리미터',
  L: 'liters?|litres?|리터', mL: 'ml|milliliters?|millilitres?|밀리리터',
  s: 'sec|seconds?|초', ms: 'milliseconds?|밀리초', min: 'minutes?|분',
  h: 'hr|hours?|시간', '°C': '° C|degrees? Celsius', '°F': '° F|degrees? Fahrenheit',
  USD: '\\$|dollars?|달러', KRW: '₩|won|원', EUR: '€|euros?|유로', JPY: '¥|yen|엔',
  B: 'bytes?|바이트', KB: 'kilobytes?|킬로바이트', MB: 'megabytes?|메가바이트',
  GB: 'gigabytes?|기가바이트', TB: 'terabytes?|테라바이트', Hz: 'hertz|헤르츠',
}).map(([unit, aliases]) => [unit, new RegExp('^[ \\t]*(?:' + unit + '|' + aliases + ')(?![a-zA-Z])', 'u')] as const);
const numbers = /(?<prefix>[$₩€¥])?[ \t]*(?<value>[+−±-]?(?:(?:\p{Nd}{1,3}(?:,\p{Nd}{3})+|\p{Nd}+)(?:\.\p{Nd}+)?|\.\p{Nd}+)(?:[eE][+-]?\p{Nd}+)?)/gu;
const currency = { '$': 'USD', '₩': 'KRW', '€': 'EUR', '¥': 'JPY' };

function quantities(text: string) {
  const prose = text.replace(TRANSLATION_LITERALS, ' ').normalize('NFKC');
  return [...prose.matchAll(numbers)].map(match => {
    const { prefix, value } = match.groups!;
    const rest = prose.slice(match.index + match[0].length);
    let suffix = '', unit = prefix ? currency[prefix as keyof typeof currency] : '';
    if (!unit) {
      for (const [candidate, pattern] of unitPatterns) {
        const found = pattern.exec(rest)?.[0];
        if (found && found.length > suffix.length) { suffix = found; unit = candidate; }
      }
    }
    const number = value!.replace(/,/g, '').replace('−', '-').replace(/^\+/, '')
      .replace(/^(-?)0+(?=\d)/, '$1').replace(/^([-±]?)\./, (_, sign: string) => sign + '0.')
      .replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
    return { key: JSON.stringify([number, unit]), label: (match[0] + suffix).trim() };
  });
}

export function compareTranslationNumbers(source: string, translation: string) {
  const original = quantities(source), draft = quantities(translation);
  function unmatched(items: typeof original, other: typeof original): string[] {
    const counts = new Map<string, number>();
    for (const item of other) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
    return items.flatMap(item => {
      const count = counts.get(item.key) ?? 0;
      if (!count) return [item.label];
      counts.set(item.key, count - 1);
      return [];
    });
  }
  return { source: unmatched(original, draft), translation: unmatched(draft, original) };
}
