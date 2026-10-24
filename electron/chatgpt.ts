import type { AIModel, CoachRequest } from '../src/shared/types.js';
import { CHATGPT_CONSENT_VERSION, type ChatGPTState } from '../src/shared/chatgpt.js';
import { PublicError, toPublicError } from '../src/shared/public-errors.js';
import { ChatGPTAuth, ChatGPTFailure, ChatGPTTransport, httpFailure, readLimited, RESOURCE, type Protection } from './chatgpt-auth.js';

export interface ChatGPTOptions {
  directory: string; protection: Protection; openExternal(url: string): Promise<void>;
  fetcher?: typeof fetch; loginTimeoutMs?: number;
}
export class ChatGPTProvider {
  private readonly auth: ChatGPTAuth;
  private readonly transport: ChatGPTTransport;
  private value: ChatGPTState = { status: 'disconnected', accounts: [], activeAccountId: null, models: [], firstUsePending: false };
  private listeners = new Set<() => void>();
  private login: AbortController | null = null;
  private request: AbortController | null = null;
  private operation: Promise<void> | null = null;
  private disposed = false;
  constructor(private readonly options: ChatGPTOptions) {
    this.transport = new ChatGPTTransport(options.fetcher);
    this.auth = new ChatGPTAuth(options.directory, options.protection, this.transport);
  }
  get state(): ChatGPTState { return structuredClone(this.value); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish() {
    this.value.accounts = this.auth.accounts.map((account, index) => ({
      id: account.id, label: 'Connection ' + (index + 1) + (account.email ? ' · ' + account.email : ''), connected: !!account.tokens,
    }));
    this.value.activeAccountId = this.auth.activeId;
    this.value.locked = this.auth.locked;
    this.value.signingIn = !!this.login;
    this.value.firstUsePending = this.value.status === 'ready' && this.auth.firstUsePending;
    for (const listener of this.listeners) listener();
  }
  async initialize() {
    try { await this.auth.initialize(); }
    catch (error) { this.value.error = toPublicError(error).code; this.value.status = 'error'; }
    this.publish(); // No refresh, model lookup, or AI request during startup.
  }
  private async run(action: () => Promise<void>) {
    if (this.operation || this.disposed) throw new PublicError('public.chatgptBusy');
    this.cancel();
    this.value.status = 'checking'; this.value.error = undefined; this.value.diagnostic = undefined; this.value.models = []; this.publish();
    const work = (async () => {
      try { await action(); }
      catch (error) {
        this.value.models = [];
        this.value.status = this.auth.active?.tokens ? 'error' : 'disconnected';
        this.value.error = toPublicError(error).code;
        throw error instanceof PublicError ? error : new PublicError('public.chatgptNetwork');
      } finally { this.publish(); }
    })();
    this.operation = work;
    try { await work; } finally { if (this.operation === work) this.operation = null; }
  }
  async signIn(consent: string, accountId?: string) {
    if (consent !== CHATGPT_CONSENT_VERSION) throw new PublicError('public.chatgptConsent');
    await this.run(async () => {
      const controller = new AbortController(); this.login = controller; this.publish();
      try {
        await this.auth.signIn(this.options.openExternal, controller.signal, accountId, this.options.loginTimeoutMs);
        controller.signal.throwIfAborted();
        if (!this.auth.sharing) { this.value.status = 'needs-consent'; return; }
        await this.loadModels(controller.signal);
      } finally { if (this.login === controller) this.login = null; }
    });
  }
  cancelSignIn() { this.login?.abort(); }
  async refresh() {
    await this.run(async () => {
      await this.auth.unlock();
      if (!this.auth.sharing) { this.value.status = this.auth.active?.tokens ? 'needs-consent' : 'disconnected'; return; }
      await this.loadModels();
    });
  }
  private async loadModels(signal?: AbortSignal) {
    const access = await this.auth.access(signal);
    const body = await this.transport.json(RESOURCE + '/models', { headers: { Authorization: 'Bearer ' + access } }, signal);
    if (!Array.isArray(body.models) || body.models.length > 500) throw new PublicError('public.chatgptResponse');
    const models: AIModel[] = [];
    for (const value of body.models) {
      if (!value || typeof value !== 'object' || value.visibility !== 'list') continue;
      if (typeof value.slug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,139}$/.test(value.slug)
        || typeof value.display_name !== 'string' || !value.display_name.trim() || value.display_name.length > 200) throw new PublicError('public.chatgptResponse');
      const slug = 'chatgpt:' + this.auth.activeId + ':' + value.slug;
      if (models.some(model => model.slug === slug)) throw new PublicError('public.chatgptResponse');
      models.push({ slug, displayName: value.display_name + ' · ChatGPT', providerId: 'chatgpt',
        connectionId: 'chatgpt:' + this.auth.activeId, upstreamModelId: value.slug,
        capabilities: { text: 'supported', vision: 'unsupported', structuredOutput: 'unknown', executionLocation: 'remote' } });
    }
    if (this.disposed || signal?.aborted) throw new PublicError('public.chatgptCancelled');
    this.value.models = models; this.value.status = 'ready';
  }
  async acknowledgeFirstUse() { await this.auth.acknowledge(); this.publish(); }
  async disconnect() {
    this.cancelSignIn(); this.cancel();
    await this.operation?.catch(() => {});
    await this.run(async () => {
      const confirmed = await this.auth.disconnect();
      this.value.status = 'disconnected'; this.value.models = [];
      this.value.error = confirmed ? undefined : 'public.chatgptRevoke';
    });
  }
  cancel() { this.request?.abort(); }
  dispose() { this.disposed = true; this.cancelSignIn(); this.cancel(); this.listeners.clear(); }
  async streamResponse(options: CoachRequest): Promise<{ text: string }> {
    const model = this.value.models.find(model => model.slug === options.model);
    if (this.operation || this.request || this.disposed || this.value.status !== 'ready' || !model || !this.auth.sharing)
      throw new PublicError('public.chatgptUnavailable');
    const input = typeof options.input === 'string' ? [{ role: 'user', content: options.input }] : options.input;
    if (!Array.isArray(input) || !input.length || input.some(item => typeof item.content !== 'string'
      || !['user', 'assistant', 'developer'].includes(item.role))) throw new PublicError('public.chatgptResponse');
    if (JSON.stringify(input).length > 100_000 || (options.instructions?.length ?? 0) > 20_000) throw new PublicError('public.chatgptResponse');
    const controller = new AbortController(); this.request = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000), ...(options.signal ? [options.signal] : [])]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let phase: 'authorization' | 'request' | 'stream' = 'authorization';
    let status: number | undefined;
    let contentType: string | undefined;
    let bodyFormat: NonNullable<ChatGPTState['diagnostic']>['bodyFormat'];
    try {
      signal.throwIfAborted();
      const access = await this.auth.access(signal);
      const body = {
        model: model.upstreamModelId, input, store: false, stream: true,
        ...(options.instructions ? { instructions: options.instructions } : {}),
        // The app validates structure and source quotes again before saving.
        ...(options.responseSchema ? { text: { format: { type: 'json_schema', name: 'swallow_result', strict: false, schema: options.responseSchema } } } : {}),
      };
      phase = 'request';
      const response = await this.transport.request(RESOURCE + '/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      }, signal, 180_000);
      status = response.status;
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      contentType = mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) && mime.length < 100 ? mime : undefined;
      if (!response.ok) {
        let raw: unknown = {};
        try { raw = JSON.parse(await readLimited(response)); } catch { /* Only safe status/code reach the UI. */ }
        throw httpFailure(response.status, raw, response.headers.get('x-request-id'));
      }
      // Some successful subscription responses omit Content-Type. The SSE parser
      // still requires valid events, nonempty text, and response.completed.
      if ((mime !== undefined && contentType !== 'text/event-stream') || !response.body) {
        const raw = (await readLimited(response)).trim();
        bodyFormat = !raw ? 'empty' : /^(?:event|data):/.test(raw) ? 'event-stream' : /^<(?:!doctype|html)/i.test(raw) ? 'html' : 'other';
        try {
          const parsed: unknown = JSON.parse(raw); bodyFormat = 'json';
          if (parsed && typeof parsed === 'object' && 'error' in parsed) throw httpFailure(response.status, parsed, response.headers.get('x-request-id'));
        } catch (error) { if (error instanceof PublicError) throw error; }
        throw new PublicError('public.chatgptResponse');
      }
      phase = 'stream';
      reader = response.body.getReader();
      const decoder = new TextDecoder(); let pending = '', output = '', bytes = 0, completed = false;
      while (!completed) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 2_000_000) throw new PublicError('public.chatgptResponse');
        pending = (pending + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(data); } catch { throw new PublicError('public.chatgptResponse'); }
          if (!event || typeof event !== 'object') throw new PublicError('public.chatgptResponse');
          if (event.type === 'error' || event.type === 'response.failed') {
            const result = event.response as Record<string, unknown> | undefined;
            throw httpFailure(400, { error: result?.error ?? event.error ?? event }, response.headers.get('x-request-id'));
          }
          if (['response.incomplete', 'response.refusal.delta', 'response.refusal.done'].includes(String(event.type))) throw new PublicError('public.chatgptResponse');
          if (event.type === 'response.output_text.delta') {
            if (typeof event.delta !== 'string') throw new PublicError('public.chatgptResponse');
            output += event.delta;
            if (output.length > 30_000) throw new PublicError('public.chatgptResponse');
            options.onDelta?.(event.delta);
          }
          if (event.type === 'response.completed') {
            const result = event.response as Record<string, unknown> | undefined;
            if (result?.status !== 'completed') throw new PublicError('public.chatgptResponse');
            completed = true; break;
          }
        }
        if (pending.length > 1_000_000) throw new PublicError('public.chatgptResponse');
      }
      signal.throwIfAborted();
      if (!completed || !output.trim()) throw new PublicError('public.chatgptResponse');
      return { text: output };
    } catch (error) {
      const failure = signal.aborted ? new PublicError('public.chatgptCancelled')
        : error instanceof PublicError ? error : new PublicError('public.chatgptResponse');
      if (!signal.aborted) {
        this.value.error = failure.code; this.value.models = [];
        this.value.diagnostic = { phase, status, contentType, bodyFormat, ...(failure instanceof ChatGPTFailure ? failure.diagnostic : {}) };
        this.value.status = this.auth.active?.tokens ? 'error' : 'disconnected'; this.publish();
      }
      throw failure;
    } finally {
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
      if (this.request === controller) this.request = null;
    }
  }
}
