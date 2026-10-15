import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { speechSegments } from '../src/learning/speech.js';
import type { SpeechCommand, SpeechState, SpeechVoice } from '../src/shared/types.js';

const execute = promisify(execFile);
export function parseVoices(output: string): SpeechVoice[] {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/);
    return match ? [{ id: match[1]!.trim(), name: match[1]!.trim(), lang: match[2]!.replace('_', '-') }] : [];
  });
}

let voices: Promise<SpeechVoice[]> | undefined;
export function installedVoices(): Promise<SpeechVoice[]> {
  if (process.platform !== 'darwin') return Promise.reject(new Error('이 버전의 데스크톱 읽어주기는 macOS에서 지원합니다.'));
  voices ??= execute('/usr/bin/say', ['-v', '?'], { timeout: 5000, maxBuffer: 1_000_000 })
    .then(({ stdout }) => parseVoices(stdout)).catch(() => { voices = undefined; throw new Error('설치된 음성을 불러오지 못했습니다. macOS 설정의 손쉬운 사용 → 읽기 및 말하기에서 음성을 확인하세요.'); });
  return voices.then(list => structuredClone(list));
}

interface SpeechProcess {
  stdin: { end(text: string): unknown; on(event: 'error', listener: () => void): unknown } | null;
  on(event: 'error', listener: () => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}
type LaunchSpeech = (command: string, args: string[]) => SpeechProcess;
export class NativeSpeech {
  #state: SpeechState = { status: 'idle', error: null };
  #process: SpeechProcess | null = null;
  #generation = 0;
  #listeners = new Set<(state: SpeechState) => void>();
  constructor(private getVoices = installedVoices, private launch: LaunchSpeech = (command, args) => spawn(command, args, { shell: false, stdio: ['pipe', 'ignore', 'ignore'] })) {}
  get state(): SpeechState { return { ...this.#state }; }
  subscribe(listener: (state: SpeechState) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  private publish(status: SpeechState['status'], error: string | null = null) {
    this.#state = { status, error };
    for (const listener of this.#listeners) listener(this.state);
  }
  async speak(source: string, voiceId: string, rate: number): Promise<void> {
    if (typeof source !== 'string' || !source.trim() || source.length > 1800) throw new Error('읽을 원문 구간을 확인하세요.');
    if (![0.75, 1, 1.25, 1.5].includes(rate)) throw new Error('지원하지 않는 읽기 속도입니다.');
    // End the previous request before awaiting voice lookup; rejected replacements cannot orphan its state.
    this.control('stop');
    const generation = ++this.#generation;
    const known = await this.getVoices();
    const chunks = speechSegments(source, known, voiceId);
    if (generation !== this.#generation) return;
    this.stopProcess();
    const startChunk = (index: number): boolean => {
      if (generation !== this.#generation) return false;
      const chunk = chunks[index]!;
      const paused = this.#state.status === 'paused';
      let child: SpeechProcess;
      try { child = this.launch('/usr/bin/say', ['-v', chunk.voice.id, '-r', String(Math.round(180 * rate))]); }
      catch { this.publish('idle', '음성 재생을 시작하지 못했습니다. 설치된 음성과 오디오 출력을 확인하세요.'); return false; }
      this.#process = child;
      const failure = () => {
        if (generation !== this.#generation || this.#process !== child) return;
        this.stopProcess();
        this.publish('idle', '음성을 재생하지 못했습니다. 설치된 음성과 오디오 출력을 확인한 뒤 다시 시도하세요.');
      };
      child.on('error', failure);
      child.stdin?.on('error', failure);
      child.on('close', (code: number | null) => {
        if (generation !== this.#generation || this.#process !== child) return;
        this.#process = null;
        if (code === 0 && index + 1 < chunks.length) startChunk(index + 1);
        else this.publish('idle', code === 0 ? null : '음성 재생이 중단되었습니다. 다시 읽어주세요.');
      });
      if (paused) child.kill('SIGSTOP');
      this.publish(paused ? 'paused' : 'speaking');
      try { child.stdin?.end(chunk.text); } catch { failure(); }
      return true;
    };
    if (!startChunk(0)) throw new Error(this.#state.error ?? '음성 재생을 취소했습니다.');
  }
  private stopProcess() {
    const child = this.#process;
    this.#process = null;
    if (child) { if (this.#state.status === 'paused') child.kill('SIGCONT'); child.kill('SIGTERM'); }
  }
  control(command: SpeechCommand): void {
    if (!['pause', 'resume', 'stop'].includes(command)) throw new Error('지원하지 않는 음성 동작입니다.');
    if (command === 'stop') { ++this.#generation; this.stopProcess(); this.publish('idle'); }
    else if (command === 'pause' && this.#process && this.#state.status === 'speaking') { this.#process.kill('SIGSTOP'); this.publish('paused'); }
    else if (command === 'resume' && this.#process && this.#state.status === 'paused') { this.#process.kill('SIGCONT'); this.publish('speaking'); }
  }
}
