import { PublicError } from '../src/shared/public-errors.js';

/** Protect technical spans before chunking, so neither chunk boundaries nor the model can edit them. */
export function protectTranslationLiterals(source: string) {
  let prefix = '__SWA_';
  while (source.includes(prefix)) prefix += '_';
  const values: string[] = [];
  const pattern = /^# PDF \d+쪽$|```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|`[^`\n]+`|https?:\/\/[^\s<>`]+|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\b[A-Za-z]\w*(?:[²³]|\^\d+)?(?:[ \t]*[+*/−-][ \t]*[A-Za-z0-9]+)*[ \t]*=[ \t]*[A-Za-z0-9]+(?:[²³]|\^\d+)?(?:[ \t]*[+*/−-][ \t]*[A-Za-z0-9]+)*|[ \t]*\r?\n[ \t]*|[+−-]?\d+(?:[.,]\d+)*(?:%|²|³)?/gm;
  const text = source.replace(pattern, value => { const token = `${prefix}${values.length}__`; values.push(value); return token; });
  const tokens = new RegExp(`${prefix}\\d+__`, 'g');
  const matches = (value: string) => value.match(tokens) ?? [];
  const prose = (value: string) => value.replace(tokens, '');
  return { text, tokens, prose, hasProseNumbers: /\p{Number}/u.test(prose(text)) || values.some(value => /^[+−-]?\d/.test(value)),
    forReview(value: string): string {
      return value.replace(tokens, token => {
        const literal = values[Number(token.slice(prefix.length, -2))]!;
        // Numeric roles and paragraph structure must remain readable to the semantic checker.
        return /^[+−-]?\d/.test(literal) || /^\s+$/u.test(literal) ? literal : token;
      });
    },
    restore(value: string, original = text): string {
      if (JSON.stringify(matches(value)) !== JSON.stringify(matches(original))) throw new PublicError('public.translationIntegrity');
      const result = value.replace(tokens, token => values[Number(token.slice(prefix.length, -2))]!);
      // Original source may contain a shorter, colliding prefix; only the chosen prefix is reserved.
      if (result.includes(prefix)) throw new PublicError('public.translationIntegrity');
      return result;
    },
  };
}
