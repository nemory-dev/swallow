import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { PublicError, type PublicErrorCode } from '../src/shared/public-errors.js';

const AUTH = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const TOKEN = AUTH + '/api/accounts/oauth/token';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export interface Protection { available(): boolean | Promise<boolean>; encrypt(value: string): Buffer | Promise<Buffer>; decrypt(value: Buffer): string | Promise<string> }
interface Tokens { access: string; refresh?: string; id: string; scopes: string[]; expiresAt: number }
export interface Registration { id: string; clientId: string; subject?: string; email?: string; tokens?: Tokens }
interface StoredAuth { version: 1; hostId: string; activeId: string | null; welcomed: boolean; accounts: Registration[] }
export class ChatGPTFailure extends PublicError {
  constructor(code: PublicErrorCode, readonly diagnostic?: { status: number; code?: string; param?: string; requestId?: string }) { super(code); }
}
const text = (value: unknown, max = 32_000): value is string => typeof value === 'string' && !!value && value.length <= max;
const safeCode = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : undefined;
export function httpFailure(status: number, body: unknown, requestId: string | null): ChatGPTFailure {
  const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const error = raw.error && typeof raw.error === 'object' ? raw.error as Record<string, unknown> : {};
  const code = safeCode(typeof raw.error === 'string' ? raw.error : error.code);
  const terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'];
  const key = status === 429 || code === 'subscription_sharing_usage_limit_exceeded' ? 'public.chatgptLimit'
    : status === 401 || code === 'subscription_sharing_invalid_user' || terminal.includes(code ?? '') ? 'public.chatgptAuth'
    : status === 403 || ['subscription_sharing_user_not_eligible', 'subscription_sharing_route_not_supported', 'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'].includes(code ?? '') ? 'public.chatgptPermission'
    : status >= 500 || ['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'].includes(code ?? '') ? 'public.chatgptNetwork' : 'public.chatgptResponse';
  const param = typeof error.param === 'string' && /^[a-zA-Z][a-zA-Z0-9_.\[\]]{0,159}$/.test(error.param) ? error.param : undefined;
  return new ChatGPTFailure(key, { status, code, param, requestId: safeCode(requestId) });
}
export async function readLimited(response: Response, limit = 1_000_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); let length = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > limit) throw new PublicError('public.chatgptResponse');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class ChatGPTTransport {
  constructor(readonly fetcher: typeof fetch = fetch) {}
  async request(url: string, init: RequestInit = {}, signal?: AbortSignal, timeout = 15_000): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) });
    } catch { throw new PublicError(signal?.aborted ? 'public.chatgptCancelled' : 'public.chatgptNetwork'); }
  }
  async json(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.request(url, init, signal);
    let body: unknown;
    try { body = JSON.parse(await readLimited(response)); }
    catch { if (!response.ok) throw httpFailure(response.status, {}, response.headers.get('x-request-id')); throw new PublicError('public.chatgptResponse'); }
    if (!response.ok) throw httpFailure(response.status, body, response.headers.get('x-request-id'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError('public.chatgptResponse');
    return body as Record<string, unknown>;
  }
}

export class ChatGPTAuth {
  private data: StoredAuth = { version: 1, hostId: 'urn:uuid:' + randomUUID(), activeId: null, welcomed: false, accounts: [] };
  private usable = false;
  private encrypted?: Buffer;
  private unlocking: Promise<void> | null = null;
  private discovery?: Record<string, unknown>;
  private renewing: Promise<void> | null = null;
  private readonly path: string;
  constructor(private readonly directory: string, private readonly protection: Protection, readonly transport: ChatGPTTransport) {
    this.path = join(directory, 'credentials.enc');
  }
  get locked() { return !!this.encrypted; }
  get accounts() { return this.data.accounts; }
  get active() { return this.data.accounts.find(value => value.id === this.data.activeId); }
  get activeId() { return this.data.activeId; }
  get firstUsePending() { return this.sharing && !this.data.welcomed; }
  get sharing() { return !!this.active?.tokens?.scopes.includes('chatgpt.tokens.use.direct'); }
  async initialize() {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(this.directory)).isDirectory() || (await lstat(this.directory)).isSymbolicLink()) throw new Error('Unsafe storage');
      let bytes: Buffer;
      try {
        const info = await lstat(this.path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1_000_000) throw new Error('Unsafe storage');
        bytes = await readFile(this.path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.usable = true; return; } throw error; }
      this.encrypted = bytes; this.usable = true;
    } catch { throw new PublicError('public.chatgptStorage'); }
  }
  async unlock() {
    if (!this.unlocking) this.unlocking = this.unlockStored().finally(() => { this.unlocking = null; });
    await this.unlocking;
  }
  private async unlockStored() {
    await this.assertUsable();
    if (!this.encrypted) return;
    try {
      const value = JSON.parse(await this.protected(() => this.protection.decrypt(this.encrypted!))) as StoredAuth;
      if (value.version !== 1 || !/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId) || typeof value.welcomed !== 'boolean'
        || !Array.isArray(value.accounts) || value.accounts.length > 20 || (value.activeId !== null && typeof value.activeId !== 'string')) throw new Error('Invalid storage');
      const ids = new Set<string>(), clients = new Set<string>();
      for (const account of value.accounts) {
        if (!text(account.id, 100) || ids.has(account.id) || !text(account.clientId, 200) || clients.has(account.clientId) || account.clientId === 'dynamic_agent_client'
          || (account.subject !== undefined && !text(account.subject, 300)) || (account.email !== undefined && !text(account.email, 320))) throw new Error('Invalid registration');
        ids.add(account.id); clients.add(account.clientId);
        if (account.tokens && (!account.subject || !text(account.tokens.access) || !text(account.tokens.id)
          || (account.tokens.refresh !== undefined && !text(account.tokens.refresh)) || !Array.isArray(account.tokens.scopes)
          || account.tokens.scopes.some(scope => !text(scope, 200)) || !Number.isFinite(account.tokens.expiresAt))) throw new Error('Invalid tokens');
      }
      if (value.activeId !== null && !ids.has(value.activeId)) throw new Error('Invalid active registration');
      this.data = value; this.encrypted = undefined;
      await this.persist(); // Re-encrypt with the current OS key after an explicit unlock.
    } catch { throw new PublicError('public.chatgptStorage'); }
  }
  private async protected<T>(operation: () => T | Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PublicError('public.chatgptStorage')), 30_000);
    })]); } catch { throw new PublicError('public.chatgptStorage'); }
    finally { clearTimeout(timer); }
  }
  async assertUsable() { if (!this.usable || !await this.protected(() => this.protection.available())) throw new PublicError('public.chatgptStorage'); }
  private async persist() {
    await this.assertUsable();
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, await this.protected(() => this.protection.encrypt(JSON.stringify(this.data))), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.path);
    } catch { this.usable = false; throw new PublicError('public.chatgptStorage'); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  private async configuration(signal?: AbortSignal) {
    if (!this.discovery) {
      const result = await this.transport.json(AUTH + '/.well-known/openid-configuration', {}, signal);
      if (result.issuer !== AUTH) throw new PublicError('public.chatgptAuth');
      for (const field of ['jwks_uri', 'revocation_endpoint']) {
        if (!text(result[field], 2048)) throw new PublicError('public.chatgptAuth');
        const url = new URL(result[field]);
        if (url.origin !== AUTH || url.username || url.password || url.hash) throw new PublicError('public.chatgptAuth');
      }
      this.discovery = result;
    }
    return this.discovery;
  }
  private async identity(id: unknown, clientId: string, nonce?: string, signal?: AbortSignal) {
    try {
      if (!text(id)) throw new Error('Missing ID token');
      const config = await this.configuration(signal);
      const keys = await this.transport.json(config.jwks_uri as string, {}, signal);
      const { payload } = await jwtVerify(id, createLocalJWKSet(keys as unknown as JSONWebKeySet), {
        issuer: AUTH, audience: clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'sub', 'iat'],
      });
      if (!text(payload.sub, 300) || (nonce !== undefined && payload.nonce !== nonce)
        || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error('Invalid identity');
      return { subject: payload.sub, ...(typeof payload.email === 'string' && text(payload.email, 320) ? { email: payload.email } : {}) };
    } catch (error) { if (error instanceof PublicError) throw error; throw new PublicError('public.chatgptAuth'); }
  }
  private tokens(raw: Record<string, unknown>, old?: Tokens): Tokens {
    if (!text(raw.access_token) || String(raw.token_type).toLowerCase() !== 'bearer' || typeof raw.expires_in !== 'number'
      || raw.expires_in <= 0 || raw.expires_in > 31_536_000 || !text(raw.id_token ?? old?.id)
      || (raw.refresh_token !== undefined && !text(raw.refresh_token)) || (raw.scope !== undefined && typeof raw.scope !== 'string'))
      throw new PublicError('public.chatgptAuth');
    return { access: raw.access_token, id: (raw.id_token ?? old?.id) as string,
      refresh: (raw.refresh_token ?? old?.refresh) as string | undefined,
      scopes: typeof raw.scope === 'string' ? raw.scope.split(/\s+/).filter(Boolean) : old?.scopes ?? [],
      expiresAt: Date.now() + raw.expires_in * 1000 };
  }
  async signIn(openExternal: (url: string) => Promise<void>, cancellation: AbortSignal, accountId?: string, timeout = 180_000) {
    await this.unlock();
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(timeout)]);
    const saved = accountId === undefined ? undefined : this.accounts.find(account => account.id === accountId);
    if (accountId !== undefined && !saved || !saved && this.accounts.length >= 20) throw new PublicError('public.chatgptAuth');
    await this.persist(); // Persist the host before opening the browser.
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    let redirectUri = '';
    let settle!: (value: { code: string; clientId: string }) => void;
    let reject!: (reason: unknown) => void;
    let handled = false;
    const callback = new Promise<{ code: string; clientId: string }>((resolve, fail) => { settle = resolve; reject = fail; });
    void callback.catch(() => {});
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      const fail = () => { response.writeHead(400); response.end('Invalid callback. Return to Swallow.'); };
      try {
        if (handled || request.method !== 'GET' || request.headers.host !== new URL(redirectUri).host || !request.url || request.url.length > 16_000) return fail();
        const url = new URL(request.url, redirectUri);
        const actualState = url.searchParams.get('state') ?? '';
        if (url.pathname !== '/auth/callback' || ['state', 'code', 'client_id', 'error'].some(key => url.searchParams.getAll(key).length > 1)
          || actualState.length !== state.length || !timingSafeEqual(Buffer.from(actualState), Buffer.from(state))) return fail();
        if (url.searchParams.has('error')) {
          handled = true; response.end('Sign-in was declined. Return to Swallow.'); reject(new PublicError('public.chatgptCancelled')); return;
        }
        const code = url.searchParams.get('code'), issued = url.searchParams.get('client_id') ?? saved?.clientId;
        if (!text(code, 4096) || !text(issued, 200) || issued === 'dynamic_agent_client'
          || saved && issued !== saved.clientId) return fail();
        handled = true; response.end('You may close this window and return to Swallow.'); settle({ code, clientId: issued });
      } catch { fail(); }
    });
    server.headersTimeout = 5000; server.requestTimeout = 5000;
    const abort = () => reject(new PublicError('public.chatgptCancelled'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', resolve); });
      const address = server.address(); if (!address || typeof address === 'string') throw new PublicError('public.chatgptAuth');
      redirectUri = 'http://127.0.0.1:' + address.port + '/auth/callback';
      signal.throwIfAborted();
      const url = new URL(AUTH + '/api/accounts/authorize');
      url.search = new URLSearchParams({ client_id: saved?.clientId ?? 'dynamic_agent_client',
        ext_agent_host_id: this.data.hostId, response_type: 'code', redirect_uri: redirectUri,
        scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        ...(!saved ? { agent_name_hint: 'Swallow' } : {}),
        ...(saved?.tokens?.id ? { id_token_hint: saved.tokens.id } : {}),
        ...(saved?.email ? { login_hint: saved.email } : {}),
        ...(saved && !saved.tokens?.scopes.includes('chatgpt.tokens.use.direct') ? { prompt: 'consent' } : {}),
      }).toString();
      await Promise.race([openExternal(url.href), callback.then(() => undefined)]);
      const result = await callback;
      signal.throwIfAborted();
      if (!saved && this.accounts.some(account => account.clientId === result.clientId)) throw new PublicError('public.chatgptAuth');
      const registration: Registration = saved ?? { id: randomUUID(), clientId: result.clientId };
      if (!saved) { this.accounts.push(registration); await this.persist(); }
      const raw = await this.transport.json(TOKEN, { method: 'POST', body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: registration.clientId, code: result.code,
        code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE,
      }) }, signal);
      const identity = await this.identity(raw.id_token, registration.clientId, nonce, signal);
      if (registration.subject && identity.subject !== registration.subject) throw new PublicError('public.chatgptAuth');
      const tokens = this.tokens(raw);
      signal.throwIfAborted();
      Object.assign(registration, identity, { tokens }); this.data.activeId = registration.id;
      await this.persist();
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError(signal.aborted ? 'public.chatgptCancelled' : 'public.chatgptAuth');
    } finally {
      signal.removeEventListener('abort', abort);
      server.closeAllConnections(); server.close();
    }
  }
  async access(signal?: AbortSignal) {
    await this.unlock();
    signal?.throwIfAborted();
    const account = this.active;
    if (!account?.tokens || !this.sharing) throw new PublicError('public.chatgptUnavailable');
    if (account.tokens.expiresAt - Date.now() < 60_000) {
      if (!this.renewing) this.renewing = this.renew(account).finally(() => { this.renewing = null; });
      await this.renewing;
    }
    if (!account.tokens || !this.sharing) throw new PublicError('public.chatgptUnavailable');
    signal?.throwIfAborted();
    return account.tokens.access;
  }
  // Refresh rotation must finish and be persisted even when the caller cancels inference.
  private async renew(account: Registration) {
    if (!account.tokens?.refresh) { delete account.tokens; await this.persist(); throw new PublicError('public.chatgptAuth'); }
    try {
      const raw = await this.transport.json(TOKEN, { method: 'POST', body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.tokens.refresh, resource: RESOURCE,
      }) });
      if (raw.id_token) {
        const identity = await this.identity(raw.id_token, account.clientId);
        if (identity.subject !== account.subject) throw new PublicError('public.chatgptAuth');
      }
      const tokens = this.tokens(raw, account.tokens);
      account.tokens = tokens; await this.persist();
    } catch (error) {
      if (error instanceof ChatGPTFailure && ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(error.diagnostic?.code ?? '')) {
        delete account.tokens; await this.persist();
      }
      throw error;
    }
  }
  async disconnect(): Promise<boolean> {
    await this.unlock();
    const account = this.active;
    if (!account) return true;
    // Wait for rotating credentials to settle before revoking the latest refresh token.
    await this.renewing?.catch(() => {});
    let confirmed = !account.tokens;
    if (account.tokens?.refresh) {
      for (let attempt = 0; attempt < 2 && !confirmed; attempt++) {
        try {
          const config = await this.configuration();
          const response = await this.transport.request(config.revocation_endpoint as string, { method: 'POST', body: new URLSearchParams({
            token: account.tokens.refresh, token_type_hint: 'refresh_token', client_id: account.clientId,
          }) });
          await response.body?.cancel();
          confirmed = response.status === 200;
          if (!confirmed && response.status < 500) break;
        } catch { /* Tokens are cleared locally below; the caller shows remote uncertainty. */ }
        if (!confirmed && attempt === 0) await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    delete account.tokens; await this.persist(); return confirmed;
  }
  async acknowledge() { this.data.welcomed = true; await this.persist(); }
}
