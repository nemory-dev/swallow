import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { OllamaProvider, validateOllamaEndpoint } from '../electron/ollama.js';
import { StudyCoach } from '../electron/coach.js';
import { createDocument } from '../src/learning/document.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const digest = 'a'.repeat(64);
const local = { name: 'fixture:latest', model: 'fixture:latest', digest, size: 1024, details: { format: 'gguf', family: 'llama' } };
const metadata = { details: local.details, model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 }, capabilities: ['completion'] };
async function fixture(handler?: (req: IncomingMessage, res: ServerResponse, body: any) => boolean) {
  const calls: { path: string; body: any }[] = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ path: req.url!, body });
    if (handler?.(req, res, body)) return;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/version') res.end(JSON.stringify({ version: '0.12.0' }));
    else if (req.url === '/api/tags') res.end(JSON.stringify({ models: [local] }));
    else if (req.url === '/api/show') res.end(JSON.stringify(metadata));
    else res.end(JSON.stringify({ model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ overview: '회상 설명', keyPoints: [{ title: '회상', explanation: '떠올립니다.', quote: '회상한다.' }], question: '무엇을 하나요?' }) } }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const endpoint = { host: '127.0.0.1' as const, port: (server.address() as { port: number }).port };
  const provider = new OllamaProvider();
  cleanups.push(() => provider.dispose());
  await provider.connect(endpoint);
  return { provider, calls, endpoint, server };
}
const request = (model: string, signal?: AbortSignal) => ({ model, input: [{ role: 'developer' as const, content: '코치 지침' }, { role: 'user' as const, content: '자료' }], responseSchema: { type: 'object', additionalProperties: false }, responseLanguage: 'ko' as const, signal });
describe('Ollama loopback 계약', () => {
  it('고정 loopback 호스트와 정수 포트만 받는다', () => {
    expect(validateOllamaEndpoint({ host: '127.0.0.1', port: 11434 })).toEqual({ host: '127.0.0.1', port: 11434 });
    expect(validateOllamaEndpoint({ host: '::1', port: 65535 }).host).toBe('::1');
    for (const host of ['localhost', '127.1', '2130706433', '0.0.0.0', '192.168.0.1', 'example.com', '[::1]', '127.0.0.1/path']) expect(() => validateOllamaEndpoint({ host, port: 11434 })).toThrow();
    for (const port of [0, 65536, 1.2, '11434', NaN]) expect(() => validateOllamaEndpoint({ host: '127.0.0.1', port })).toThrow();
    expect(() => validateOllamaEndpoint({ host: '127.0.0.1', port: 11434, url: 'https://example.com' })).toThrow();
  });
  it('system/user·schema·stream:false만 전송하고 원문 검증을 유지한다', async () => {
    const { provider, calls } = await fixture();
    const model = provider.state.models[0]!;
    expect(model.providerId).toBe('ollama'); expect(model.slug).not.toContain(local.name);
    const coach = new StudyCoach(provider);
    const doc = createDocument({ title: '회상', source: '회상한다.', goal: '' });
    await expect(coach.run('guide', doc, doc.units[0]!.id, () => {}, model.slug)).resolves.toMatchObject({ overview: '회상 설명' });
    const body = calls.find(call => call.path === '/api/chat')!.body;
    expect(body.stream).toBe(false); expect(body.format.additionalProperties).toBe(false);
    expect(body.messages.map((message: any) => message.role)).toEqual(['system', 'user']);
    expect(body).not.toHaveProperty('tools'); expect(body).not.toHaveProperty('images');
    expect(calls.filter(call => call.path === '/api/show')).toHaveLength(1);
  });
  it.each([
    { ...metadata, remote_host: 'https://ollama.com' }, { ...metadata, remote_model: 'cloud' },
    { ...metadata, capabilities: ['embedding'] }, { ...metadata, model_info: {} }, { ...metadata, details: { format: 'unknown' } },
  ])('cloud·completion 없음·확인 불가 metadata는 chat 전에 거절한다', async show => {
    const { provider, calls } = await fixture((req, res) => { if (req.url !== '/api/show') return false; res.end(JSON.stringify(show)); return true; });
    await expect(provider.streamResponse(request(provider.state.models[0]!.slug))).rejects.toThrow();
    expect(calls.some(call => call.path === '/api/chat')).toBe(false);
  });
  it('cloud 별칭은 tags의 remote metadata로 걸러낸다', async () => {
    const { provider } = await fixture((req, res) => { if (req.url !== '/api/tags') return false; res.end(JSON.stringify({ models: [{ ...local, remote_model: 'remote' }] })); return true; });
    expect(provider.state.models).toEqual([]); expect(provider.state.status).toBe('unavailable');
  });
  it('빈 목록과 지원 미확인 버전을 구분한다', async () => {
    const empty = await fixture((req, res) => { if (req.url !== '/api/tags') return false; res.end('{"models":[]}'); return true; });
    expect(empty.provider.state.message).toContain('모델');
    const unknown = await fixture((req, res) => { if (req.url !== '/api/version') return false; res.end('{"version":"99.0.0"}'); return true; });
    expect(unknown.provider.state.status).toBe('error'); expect(unknown.provider.state.models).toEqual([]);
  });
  it('digest 교체 시 선택 ID를 바꾸고 이전 ID로 생성하지 않는다', async () => {
    let changed = false;
    const { provider, calls } = await fixture((req, res) => { if (req.url !== '/api/tags' || !changed) return false; res.end(JSON.stringify({ models: [{ ...local, digest: 'b'.repeat(64) }] })); return true; });
    const slug = provider.state.models[0]!.slug; changed = true;
    await expect(provider.streamResponse(request(slug))).rejects.toThrow('변경');
    expect(calls.some(call => call.path === '/api/chat')).toBe(false);
    await provider.refresh(); expect(provider.state.models[0]!.slug).not.toBe(slug);
  });
  it('redirect를 따라가지 않고 오류 본문을 노출하지 않는다', async () => {
    const { provider, calls } = await fixture((req, res) => { if (req.url !== '/api/chat') return false; res.writeHead(302, { Location: 'https://example.com' }); res.end('SECRET'); return true; });
    await expect(provider.streamResponse(request(provider.state.models[0]!.slug))).rejects.toThrow('응답');
    expect(calls.at(-1)!.path).toBe('/api/chat');
  });
  it('취소와 전체 timeout으로 연결을 닫는다', async () => {
    const { provider, calls } = await fixture((req) => req.url === '/api/chat');
    const controller = new AbortController();
    const result = provider.streamResponse(request(provider.state.models[0]!.slug, controller.signal));
    const rejected = expect(result).rejects.toThrow('취소');
    while (!calls.some(call => call.path === '/api/chat')) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort(); await rejected;
    const timed = new OllamaProvider(undefined, { request: 25 }); cleanups.push(() => timed.dispose());
    await timed.connect(provider.state.endpoint);
    await expect(timed.streamResponse(request(timed.state.models[0]!.slug))).rejects.toThrow('시간');
  });
  it('서버 중단·응답 손상·과대 응답은 실패한다', async () => {
    const broken = await fixture((req, res) => { if (req.url !== '/api/chat') return false; res.end('{'); return true; });
    await expect(broken.provider.streamResponse(request(broken.provider.state.models[0]!.slug))).rejects.toThrow();
    const large = await fixture((req, res) => { if (req.url !== '/api/chat') return false; res.end('x'.repeat(2 * 1024 * 1024 + 1)); return true; });
    await expect(large.provider.streamResponse(request(large.provider.state.models[0]!.slug))).rejects.toThrow();
    const stopped = await fixture(); stopped.server.closeAllConnections(); await new Promise<void>(resolve => stopped.server.close(() => resolve()));
    await expect(stopped.provider.streamResponse(request(stopped.provider.state.models[0]!.slug))).rejects.toThrow();
  });
  it('현재 공식 릴리스 0.40.4의 텍스트 계약도 같은 검증을 통과한다', async () => {
    const { provider } = await fixture((req, res) => { if (req.url !== '/api/version') return false; res.end('{"version":"0.40.4"}'); return true; });
    expect(provider.state.status).toBe('ready');
    const doc = createDocument({ title: '회상', source: '회상한다.', goal: '' });
    await expect(new StudyCoach(provider).run('guide', doc, doc.units[0]!.id, () => {}, provider.state.models[0]!.slug)).resolves.toMatchObject({ overview: '회상 설명' });
  });
  it('실제 설치 버전 0.24.0에서 가이드와 피드백을 전송하고 원격 모델은 계속 차단한다', async () => {
    const { provider, calls } = await fixture((req, res, body) => {
      if (req.url === '/api/version') { res.end('{"version":"0.24.0"}'); return true; }
      if (req.url === '/api/chat' && body.format.properties.assessment) {
        if (body.format.properties.assessment.maxLength > 2000) { res.writeHead(500); res.end('grammar repetition limit'); }
        else res.end(JSON.stringify({ model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ assessment: '원문과 맞습니다.', missingPoints: [], nextStep: '한 번 더 떠올리세요.' }) } }));
        return true;
      }
      return false;
    });
    expect(provider.state.status).toBe('ready');
    const doc = createDocument({ title: '회상', source: '회상한다.', goal: '' });
    doc.recalls[doc.units[0]!.id] = { answer: '기억을 꺼냅니다.', savedAt: new Date().toISOString() };
    const coach = new StudyCoach(provider), model = provider.state.models[0]!.slug;
    await expect(coach.run('guide', doc, doc.units[0]!.id, () => {}, model)).resolves.toMatchObject({ overview: '회상 설명' });
    await expect(coach.run('feedback', doc, doc.units[0]!.id, () => {}, model)).resolves.toMatchObject({ assessment: '원문과 맞습니다.' });
    for (const call of calls.filter(call => call.path === '/api/chat')) expect(call.body).toMatchObject({ truncate: false, shift: false });
    const remote = await fixture((req, res) => {
      if (req.url === '/api/version') { res.end('{"version":"0.24.0"}'); return true; }
      if (req.url === '/api/show') { res.end(JSON.stringify({ ...metadata, remote_host: 'https://ollama.com' })); return true; }
      return false;
    });
    await expect(remote.provider.streamResponse(request(remote.provider.state.models[0]!.slug))).rejects.toThrow();
    expect(remote.calls.some(call => call.path === '/api/chat')).toBe(false);
  });
  it('JSON schema 위반·미완료 응답·도구 호출을 저장 전에 거절한다', async () => {
    for (const result of [
      { model: local.name, done: false, done_reason: 'length', message: { role: 'assistant', content: '{}' } },
      { model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{"extra":true}' } },
      { model: local.name, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{}', tool_calls: [{}] } },
    ]) {
      const { provider } = await fixture((req, res) => { if (req.url !== '/api/chat') return false; res.end(JSON.stringify(result)); return true; });
      await expect(provider.streamResponse(request(provider.state.models[0]!.slug))).rejects.toThrow();
    }
  });
  it('응답 수신 후 body idle timeout을 적용한다', async () => {
    const { endpoint } = await fixture((req, res) => { if (req.url !== '/api/chat') return false; res.writeHead(200); res.flushHeaders(); res.write('{'); return true; });
    const provider = new OllamaProvider(undefined, { idle: 25 }); cleanups.push(() => provider.dispose()); await provider.connect(endpoint);
    await expect(provider.streamResponse(request(provider.state.models[0]!.slug))).rejects.toThrow('수신 시간');
  });
  it('긴 입력은 일부를 자르지 않고 chat 전에 거절한다', async () => {
    const { provider, calls } = await fixture();
    const options = request(provider.state.models[0]!.slug); options.input[1]!.content = '한'.repeat(12001);
    await expect(provider.streamResponse(options)).rejects.toThrow('입력'); expect(calls.some(call => call.path === '/api/chat')).toBe(false);
  });
  it('연결 주소만 저장하고 재시작 시 자동 추론하지 않는다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swallow-ollama-settings-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
    const { endpoint } = await fixture(); const path = join(root, 'ollama.json');
    const first = new OllamaProvider(path); cleanups.push(() => first.dispose()); await first.connect(endpoint);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, enabled: true, endpoint });
    const second = new OllamaProvider(path); cleanups.push(() => second.dispose()); await second.initialize();
    expect(second.state.endpoint).toEqual(endpoint); expect(second.state.status).toBe('disconnected');
    await second.refresh(); expect(second.state.status).toBe('ready');
    await second.disconnect(); expect(JSON.parse(await readFile(path, 'utf8')).enabled).toBe(false);
  });
  it('손상된 설정은 보존하고 저장 권한 실패를 오류로 보고한다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'swallow-ollama-settings-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'ollama.json'); await writeFile(path, '{broken');
    const damaged = new OllamaProvider(path); cleanups.push(() => damaged.dispose()); await damaged.initialize();
    expect(damaged.state.status).toBe('error'); expect(await readFile(path, 'utf8')).toBe('{broken');
    const blocked = new OllamaProvider(join(path, 'child')); cleanups.push(() => blocked.dispose());
    await expect(blocked.connect({ host: '127.0.0.1', port: 11434 })).rejects.toThrow('저장'); expect(blocked.state.status).toBe('disconnected');
  });
  it('프록시 환경변수가 있어도 직접 loopback에 연결한다', async () => {
    const old = process.env.HTTP_PROXY; process.env.HTTP_PROXY = 'http://127.0.0.1:1';
    try { const { provider } = await fixture(); expect(provider.state.status).toBe('ready'); }
    finally { if (old === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = old; }
  });
});
