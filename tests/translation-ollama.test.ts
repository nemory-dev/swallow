import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { OllamaProvider } from '../electron/ollama.js';
import { SourceTranslator } from '../electron/translation.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
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
      const source = JSON.parse(body.messages[1].content).source;
      response.end(JSON.stringify({ model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ translation: source }) } }));
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
  it.each(['x', '한'.repeat(420), 'a'.repeat(420), '😀한글'.repeat(140), '\u0001"\\\n'.repeat(105)])('입력과 JSON escape를 보존하며 provider 문맥 예산을 지킨다 (%#)', async source => {
    const { provider, requests } = await fixture();
    const translator = new SourceTranslator(provider);
    expect(await translator.translate(source, 'ko', provider.state.models[0]!.slug, new AbortController().signal)).toBe(source);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.map(messages => JSON.parse(messages[1]!.content).source).join('')).toBe(source);
    for (const messages of requests) {
      expect(Buffer.byteLength(JSON.stringify(messages), 'utf8') + 3072).toBeLessThanOrEqual(4096);
      const part = JSON.parse(messages[1]!.content).source as string;
      expect(part.length).toBeLessThanOrEqual(420);
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(512);
      expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });
});
