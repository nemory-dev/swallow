import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { speechSegments } from '../src/learning/speech.js';
import type { SpeechCommand, SpeechState, SpeechVoice } from '../src/shared/types.js';

const errors = {
  startup: '로컬 음성 도구를 실행하지 못했습니다. 앱 파일과 실행 권한을 확인하세요.',
  voices: '설치된 로컬 음성을 불러오지 못했습니다. 기기의 음성 설정과 앱 실행 권한을 확인하세요.',
  voice: '사용 가능한 로컬 음성이 없습니다. 기기의 음성 설정에서 음성을 확인하세요.',
  audio: '음성을 재생하지 못했습니다. 설치된 음성과 오디오 출력을 확인한 뒤 다시 시도하세요.',
  input: '읽을 원문 구간과 음성 설정을 확인하세요.',
  protocol: '음성 도구의 응답을 읽지 못했습니다. 앱을 다시 실행한 뒤 읽어주세요.',
  timeout: '음성 도구의 응답 시간이 초과되었습니다. 다시 읽어주세요.',
} as const;
type Failure = keyof typeof errors;
export interface WindowsSpeechProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(): boolean;
}
const spawnOptions = { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] } as const;
export type WindowsSpeechLaunch = (path: string, args: string[], options: typeof spawnOptions) => WindowsSpeechProcess;
export interface WindowsSpeechOptions {
  launch?: WindowsSpeechLaunch;
  getVoices?: (helperPath: string) => Promise<SpeechVoice[]>;
  startupTimeoutMs?: number;
  timeoutMs?: number;
  stopTimeoutMs?: number;
  maxOutputBytes?: number;
}
const launchDefault: WindowsSpeechLaunch = (path, args) => spawn(path, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
const voiceCache = new Map<string, Promise<SpeechVoice[]>>();
function checkPath(path: string) { if (!isAbsolute(path)) throw new Error(errors.startup); }
function terminate(child: WindowsSpeechProcess) { try { child.kill(); } catch { /* Already exited or inaccessible: state has already been reset. */ } }
function validVoices(value: unknown): value is SpeechVoice[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!item || typeof item !== 'object') return false;
    const voice = item as SpeechVoice;
    if (![voice.id, voice.name, voice.lang].every(text => typeof text === 'string' && text.length > 0 && text.length <= 1024)) return false;
    if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(voice.lang) || ids.has(voice.id)) return false;
    ids.add(voice.id); return true;
  });
}

export function installedWindowsVoices(helperAbsolutePath: string, options: WindowsSpeechOptions = {}): Promise<SpeechVoice[]> {
  checkPath(helperAbsolutePath);
  let cached = voiceCache.get(helperAbsolutePath);
  if (!cached) {
    cached = new Promise<SpeechVoice[]>((resolve, reject) => {
      let child: WindowsSpeechProcess;
      try { child = (options.launch ?? launchDefault)(helperAbsolutePath, ['voices', '--parent-pid', String(process.pid)], spawnOptions); }
      catch { reject(new Error(errors.voices)); return; }
      let finished = false, bytes = 0; const chunks: Buffer[] = [];
      const timer = setTimeout(() => finish(), options.startupTimeoutMs ?? options.timeoutMs ?? 15000);
      const finish = (list?: SpeechVoice[]) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (list) resolve(list); else { terminate(child); reject(new Error(errors.voices)); }
      };
      const receive = (chunk: Buffer | string, result: boolean) => {
        if (finished) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > (options.maxOutputBytes ?? 65536)) { finish(); return; }
        if (result) chunks.push(buffer);
      };
      child.stdout.on('data', chunk => receive(chunk, true));
      child.stderr.on('data', chunk => receive(chunk, false));
      child.on('error', () => finish()); child.stdin.on('error', () => finish());
      child.stdout.on('error', () => finish()); child.stderr.on('error', () => finish());
      child.on('close', code => {
        if (finished) return;
        if (code !== 0) { finish(); return; }
        try {
          const list: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (!validVoices(list)) { finish(); return; }
          finish(list.map(({ id, name, lang }) => ({ id, name, lang })));
        } catch { finish(); }
      });
      try { child.stdin.end(); } catch { finish(); }
    }).catch(cause => { voiceCache.delete(helperAbsolutePath); throw cause; });
    voiceCache.set(helperAbsolutePath, cached);
  }
  return cached.then(list => structuredClone(list));
}

