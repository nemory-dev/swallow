import { TRANSLATION_LITERALS } from '../src/learning/translation.js';
import { PublicError } from '../src/shared/public-errors.js';

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Protect technical spans and optionally mark the original sentence boundaries. */
export function protectTranslationLiterals(source: string, alignSentences = false) {
  let prefix = '__SWA_';
  while (source.includes(prefix)) prefix += '_';
  const values: string[] = [];
  const protect = (value: string) => { const token = `${prefix}${values.length}__`; values.push(value); return token; };
  const masked = source.replace(TRANSLATION_LITERALS, protect);
  let marked = '', start = 0;
  if (alignSentences) {
    // Mask technical spans before segmenting and attach blank lines to their neighbors.
    for (const { segment, index } of segmenter.segment(masked)) {
      if (!segment.trim() || !masked.slice(start, index).trim()) continue;
      marked += masked.slice(start, index) + protect('');
      start = index;
    }
  }
  const text = (marked + masked.slice(start)).replace(/[ \t]*\r?\n[ \t]*/g, protect);
  const tokens = new RegExp(`${prefix}\\d+__`, 'g');
  const valueOf = (token: string) => values[Number(token.slice(prefix.length, -2))]!;
  const matches = (value: string) => value.match(tokens) ?? [];
  const prose = (value: string) => value.replace(tokens, '');
  const verify = (value: string, original = text) => {
    if (JSON.stringify(matches(value)) !== JSON.stringify(matches(original)) || prose(value).includes(prefix))
      throw new PublicError('public.translationIntegrity');
  };
  function splitAtSentenceBreaks(value: string): string[] {
    const parts: string[] = [];
    let offset = 0;
    for (const match of value.matchAll(tokens)) {
      const token = match[0];
      if (valueOf(token) !== '') continue;
      parts.push(value.slice(offset, match.index), token);
      offset = match.index + token.length;
    }
    parts.push(value.slice(offset));
    return parts;
  }
  function restore(value: string, original = text): string {
    verify(value, original);
    return value.replace(tokens, valueOf);
  }
  function sentences(value: string): string[] {
    verify(value);
    return splitAtSentenceBreaks(value).filter((_, index) => index % 2 === 0).map(part => part.replace(tokens, valueOf));
  }
  return { text, tokens, prose, verify, restore, sentences, splitAtSentenceBreaks };
}
