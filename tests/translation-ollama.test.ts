import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { OllamaProvider } from '../electron/ollama.js';
import { SourceTranslator } from '../electron/translation.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(translate: (source: string, attempt: number) => string = source => source) {
  const requests: { role: string; content: string }[][] = [];
  const local = { name: 'fixture:latest', digest: 'a'.repeat(64), size: 1024, details: { format: 'gguf' } };
  const server = createServer(async (request, response) => {
    let input = '';
    for await (const chunk of request) input += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/version') response.end(JSON.stringify({ version: '0.24.0' }));
    else if (request.url === '/api/tags') response.end(JSON.stringify({ models: [local] }));
    else if (request.url === '/api/show') response.end(JSON.stringify({ details: local.details, capabilities: ['completion'], model_info: { 'general.architecture': 'llama', 'llama.context_length': 4096 } }));
    else if (request.url === '/api/chat') {
      const body = JSON.parse(input);
      requests.push(body.messages);
      if (body.format.properties.verdict) {
        response.end(JSON.stringify({ model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reason: 'Synthetic check', verdict: 'pass' }) } }));
        return;
      }
      const source = JSON.parse(body.messages[1].content).source;
      response.end(JSON.stringify({ model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ translation: translate(source, requests.length) }) } }));
    } else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const provider = new OllamaProvider();
  cleanups.push(() => provider.dispose());
  await provider.connect({ host: '127.0.0.1', port: (server.address() as { port: number }).port });
  return { provider, requests };
}

describe('4096 context Ollama 번역 통합', () => {
  it('긴 생성 결과에도 의미 대조 요청을 추가하지 않는다', async () => {
    const { provider, requests } = await fixture(source => '캐시는 복사본을 저장해 반복 조회를 빠르게 할 수 있고 오래된 값이 남을 수 있습니다. '.repeat(source.length > 150 ? 3 : 1));
    const source = 'A cache stores a copy of data so that repeated reads can be faster. It may retain outdated values, so check freshness before using it. '.repeat(2);
    const result = await new SourceTranslator(provider).translate(source, 'ko', provider.state.models[0]!.slug, new AbortController().signal);
    expect(result).toContain('캐시는');
    expect(requests.filter(messages => JSON.parse(messages[1]!.content).output)).toHaveLength(0);
    for (const messages of requests) expect(Buffer.byteLength(JSON.stringify(messages)) + 3072).toBeLessThanOrEqual(4096);
  });
  it('한국어 언어 재생성도 4096 문맥 예산 안에서 원문을 다시 보낸다', async () => {
    const counts = new Map<string, number>();
    const { provider, requests } = await fixture(source => {
      const count = (counts.get(source) ?? 0) + 1; counts.set(source, count);
      return count === 1 ? '캐시에 陈旧한 값이 있습니다.' : '캐시는 복사본을 저장하며 오래된 값이 남을 수 있습니다.';
    });
    await new SourceTranslator(provider).translate('A cache stores a copy and may become stale. '.repeat(9), 'ko', provider.state.models[0]!.slug, new AbortController().signal);
    expect(requests.some(messages => messages[0]!.content.includes('원문에서 다시'))).toBe(true);
    for (const messages of requests) expect(Buffer.byteLength(JSON.stringify(messages)) + 3072).toBeLessThanOrEqual(4096);
  });
  it.each(['x', '한'.repeat(420), 'a'.repeat(420), '😀한글'.repeat(140), '\u0001"\\\n'.repeat(105)])('입력과 JSON escape를 보존하며 provider 문맥 예산을 지킨다 (%#)', async source => {
    const { provider, requests } = await fixture();
    const translator = new SourceTranslator(provider);
    const language = /[가-힣]/.test(source) ? 'ko' : 'en';
    expect(await translator.translate(source, language, provider.state.models[0]!.slug, new AbortController().signal)).toBe(source);
    expect(requests.length).toBeGreaterThan(0);
    // Original source equality above also covers regeneration after a context-only rejection.
    for (const messages of requests) {
      expect(Buffer.byteLength(JSON.stringify(messages), 'utf8') + 3072).toBeLessThanOrEqual(4096);
      const part = JSON.parse(messages[1]!.content).source as string;
      expect(part.length).toBeLessThanOrEqual(420);
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(512);
      expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});
