import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AIModel, CoachProvider, CoachRequest, OllamaEndpoint, OllamaState } from '../src/shared/types.js';

const DEFAULT_ENDPOINT: OllamaEndpoint = { host: '127.0.0.1', port: 11434 };
import { OLLAMA_PROTOCOL_VERSIONS } from '../src/shared/ai.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const failure = (message: string) => new Error(message);
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('Ollama 응답 형식을 확인할 수 없습니다.');
  return value as Record<string, any>;
}
export function validateOllamaEndpoint(value: unknown): OllamaEndpoint {
  const raw = object(value);
  if (Object.keys(raw).some(key => !['host', 'port'].includes(key)) || !['127.0.0.1', '::1'].includes(raw.host)
    || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) throw failure('Ollama 주소는 127.0.0.1 또는 ::1과 1~65535 정수 포트로 설정하세요.');
  return { host: raw.host, port: raw.port };
}
function remote(raw: Record<string, any>): boolean {
  // Non-string/unrecognized values are also blocked, rather than treated as absent.
  return ['remote_host', 'remote_model'].some(key => raw[key] !== undefined && raw[key] !== '')
    || [raw.name, raw.model].some(value => typeof value === 'string' && /(?:[:\-]cloud)(?:$|[:\-])/i.test(value));
}
export function ollamaIdentity(endpoint: OllamaEndpoint): string { return `ollama-${hash(`${endpoint.host}:${endpoint.port}`).slice(0, 24)}`; }
function validateSchema(value: unknown, schema: Record<string, any>): void {
  if (schema.type === 'object') {
    const raw = object(value), properties = schema.properties ?? {};
    if ((schema.required ?? []).some((key: string) => !Object.hasOwn(raw, key)) || (schema.additionalProperties === false && Object.keys(raw).some(key => !Object.hasOwn(properties, key)))) throw failure('로컬 모델의 JSON schema가 맞지 않습니다. 다시 요청하세요.');
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(raw, key)) validateSchema(raw[key], child as Record<string, any>);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw failure('로컬 모델의 JSON 배열 형식이 맞지 않습니다.');
    for (const child of value) validateSchema(child, schema.items);
  } else if (schema.type === 'string' && (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity))) throw failure('로컬 모델의 JSON 문자열 형식이 맞지 않습니다.');
}

/** Direct Node HTTP: no DNS, global fetch, Electron session proxy or environment proxy. */
function jsonRequest(endpoint: OllamaEndpoint, path: '/api/version' | '/api/tags' | '/api/show' | '/api/chat', body: unknown,
  signal: AbortSignal, total: number, idle: number): Promise<Record<string, any>> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false, idleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, result?: Record<string, any>) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(idleTimer); signal.removeEventListener('abort', abort);
      if (error) { req.destroy(); reject(error); } else resolve(result!);
    };
    const abort = () => finish(failure('로컬 AI 요청을 취소했습니다.'));
    const timer = setTimeout(() => finish(failure('로컬 AI 응답 대기 시간이 초과되었습니다. 서버와 모델을 확인하세요.')), total);
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request({ hostname: endpoint.host, port: endpoint.port, path, method: encoded ? 'POST' : 'GET', agent: false,
      headers: { Accept: 'application/json', ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length } : {}) } }, res => {
      if (res.statusCode !== 200) { res.destroy(); finish(failure('Ollama 서버 응답을 처리하지 못했습니다. 연결 상태를 확인하세요.')); return; }
      let length = 0; const chunks: Buffer[] = [];
      const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => finish(failure('로컬 AI 응답 수신 시간이 초과되었습니다.')), idle); };
      resetIdle();
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { finish(failure('Ollama 응답이 너무 큽니다.')); res.destroy(); return; }
        chunks.push(chunk); resetIdle();
      });
      res.on('aborted', () => finish(failure('Ollama 서버 연결이 중단되었습니다.')));
      res.on('error', () => finish(failure('Ollama 서버 연결이 중단되었습니다.')));
      res.on('end', () => {
        try {
          const result = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          if (result.error !== undefined) throw failure('Ollama가 요청을 완료하지 못했습니다. 모델과 서버 상태를 확인하세요.');
          finish(undefined, result);
        } catch { finish(failure('Ollama 응답 형식을 확인할 수 없습니다.')); }
      });
    });
    req.on('error', () => finish(failure('Ollama 서버에 연결할 수 없습니다. 실행 중인 서버의 주소와 포트를 확인하세요.')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else req.end(encoded);
  });
}

