import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SignJWT } from 'jose';
import { ChatGPTAuth, ChatGPTTransport, httpFailure } from '../electron/chatgpt-auth.js';
import { ChatGPTProvider } from '../electron/chatgpt.js';
import { CHATGPT_CONSENT_VERSION } from '../src/shared/chatgpt.js';

const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of disposals.splice(0).reverse()) await cleanup(); });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = randomBytes(32);
const protection = {
  available: () => true,
  encrypt(text: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  },
  decrypt(bytes: Buffer) {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
  },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const stream = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'swallow-chatgpt-test-'));
  disposals.push(() => rm(directory, { recursive: true, force: true }));
  const calls: { url: string; body: string; headers: Headers }[] = [];
  const urls: URL[] = [];
  let authUrl: URL;
  const options = { scope: 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct',
    subject: 'test-subject', nonce: undefined as string | undefined, audience: 'oaiapp_fixture', expiry: 3600,
    deny: false, badState: false, wait: false, failRefresh: false, revokeFails: false, omitCompleted: false, modelStatus: 200, issuer: 'https://auth.openai.com', expiredIdentity: false, badSignature: false, refreshToken: 'REFRESH_SECRET', refreshWait: undefined as Promise<void> | undefined, splitCrLf: false, streamLimit: false, issuedClient: 'oaiapp_fixture' };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input), body = String(init?.body ?? '');
    calls.push({ url, body, headers: new Headers(init?.headers) });
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke' });
    if (url.endsWith('/jwks')) return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' }] });
    if (url.endsWith('/oauth/token')) {
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token' && options.failRefresh) return json({ error: 'invalid_grant', error_description: 'SECRET_DETAIL' }, 400);
      if (new URLSearchParams(body).get('grant_type') === 'refresh_token') await options.refreshWait;
      let id = await new SignJWT({ email: 'test@example.invalid', nonce: options.nonce ?? authUrl.searchParams.get('nonce') })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(options.issuer)
        .setAudience(options.audience).setIssuedAt().setSubject(options.subject).setExpirationTime(options.expiredIdentity ? '1 second ago' : '1h').sign(privateKey);
      if (options.badSignature) { const parts = id.split('.'); parts[2] = 'A'.repeat(parts[2]!.length); id = parts.join('.'); }
      return json({ access_token: 'ACCESS_SECRET', refresh_token: options.refreshToken, id_token: id, token_type: 'Bearer', expires_in: options.expiry, scope: options.scope });
    }
    if (url.endsWith('/models')) return options.modelStatus === 200
      ? json({ models: [{ slug: 'fixture-model', display_name: 'Fixture', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }] })
      : json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'SECRET_DETAIL' } }, options.modelStatus);
    if (url.endsWith('/responses') && options.streamLimit) return stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'SECRET_DETAIL' } } }]);
    if (url.endsWith('/responses') && options.splitCrLf) {
      const data = [{ type: 'response.output_text.delta', delta: '한글 결과' }, { type: 'response.completed', response: { status: 'completed' } }].map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
      return new Response(new ReadableStream({ start(controller) { for (const byte of new TextEncoder().encode(data)) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.endsWith('/responses')) return stream([
      { type: 'response.output_text.delta', delta: '{"ok":true}' },
      ...options.omitCompleted ? [] : [{ type: 'response.completed', response: { status: 'completed' } }],
    ]);
    if (url.endsWith('/revoke')) return options.revokeFails ? json({}, 503) : new Response(null, { status: 200 });
    throw new Error('Unexpected URL');
  };
  const openExternal = async (url: string) => {
    authUrl = new URL(url); urls.push(authUrl);
    if (options.wait) return;
    const callback = new URL(authUrl.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authUrl.searchParams.get('state')!);
    callback.searchParams.set('client_id', options.issuedClient);
    if (options.deny) callback.searchParams.set('error', 'access_denied'); else callback.searchParams.set('code', 'CODE_SECRET');
    if (options.badState) {
      const wrong = new URL(callback); wrong.searchParams.set('state', 'wrong');
      expect((await fetch(wrong)).status).toBe(400);
    }
    await fetch(callback);
  };
  const config = { directory, protection, openExternal, fetcher, loginTimeoutMs: 1000 };
  const provider = new ChatGPTProvider(config);
  disposals.push(() => provider.dispose());
  await provider.initialize();
  return { provider, options, calls, urls, directory, config };
}

describe('공식 ChatGPT 구독 연결', () => {
  it('추론 실패 진단은 상태·오류 코드·필드만 노출하고 새 확인 시 지운다', async () => {
    const { config } = await fixture();
    const provider = new ChatGPTProvider({ ...config, fetcher: async (url, init) => String(url).endsWith('/responses')
      ? json({ error: { code: 'invalid_json_schema', param: 'text.format.schema', message: 'PRIVATE_SOURCE ACCESS_SECRET' } }, 400)
      : config.fetcher(url, init) });
    disposals.push(() => provider.dispose()); await provider.initialize(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    await expect(provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'source' })).rejects.toThrow();
    expect(provider.state.diagnostic).toMatchObject({ phase: 'request', status: 400, code: 'invalid_json_schema', param: 'text.format.schema' });
    expect(JSON.stringify(provider.state)).not.toMatch(/PRIVATE_SOURCE|ACCESS_SECRET/);
    await provider.refresh(); expect(provider.state.diagnostic).toBeUndefined();
  });
  it('오류 필드에 임의 문자열이나 비밀값이 들어오면 진단에서 제외한다', () => {
    expect(httpFailure(400, { error: { param: 'Bearer SECRET', code: '<SECRET>' } }, 'Bearer SECRET').diagnostic)
      .toEqual({ status: 400, code: undefined, param: undefined, requestId: undefined });
  });
  it('HTTP 200의 비스트림 응답은 본문 대신 형식만 진단한다', async () => {
    const { config } = await fixture();
    const provider = new ChatGPTProvider({ ...config, fetcher: async (url, init) => String(url).endsWith('/responses')
      ? json({ output: 'PRIVATE_SOURCE' }) : config.fetcher(url, init) });
    disposals.push(() => provider.dispose()); await provider.initialize(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    await expect(provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'source' })).rejects.toThrow();
    expect(provider.state.diagnostic).toMatchObject({ status: 200, contentType: 'application/json', bodyFormat: 'json' });
    expect(JSON.stringify(provider.state)).not.toContain('PRIVATE_SOURCE');
  });
  it('Content-Type이 없는 실제 SSE도 완료 이벤트까지 검증하고 중단 응답은 거부한다', async () => {
    const { config, options } = await fixture();
    const provider = new ChatGPTProvider({ ...config, fetcher: async (url, init) => {
      const result = await config.fetcher(url, init);
      return String(url).endsWith('/responses') ? new Response(result.body, { status: result.status }) : result;
    } });
    disposals.push(() => provider.dispose()); await provider.initialize(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    const request = { model: provider.state.models[0]!.slug, input: 'source' };
    expect(await provider.streamResponse(request)).toEqual({ text: '{"ok":true}' });
    options.omitCompleted = true; await expect(provider.streamResponse(request)).rejects.toThrow();
  });
  it.each(['{"output":"not SSE"}', '<html>not SSE</html>'])('헤더가 없더라도 비스트림 본문은 성공으로 처리하지 않는다: %s', async body => {
    const { config } = await fixture();
    const provider = new ChatGPTProvider({ ...config, fetcher: async (url, init) => String(url).endsWith('/responses')
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }))
      : config.fetcher(url, init) });
    disposals.push(() => provider.dispose()); await provider.initialize(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    await expect(provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'source' })).rejects.toThrow();
    expect(provider.state.error).toBe('public.chatgptResponse');
  });
  it('명시 동의와 OS 암호화 없이 브라우저나 인증 요청을 시작하지 않는다', async () => {
    const { provider, urls, calls, config } = await fixture();
    await expect(provider.signIn('incorrect')).rejects.toThrow();
    expect(urls).toHaveLength(0); expect(calls).toHaveLength(0);
    const locked = new ChatGPTProvider({ ...config, protection: { ...protection, available: () => false } });
    await locked.initialize();
    await expect(locked.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(urls).toHaveLength(0);
  });
  it('시작은 OS 키 저장소를 열지 않고 명시적 연결 때만 접근한다', async () => {
    const { config } = await fixture(); let touched = 0;
    const provider = new ChatGPTProvider({ ...config, protection: { ...protection, available: async () => { touched++; return true; } } });
    disposals.push(() => provider.dispose()); await provider.initialize();
    expect(touched).toBe(0);
    await provider.signIn(CHATGPT_CONSENT_VERSION); expect(touched).toBeGreaterThan(0);
  });
  it('PKCE·발급 client ID·scope를 사용하고 토큰은 암호문에만 저장한다', async () => {
    const { provider, urls, calls, directory } = await fixture();
    await provider.signIn(CHATGPT_CONSENT_VERSION);
    expect(urls[0]!.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(urls[0]!.searchParams.get('agent_name_hint')).toBe('Swallow');
    expect(urls[0]!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(new URLSearchParams(calls.find(c => c.url.endsWith('/oauth/token'))!.body).get('client_id')).toBe('oaiapp_fixture');
    expect(provider.state.status).toBe('ready'); expect(provider.state.models).toHaveLength(1);
    expect(provider.state.firstUsePending).toBe(true);
    expect(JSON.stringify(provider.state)).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET|id_token|subject/);
    for (const file of await readdir(directory)) expect((await readFile(join(directory, file))).toString()).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET|test@example/);
    await provider.acknowledgeFirstUse(); expect(provider.state.firstUsePending).toBe(false);
  });
  it('잘못된 state callback을 거부하고 유효 callback을 계속 기다린다', async () => {
    const { provider, options } = await fixture(); options.badState = true;
    await provider.signIn(CHATGPT_CONSENT_VERSION); expect(provider.state.status).toBe('ready');
  });
  it.each(['nonce', 'audience'] as const)('%s 검증 실패 시 연결하지 않는다', async field => {
    const { provider, options } = await fixture(); options[field] = 'wrong';
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(provider.state.models).toHaveLength(0);
  });
  it.each(['issuer', 'expiredIdentity', 'badSignature'] as const)('%s가 유효하지 않으면 계정 토큰을 저장하지 않는다', async field => {
    const { provider, options, calls } = await fixture();
    if (field === 'issuer') options.issuer = 'https://other.invalid'; else options[field] = true;
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(provider.state.accounts.every(account => !account.connected)).toBe(true);
    expect(calls.some(call => call.url.endsWith('/models'))).toBe(false);
  });
  it('동시에 만료 토큰을 요청해도 갱신은 한 번만 하고 회전 토큰을 저장한다', async () => {
    const { provider, options, calls, config, directory } = await fixture(); options.expiry = 1;
    await provider.signIn(CHATGPT_CONSENT_VERSION); options.expiry = 3600; options.refreshToken = 'ROTATED_REFRESH';
    const auth = new ChatGPTAuth(directory, protection, new ChatGPTTransport(config.fetcher)); await auth.initialize();
    const count = calls.length;
    await Promise.all([auth.access(), auth.access(), auth.access()]);
    expect(calls.slice(count).filter(call => call.url.endsWith('/oauth/token'))).toHaveLength(1);
    const stored = JSON.parse(protection.decrypt(await readFile(join(directory, 'credentials.enc'))));
    expect(stored.accounts[0].tokens.refresh).toBe('ROTATED_REFRESH');
  });
  it('추론 취소와 refresh 회전이 겹쳐도 새 토큰은 보존하고 추론은 보내지 않는다', async () => {
    const { provider, options, calls, directory } = await fixture(); options.expiry = 1;
    await provider.signIn(CHATGPT_CONSENT_VERSION); options.expiry = 3600; options.refreshToken = 'ROTATED_ON_CANCEL';
    let finish!: () => void; options.refreshWait = new Promise(resolve => { finish = resolve; });
    const count = calls.length;
    const request = provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'x' });
    const rejected = expect(request).rejects.toThrow();
    while (calls.length === count) await new Promise(resolve => setTimeout(resolve, 1));
    provider.cancel(); finish(); await rejected;
    const stored = JSON.parse(protection.decrypt(await readFile(join(directory, 'credentials.enc'))));
    expect(stored.accounts[0].tokens.refresh).toBe('ROTATED_ON_CANCEL');
    expect(calls.slice(count).some(call => call.url.endsWith('/responses'))).toBe(false);
  });
  it('구독 권한이 없으면 계정은 보존하되 모델·추론 요청을 차단한다', async () => {
    const { provider, options, calls } = await fixture(); options.scope = 'openid profile email';
    await provider.signIn(CHATGPT_CONSENT_VERSION);
    expect(provider.state.status).toBe('needs-consent');
    expect(provider.state.accounts).toHaveLength(1); expect(calls.some(c => c.url.endsWith('/models'))).toBe(false);
    await expect(provider.streamResponse({ model: 'chatgpt:fixture-model', input: 'x' })).rejects.toThrow();
  });
  it('동의 거절과 취소가 token exchange를 하지 않는다', async () => {
    const { provider, options, calls } = await fixture(); options.deny = true;
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(calls.some(c => c.url.endsWith('/oauth/token'))).toBe(false);
    options.deny = false; options.wait = true;
    const pending = provider.signIn(CHATGPT_CONSENT_VERSION); const rejected = expect(pending).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 20)); provider.cancelSignIn(); await rejected;
  });
  it('재시작은 네트워크 없이 복원하고 재인증은 기존 client/host를 재사용한다', async () => {
    const { provider, config, calls, urls } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    const activeId = provider.state.activeAccountId!; const host = urls[0]!.searchParams.get('ext_agent_host_id');
    await provider.acknowledgeFirstUse(); provider.dispose(); calls.length = 0;
    const reopened = new ChatGPTProvider(config); disposals.push(() => reopened.dispose()); await reopened.initialize();
    expect(calls).toHaveLength(0); expect(reopened.state.models).toHaveLength(0);
    await reopened.signIn(CHATGPT_CONSENT_VERSION, activeId);
    expect(urls[1]!.searchParams.get('client_id')).toBe('oaiapp_fixture');
    expect(urls[1]!.searchParams.has('agent_name_hint')).toBe(false);
    expect(urls[1]!.searchParams.get('ext_agent_host_id')).toBe(host);
    expect(reopened.state.firstUsePending).toBe(false);
  });
  it('구독 Responses 계약으로 요청하고 완료 이벤트 없는 출력은 저장용 결과로 반환하지 않는다', async () => {
    const { provider, calls, options } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    const request = { model: provider.state.models[0]!.slug, input: 'source', instructions: 'Return JSON' };
    expect(await provider.streamResponse(request)).toEqual({ text: '{"ok":true}' });
    const body = JSON.parse(calls.find(c => c.url.endsWith('/responses'))!.body);
    expect(body).toMatchObject({ model: 'fixture-model', store: false, stream: true, input: [{ role: 'user', content: 'source' }] });
    expect(body).not.toHaveProperty('max_output_tokens');
    options.omitCompleted = true; await expect(provider.streamResponse(request)).rejects.toThrow();
  });
  it('만료 refresh 실패는 토큰을 지우고 재로그인을 요구한다', async () => {
    const { provider, options } = await fixture(); options.expiry = 1;
    await provider.signIn(CHATGPT_CONSENT_VERSION); options.failRefresh = true;
    await expect(provider.refresh()).rejects.toThrow();
    expect(provider.state.status).toBe('disconnected'); expect(provider.state.accounts).toHaveLength(1);
    expect(provider.state.models).toHaveLength(0);
  });
  it('모델 권한 확인에 실패한 로그인은 최초 사용 환영을 표시하지 않는다', async () => {
    const { provider, options } = await fixture(); options.modelStatus = 403;
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(provider.state.firstUsePending).toBe(false);
    options.modelStatus = 200; await provider.refresh();
    expect(provider.state.firstUsePending).toBe(true);
  });
  it('한도 오류는 원문 오류를 노출하거나 다른 결제 경로로 전환하지 않는다', async () => {
    const { provider, options } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION); options.modelStatus = 429;
    await expect(provider.refresh()).rejects.toThrow();
    expect(provider.state.error).toBe('public.chatgptLimit'); expect(JSON.stringify(provider.state)).not.toContain('SECRET_DETAIL');
    expect(provider.state.models).toHaveLength(0);
  });
  it('UTF-8와 CRLF가 네트워크 조각 사이에 갈려도 완료를 읽는다', async () => {
    const { provider, options } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION); options.splitCrLf = true;
    expect(await provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'x' })).toEqual({ text: '한글 결과' });
  });
  it('HTTP 200 스트림 내부의 구독 한도 오류도 구분한다', async () => {
    const { provider, options } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION); options.streamLimit = true;
    await expect(provider.streamResponse({ model: provider.state.models[0]!.slug, input: 'x' })).rejects.toThrow();
    expect(provider.state.error).toBe('public.chatgptLimit'); expect(JSON.stringify(provider.state)).not.toContain('SECRET_DETAIL');
  });
  it('돌아오지 않는 브라우저 실행도 로그인 제한 시간이 끝나면 취소한다', async () => {
    const { config } = await fixture();
    const provider = new ChatGPTProvider({ ...config, openExternal: () => new Promise(() => {}), loginTimeoutMs: 40 });
    disposals.push(() => provider.dispose()); await provider.initialize();
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(provider.state.status).toBe('disconnected');
  }, 1000);
  it('기존 등록을 새 연결 응답으로 덮어쓰거나 중복 등록하지 않는다', async () => {
    const { provider, calls } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    const count = calls.length;
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION)).rejects.toThrow();
    expect(provider.state.accounts).toHaveLength(1);
    expect(calls.slice(count).some(call => call.url.endsWith('/oauth/token'))).toBe(false);
  });
  it('재인증의 다른 client ID와 같은 client의 다른 사용자를 거부한다', async () => {
    const { provider, options } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION);
    const id = provider.state.activeAccountId!;
    options.subject = 'different-person';
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION, id)).rejects.toThrow();
    expect(provider.state.accounts).toHaveLength(1); expect(provider.state.models).toHaveLength(0);
    options.issuedClient = 'other-client';
    await expect(provider.signIn(CHATGPT_CONSENT_VERSION, id)).rejects.toThrow();
    expect(provider.state.activeAccountId).toBe(id);
  });
  it('원격 철회 실패도 로컬 토큰은 지우며 원격 미확인을 알린다', async () => {
    const { provider, options, config } = await fixture(); await provider.signIn(CHATGPT_CONSENT_VERSION); options.revokeFails = true;
    await provider.disconnect();
    expect(provider.state.error).toBe('public.chatgptRevoke'); expect(provider.state.status).toBe('disconnected');
    provider.dispose(); const reopened = new ChatGPTProvider(config); disposals.push(() => reopened.dispose()); await reopened.initialize();
    expect(reopened.state.locked).toBe(true); await reopened.refresh(); expect(reopened.state.accounts[0]!.connected).toBe(false); expect(reopened.state.models).toHaveLength(0);
  });
});
