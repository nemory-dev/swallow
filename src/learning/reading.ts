/** Small reading turns preserve the source exactly, including code and Unicode. */
export function readingPassages(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + 420, source.length);
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