export class OllamaProvider implements CoachProvider {
  private value: OllamaState = { status: 'disconnected', endpoint: DEFAULT_ENDPOINT, revision: 0, models: [], message: '실행 중인 Ollama 서버를 연결하세요.' };
  private controller: AbortController | null = null;
  private enabled = false;
  constructor(private readonly settingsPath?: string, private readonly timeouts: { request?: number; metadata?: number; idle?: number; catalog?: number } = {}) {}
  get state(): OllamaState { return structuredClone(this.value); }
  async initialize() {
    if (!this.settingsPath) return;
    try {
      const data = object(JSON.parse(await readFile(this.settingsPath, 'utf8')));
      if (data.version !== 1 || typeof data.enabled !== 'boolean') throw failure('로컬 AI 설정 형식이 잘못되었습니다.');
      this.value.endpoint = validateOllamaEndpoint(data.endpoint); this.enabled = data.enabled;
      this.value.message = data.enabled ? '저장된 Ollama 주소입니다. 연결 상태 확인을 눌러 주세요.' : this.value.message;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.value.status = 'error'; this.value.message = '로컬 AI 설정을 읽지 못했습니다. 기존 파일은 보존했습니다.'; }
    }
  }
  private async save(endpoint: OllamaEndpoint, enabled: boolean) {
    if (!this.settingsPath) return;
    const temporary = `${this.settingsPath}.tmp`;
    try {
      await mkdir(dirname(this.settingsPath), { recursive: true });
      await writeFile(temporary, JSON.stringify({ version: 1, endpoint, enabled }), { mode: 0o600 });
      await rename(temporary, this.settingsPath);
    }
    catch { throw failure('로컬 AI 설정을 저장하지 못했습니다. 저장 권한을 확인하세요.'); }
  }
  async connect(value: unknown) {
    const endpoint = validateOllamaEndpoint(value);
    this.cancel();
    await this.save(endpoint, true);
    this.enabled = true; this.value = { status: 'disconnected', endpoint, revision: this.value.revision + 1, models: [], message: '' };
    await this.refresh();
  }
  async disconnect() {
    this.cancel(); await this.save(this.value.endpoint, false); this.enabled = false;
    this.value = { ...this.value, revision: this.value.revision + 1, status: 'disconnected', models: [], message: 'Ollama 연결을 해제했습니다. 모델 파일과 서버 설정은 유지됩니다.' };
  }
  private async catalog(signal: AbortSignal): Promise<{ models: AIModel[]; version: string }> {
    const endpoint = this.value.endpoint;
    const version = (await jsonRequest(endpoint, '/api/version', undefined, signal, this.timeouts.metadata ?? 5000, this.timeouts.idle ?? 5000)).version;
    if (!(OLLAMA_PROTOCOL_VERSIONS as readonly unknown[]).includes(version)) throw failure(`Ollama 버전의 로컬 모델 판별 계약을 확인하지 못했습니다. 현재 API 계약 범위는 ${OLLAMA_PROTOCOL_VERSIONS.join(', ')}입니다.`);
    const raw = await jsonRequest(endpoint, '/api/tags', undefined, signal, this.timeouts.metadata ?? 5000, this.timeouts.idle ?? 5000);
    if (!Array.isArray(raw.models) || raw.models.length > 1000) throw failure('Ollama 모델 목록 형식을 확인할 수 없습니다.');
    const connectionId = ollamaIdentity(endpoint), models: AIModel[] = [];
    for (const entry of raw.models) {
      const item = object(entry);
      if (remote(item)) continue;
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 200 || typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(item.digest)
        || !Number.isSafeInteger(item.size) || item.size <= 0 || item.details?.format !== 'gguf') continue;
      const slug = `ollama:${hash(`${connectionId}\n${item.name}\n${item.digest}`).slice(0, 40)}`;
      if (models.some(model => model.slug === slug)) throw failure('Ollama 모델 목록이 중복되었습니다.');
      models.push({ slug, displayName: `${item.name} · Ollama`, providerId: 'ollama', connectionId, upstreamModelId: item.name, modelFingerprint: item.digest,
        capabilities: { text: 'unknown', vision: 'unsupported', structuredOutput: 'unknown', executionLocation: 'unknown' } });
    }
    return { models, version };
  }
  async refresh() {
    if (!this.enabled) { this.value.message = '실행 중인 Ollama 서버를 먼저 연결하세요.'; return; }
    this.cancel(); const controller = new AbortController(); this.controller = controller;
    this.value = { ...this.value, status: 'checking', message: 'Ollama 연결과 설치 모델을 확인하는 중입니다.' };
    const revision = this.value.revision;
    const timer = setTimeout(() => controller.abort(), this.timeouts.catalog ?? 15000);
    try {
      const { models, version } = await this.catalog(controller.signal);
      if (controller.signal.aborted || this.controller !== controller || revision !== this.value.revision) return;
      this.value = { ...this.value, models, version, status: models.length ? 'ready' : 'unavailable', checkedAt: new Date().toISOString(), message: models.length ? '서버 연결됨 · 선택 모델의 로컬 메타데이터는 요청 전에 검사합니다.' : '사용 가능한 로컬 텍스트 모델이 없습니다. cloud·확인 불가 모델은 목록에서 제외됩니다.' };
    } catch (error) {
      if (this.controller === controller) this.value = { ...this.value, status: 'error', models: [], message: controller.signal.aborted ? 'Ollama 연결 확인 시간이 초과되었습니다.' : (error as Error).message };
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }
  async streamResponse(options: CoachRequest): Promise<{ text: string }> {
    const model = this.value.models.find(value => value.slug === options.model);
    if (!model || !this.enabled || this.value.status !== 'ready') throw failure('사용 가능한 Ollama 모델을 연결하고 선택하세요.');
    if (!Array.isArray(options.input) || !options.responseSchema) throw failure('로컬 AI에는 구조화된 텍스트 요청이 필요합니다.');
    const messages = options.input.map(message => {
      if (typeof message.content !== 'string' || !['developer', 'user', 'assistant'].includes(message.role)) throw failure('로컬 PDF 이미지 설명은 아직 지원하지 않습니다. 텍스트 자료를 선택하세요.');
      return { role: message.role === 'developer' ? 'system' : message.role, content: message.content };
    });
    if (messages.reduce((length, message) => length + message.content.length, 0) > 12000) throw failure('로컬 모델 입력이 너무 깁니다. 더 작은 텍스트 구간을 선택하세요.');
    if (this.controller) throw failure('이미 로컬 AI 요청이 진행 중입니다.');
    const controller = new AbortController(); this.controller = controller;
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let timedOut = false;
    const overall = setTimeout(() => { timedOut = true; abort(); }, this.timeouts.request ?? 180000);
    try {
      const { models, version } = await this.catalog(controller.signal);
      if (!models.some(candidate => candidate.slug === model.slug)) throw failure('로컬 모델이 변경되었거나 삭제되었습니다. 목록을 새로고침하고 다시 선택하세요.');
      const show = await jsonRequest(this.value.endpoint, '/api/show', { model: model.upstreamModelId }, controller.signal, this.timeouts.metadata ?? 5000, this.timeouts.idle ?? 5000);
      const architecture = show.model_info?.['general.architecture'];
      if (remote(show) || show.details?.format !== 'gguf' || !Array.isArray(show.capabilities) || !show.capabilities.includes('completion')
        || typeof architecture !== 'string' || !Number.isSafeInteger(show.model_info?.[`${architecture}.context_length`]) || show.model_info[`${architecture}.context_length`] < 4096) throw failure('선택 모델의 로컬 텍스트 실행 정보를 확인할 수 없습니다. cloud·확인 불가 모델은 요청하지 않습니다.');
      const context = Math.min(32768, show.model_info[`${architecture}.context_length`]);
      if (Buffer.byteLength(JSON.stringify(messages), 'utf8') + 3072 > context) throw failure('선택 로컬 모델의 문맥 한도를 넘습니다. 더 작은 원문으로 요청하세요.');
      const raw = await jsonRequest(this.value.endpoint, '/api/chat', { model: model.upstreamModelId, messages, stream: false, ...(['0.24.0', '0.40.4'].includes(version) ? { truncate: false, shift: false } : {}), format: options.responseSchema, options: { temperature: 0.2, num_ctx: context, num_predict: 2048 } }, controller.signal, this.timeouts.request ?? 180000, this.timeouts.idle ?? 30000);
      if (remote(raw) || raw.model !== model.upstreamModelId || raw.done !== true || raw.done_reason !== 'stop' || raw.message?.role !== 'assistant'
        || typeof raw.message.content !== 'string' || !raw.message.content.trim() || raw.message.content.length > 30000 || raw.message.tool_calls?.length) throw failure('로컬 모델 응답이 완성되지 않았거나 실행 정보를 확인할 수 없습니다.');
      let value: unknown; try { value = JSON.parse(raw.message.content); } catch { throw failure('로컬 모델의 JSON 응답을 해석할 수 없습니다.'); }
      validateSchema(value, options.responseSchema);
      controller.signal.throwIfAborted();
      return { text: raw.message.content };
    } catch (error) {
      if (timedOut) throw failure('로컬 AI 응답 대기 시간이 초과되었습니다.');
      if (controller.signal.aborted) throw failure('로컬 AI 요청을 취소했습니다.');
      throw error;
    }
    finally { clearTimeout(overall); options.signal?.removeEventListener('abort', abort); if (this.controller === controller) this.controller = null; }
  }
  cancel() { this.controller?.abort(); }
  dispose() { this.cancel(); }
}
