const maxPassageLength = 420;
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const sentenceEnding = /[.!?。！？]["'”’»」』】)\]}]*\s*$/u;

/** Saved passage indexes depend on the document's original splitting rule. */
export function readingPassages(source: string, version: 1 | 2 = 2): string[] {
  if (version === 1) return legacyReadingPassages(source);
  const sentences = sentenceSegmenter.segment(source)[Symbol.iterator]();
  let next = sentences.next();
  const result: string[] = [];
  let start = 0;
  while (start < source.length) {
    const limit = Math.min(start + maxPassageLength, source.length);
    let sentenceEnd = start;
    while (!next.done && next.value.index + next.value.segment.length <= limit) {
      if (sentenceEnding.test(next.value.segment)) sentenceEnd = next.value.index + next.value.segment.length;
      next = sentences.next();
    }
    // PDF extraction can insert soft line breaks inside a sentence.
    let end = limit === source.length ? limit : sentenceEnd;
    if (end === start) {
      const window = source.slice(start, limit);
      const space = [...window.matchAll(/\s+(?=\S)/gu)].at(-1);
      end = space && space.index >= 80 ? start + space.index + space[0].length : limit;
      if (/[\uD800-\uDBFF]/.test(source[end - 1] ?? '')) end--;
    }
    result.push(source.slice(start, end));
    start = end;
  }
  return result;
}

function legacyReadingPassages(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + maxPassageLength, source.length);
    if (end < source.length) {
      const part = source.slice(start, end);
      const paragraph = part.lastIndexOf('\n\n');
      const sentence = [...part.matchAll(/[.!?。][\s]+/g)].at(-1);
      if (paragraph >= 80) end = start + paragraph + 2;
      else if (sentence && sentence.index >= 80) end = start + sentence.index + sentence[0].length;
      else if (part.lastIndexOf('\n') >= 80) end = start + part.lastIndexOf('\n') + 1;
      if (/[\uD800-\uDBFF]/.test(source[end - 1] ?? '')) end--;
    }
    result.push(source.slice(start, end));
    start = end;
  }
  return result;
}

export function speechText(source: string): string {
  return source.replace(/^[ \t]*(```[^\n]*|~~~[^\n]*)[ \t]*(?:\r?\n|$)/gm, '')
    .replace(/^#{1,6}\s+/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '')
    .replace(/^\s*>\s?/gm, '').trim();
}

export function validateSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\x7f]/.test(value)) throw new Error('출처 URL이 잘못되었습니다.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('올바른 문서 URL을 입력하세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('출처는 계정 정보가 없는 HTTP(S) 주소여야 합니다.');
  return url.href;
}
