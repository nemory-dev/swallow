import type { SpeechVoice } from '../shared/types.js';
import { speechText } from './reading.js';

export function preferredVoice(voices: SpeechVoice[], language: 'ko' | 'en'): SpeechVoice | undefined {
  const matching = voices.filter(voice => voice.lang.toLowerCase().startsWith(language));
  const preferred = language === 'ko' ? 'Yuna' : 'Samantha';
  return matching.find(voice => voice.name === preferred) ?? matching[0];
}

/** Displayed sources stay unchanged; only the local speech input is segmented. */
export function speechSegments(source: string, voices: SpeechVoice[], voiceId: string): { text: string; voice: SpeechVoice }[] {
  const selected = voices.find(voice => voice.id === voiceId);
  if (!selected) throw new Error('설치된 음성을 선택하세요.');
  // macOS say interprets embedded commands even when passed through stdin.
  const text = speechText(source).replace(/\[\[[^\]]*\]\]/g, '');
  if (!text.trim()) throw new Error('읽을 내용이 없습니다.');
  const english = preferredVoice(voices, 'en');
  if (!selected.lang.toLowerCase().startsWith('ko') || !english) return [{ text, voice: selected }];
  const result: { text: string; voice: SpeechVoice }[] = [];
  let offset = 0;
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_'][A-Za-z0-9]+)*(?:[ \t]+[A-Za-z][A-Za-z0-9]*(?:[-_'][A-Za-z0-9]+)*)*/g)) {
    if (match.index > offset) result.push({ text: text.slice(offset, match.index), voice: selected });
    result.push({ text: match[0], voice: english });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) result.push({ text: text.slice(offset), voice: selected });
  return result;
}
