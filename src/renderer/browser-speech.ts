import { speechSegments } from '../learning/speech.js';
import type { SpeechCommand, SpeechState, SpeechVoice } from '../shared/types.js';

export class BrowserSpeech {
  #state: SpeechState = { status: 'idle', error: null };
  #generation = 0;
  #listeners = new Set<(state: SpeechState) => void>();
  constructor(private synth: SpeechSynthesis | undefined = window.speechSynthesis,
    private utterance = (text: string) => new SpeechSynthesisUtterance(text)) {}
  get state(): SpeechState { return { ...this.#state }; }
  subscribe(listener: (state: SpeechState) => void) { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  private publish(status: SpeechState['status'], error: string | null = null) {
    this.#state = { status, error }; for (const listener of this.#listeners) listener(this.state);
  }
  async voices(): Promise<SpeechVoice[]> {
    const synth = this.synth;
    if (!synth) throw new Error('이 브라우저는 읽어주기를 지원하지 않습니다. 데스크톱 앱의 로컬 음성을 이용하세요.');
    if (!synth.getVoices().length) await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', finish); resolve(); };
      const timer = setTimeout(finish, 1200);
      synth.addEventListener('voiceschanged', finish, { once: true });
    });
    return synth.getVoices().filter(voice => voice.localService).map(voice => ({ id: voice.voiceURI, name: voice.name, lang: voice.lang }));
  }
  async speak(source: string, voiceId: string, rate: number) {
    if (!this.synth) throw new Error('브라우저 음성 기능을 사용할 수 없습니다.');
    if (![0.75, 1, 1.25, 1.5].includes(rate)) throw new Error('지원하지 않는 읽기 속도입니다.');
    const voice = this.synth.getVoices().find(voice => voice.localService && voice.voiceURI === voiceId);
    if (!voice) throw new Error('사용 가능한 로컬 음성이 없습니다. 데스크톱 앱에서 읽어주기를 사용하세요.');
    if (!source.trim() || source.length > 1800) throw new Error('읽을 원문 구간을 확인하세요.');
    this.control('stop');
    const generation = this.#generation;
    const local = this.synth.getVoices().filter(item => item.localService);
    const chunks = speechSegments(source, local.map(item => ({ id: item.voiceURI, name: item.name, lang: item.lang })), voiceId);
    const startChunk = (index: number) => {
      if (generation !== this.#generation) return;
      const chunk = chunks[index]!, speech = this.utterance(chunk.text);
      speech.voice = local.find(item => item.voiceURI === chunk.voice.id)!;
      speech.lang = chunk.voice.lang; speech.rate = rate;
      speech.onend = () => {
        if (generation !== this.#generation) return;
        if (index + 1 < chunks.length) startChunk(index + 1);
        else this.publish('idle');
      };
      speech.onerror = () => {
        if (generation !== this.#generation) return;
        this.control('stop'); this.publish('idle', '음성 재생에 실패했습니다. 설치된 음성이나 오디오 출력을 확인하세요.');
      };
      try { this.synth!.speak(speech); }
      catch { this.control('stop'); this.publish('idle', '음성 재생을 시작하지 못했습니다. 데스크톱 앱에서 다시 시도하세요.'); }
    };
    this.publish('speaking');
    startChunk(0);
  }
  control(command: SpeechCommand) {
    if (!['pause', 'resume', 'stop'].includes(command)) throw new Error('지원하지 않는 음성 동작입니다.');
    if (command === 'stop') {
      ++this.#generation; this.synth?.cancel();
      // Web Speech cancel removes utterances but keeps its paused flag.
      if (this.synth?.paused) this.synth.resume();
      this.publish('idle');
    }
    else if (command === 'pause' && this.#state.status === 'speaking') { this.synth?.pause(); this.publish('paused'); }
    else if (command === 'resume' && this.#state.status === 'paused') { this.synth?.resume(); this.publish('speaking'); }
  }
}