interface Playback {
  child: WindowsSpeechProcess;
  generation: number;
  ack?: 'start' | 'pause' | 'resume';
  timer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  resolveStart: () => void;
  rejectStart: (cause: Error) => void;
  closed: boolean;
  stopped: boolean;
}
export class WindowsSpeech {
  #state: SpeechState = { status: 'idle', error: null };
  #listeners = new Set<(state: SpeechState) => void>();
  #generation = 0;
  #playback: Playback | undefined;
  constructor(private readonly helperAbsolutePath: string, private readonly options: WindowsSpeechOptions = {}) { checkPath(helperAbsolutePath); }
  get state(): SpeechState { return { ...this.#state }; }
  subscribe(listener: (state: SpeechState) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  private publish(status: SpeechState['status'], error: string | null = null) {
    this.#state = { status, error }; for (const listener of this.#listeners) listener(this.state);
  }
  private current(run: Playback) { return this.#playback === run && this.#generation === run.generation; }
  private shutdown(run: Playback) {
    clearTimeout(run.timer); run.resolveStart();
    if (run.stopped || run.closed) return;
    run.stopped = true;
    try { run.child.stdin.write(JSON.stringify({ command: 'stop' }) + '\n'); run.child.stdin.end(); } catch { /* The deadline below also covers broken pipes. */ }
    if (!run.closed) {
      run.killTimer = setTimeout(() => terminate(run.child), this.options.stopTimeoutMs ?? 500);
      run.killTimer.unref();
    }
  }
  private fail(run: Playback, reason: Failure) {
    if (!this.current(run)) return;
    run.rejectStart(new Error(errors[reason]));
    this.#playback = undefined; ++this.#generation;
    this.shutdown(run); this.publish('idle', errors[reason]);
  }
  private expectAck(run: Playback, ack: Playback['ack']) {
    clearTimeout(run.timer); run.ack = ack;
    const timeout = ack === 'start' ? this.options.startupTimeoutMs ?? this.options.timeoutMs ?? 15000 : this.options.timeoutMs ?? 5000;
    run.timer = setTimeout(() => this.fail(run, 'timeout'), timeout);
  }
  async speak(source: string, voiceId: string, rate: number): Promise<void> {
    if (typeof source !== 'string' || !source.trim() || source.length > 1800) throw new Error('읽을 원문 구간을 확인하세요.');
    if (![0.75, 1, 1.25, 1.5].includes(rate)) throw new Error('지원하지 않는 읽기 속도입니다.');
    this.control('stop'); const generation = ++this.#generation;
    let voices: SpeechVoice[];
    try { voices = await (this.options.getVoices ? this.options.getVoices(this.helperAbsolutePath) : installedWindowsVoices(this.helperAbsolutePath, this.options)); }
    catch {
      if (generation !== this.#generation) return;
      this.publish('idle', errors.voices); throw new Error(errors.voices);
    }
    if (generation !== this.#generation) return;
    const chunks = speechSegments(source, voices, voiceId).map(chunk => ({ voice: chunk.voice.id, text: chunk.text }));
    const sapiRate = new Map([[0.75, -3], [1, 0], [1.25, 3], [1.5, 5]]).get(rate)!;
    const input = JSON.stringify({ rate: sapiRate, chunks }) + '\n';
    if (Buffer.byteLength(input) > 65536) throw new Error(errors.input);
    let child: WindowsSpeechProcess;
    try { child = (this.options.launch ?? launchDefault)(this.helperAbsolutePath, ['speak', '--parent-pid', String(process.pid)], spawnOptions); }
    catch { this.publish('idle', errors.startup); throw new Error(errors.startup); }
    return new Promise<void>((resolve, reject) => {
      const run: Playback = { child, generation, resolveStart: resolve, rejectStart: reject, closed: false, stopped: false };
      this.#playback = run; this.expectAck(run, 'start');
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffered = '', bytes = 0;
      const event = (frame: string) => {
        if (!this.current(run)) return;
        try {
          const value: unknown = JSON.parse(frame);
          if (!value || typeof value !== 'object' || !('event' in value)) { this.fail(run, 'protocol'); return; }
          const message = value as { event: string; code?: string };
          if (message.event === 'error') {
            const code: Failure = message.code === 'voice' || message.code === 'input' || message.code === 'audio' ? message.code : 'audio';
            this.fail(run, code); return;
          }
          if (message.event === 'done') {
            if (run.ack === 'start') { this.fail(run, 'protocol'); return; }
            this.#playback = undefined; this.shutdown(run); this.publish('idle'); return;
          }
          if (message.event === 'speaking' && (run.ack === 'start' || run.ack === 'resume')) {
            clearTimeout(run.timer); run.ack = undefined; this.publish('speaking'); run.resolveStart(); return;
          }
          if (message.event === 'paused' && run.ack === 'pause') {
            clearTimeout(run.timer); run.ack = undefined; this.publish('paused'); return;
          }
          this.fail(run, 'protocol');
        } catch { this.fail(run, 'protocol'); }
      };
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (!this.current(run)) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > (this.options.maxOutputBytes ?? 65536)) { this.fail(run, 'protocol'); return; }
        try { buffered += decoder.decode(buffer, { stream: true }); } catch { this.fail(run, 'protocol'); return; }
        let end: number;
        while ((end = buffered.indexOf('\n')) >= 0 && this.current(run)) {
          const frame = buffered.slice(0, end).replace(/\r$/, ''); buffered = buffered.slice(end + 1); event(frame);
        }
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        bytes += Buffer.byteLength(chunk); if (bytes > (this.options.maxOutputBytes ?? 65536)) this.fail(run, 'protocol');
      });
      child.on('error', () => this.fail(run, 'startup')); child.stdin.on('error', () => this.fail(run, 'audio'));
      child.stdout.on('error', () => this.fail(run, 'protocol')); child.stderr.on('error', () => this.fail(run, 'protocol'));
      child.on('close', () => { run.closed = true; clearTimeout(run.killTimer); this.fail(run, 'audio'); });
      try { child.stdin.write(input); } catch { this.fail(run, 'audio'); }
    });
  }
  control(command: SpeechCommand): void {
    if (!['pause', 'resume', 'stop'].includes(command)) throw new Error('지원하지 않는 음성 동작입니다.');
    const run = this.#playback;
    if (command === 'stop') {
      ++this.#generation; this.#playback = undefined;
      if (run) this.shutdown(run); this.publish('idle'); return;
    }
    if (!run || run.ack || (command === 'pause' ? this.#state.status !== 'speaking' : this.#state.status !== 'paused')) return;
    this.expectAck(run, command);
    try { run.child.stdin.write(JSON.stringify({ command }) + '\n'); } catch { this.fail(run, 'audio'); }
  }
}
