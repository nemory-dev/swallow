import { describe, expect, it } from 'vitest';
import { BrowserSpeech } from '../src/renderer/browser-speech.js';

describe('browser local speech', () => {
  it('로컬 한국어·영어 음성을 전환하며 마지막 구절까지 재생 상태를 유지한다', async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    const voices = [
      { voiceURI: 'ko', name: 'Yuna', lang: 'ko-KR', localService: true },
      { voiceURI: 'en', name: 'Samantha', lang: 'en-US', localService: true },
    ] as SpeechSynthesisVoice[];
    const synth = { getVoices: () => voices, cancel() {}, speak: (item: SpeechSynthesisUtterance) => utterances.push(item), pause() {}, resume() {} } as unknown as SpeechSynthesis;
    const player = new BrowserSpeech(synth, text => ({ text } as SpeechSynthesisUtterance));
    await player.speak('쉬운 Kubernetes 설명', 'ko', 1);
    expect(utterances[0]?.text).toBe('쉬운 ');
    utterances[0]?.onend?.({} as SpeechSynthesisEvent);
    expect(utterances[1]?.lang).toBe('en-US'); expect(utterances[1]?.text).toBe('Kubernetes');
    expect(player.state.status).toBe('speaking');
    utterances[1]?.onend?.({} as SpeechSynthesisEvent);
    expect(utterances[2]?.text).toBe(' 설명');
    utterances[2]?.onend?.({} as SpeechSynthesisEvent);
    expect(player.state.status).toBe('idle');
  });
  it('excludes remote voices and ignores stale callbacks after stop', async () => {
    const utterances: SpeechSynthesisUtterance[] = [];
    let stopped = 0;
    const local = { voiceURI: 'local', name: 'Local', lang: 'en-US', localService: true } as SpeechSynthesisVoice;
    const remote = { voiceURI: 'remote', name: 'Remote', lang: 'en-US', localService: false } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local, remote], cancel: () => { stopped++; }, speak: (utterance: SpeechSynthesisUtterance) => utterances.push(utterance), pause() {}, resume() {} } as unknown as SpeechSynthesis;
    const player = new BrowserSpeech(synth, text => ({ text } as SpeechSynthesisUtterance));
    expect(await player.voices()).toEqual([{ id: 'local', name: 'Local', lang: 'en-US' }]);
    await expect(player.speak('hello', 'remote', 1)).rejects.toThrow('로컬');
    await player.speak('hello', 'local', 1);
    player.control('pause'); expect(player.state.status).toBe('paused');
    player.control('resume'); expect(player.state.status).toBe('speaking');
    player.control('stop');
    await player.speak('next', 'local', 1);
    utterances[0]?.onend?.({} as SpeechSynthesisEvent);
    expect(player.state.status).toBe('speaking');
    utterances[1]?.onend?.({} as SpeechSynthesisEvent);
    expect(player.state.status).toBe('idle'); expect(stopped).toBe(3);
  });
  it('can start a new utterance after stopping while paused', async () => {
    let paused = false;
    const starts: boolean[] = [];
    const local = { voiceURI: 'local', name: 'Local', lang: 'en-US', localService: true } as SpeechSynthesisVoice;
    const synth = { getVoices: () => [local], get paused() { return paused; }, cancel() {},
      speak() { starts.push(paused); }, pause() { paused = true; }, resume() { paused = false; } } as unknown as SpeechSynthesis;
    const player = new BrowserSpeech(synth, text => ({ text } as SpeechSynthesisUtterance));
    await player.speak('hello', 'local', 1);
    player.control('pause'); player.control('stop');
    await player.speak('next', 'local', 1);
    expect(starts).toEqual([false, false]);
  });
});
