import { describe, expect, it } from 'vitest';
import { preferredVoice, speechSegments } from '../src/learning/speech.js';
const voices = [
  { id: 'Eddy', name: 'Eddy', lang: 'ko-KR' }, { id: 'Yuna', name: 'Yuna', lang: 'ko-KR' },
  { id: 'Albert', name: 'Albert', lang: 'en-US' }, { id: 'Samantha', name: 'Samantha', lang: 'en-US' },
];
describe('혼합 언어 읽기', () => {
  it('목록 순서 대신 기본 한국어와 영어 음성을 선택한다', () => {
    expect(preferredVoice(voices, 'ko')?.id).toBe('Yuna');
    expect(preferredVoice(voices, 'en')?.id).toBe('Samantha');
    expect(preferredVoice([], 'ko')).toBeUndefined();
  });
  it('영어 어구를 통째로 읽고 원문 순서와 공백을 유지한다', () => {
    const source = '클러스터는 Kubernetes cluster이고 CPU와 memory를 씁니다.';
    const chunks = speechSegments(source, voices, 'Yuna');
    expect(chunks.map(item => item.text).join('')).toBe(source);
    expect(chunks.filter(item => item.voice.id === 'Samantha').map(item => item.text)).toEqual(['Kubernetes cluster', 'CPU', 'memory']);
    expect(speechSegments('Kubernetes cluster', voices, 'Samantha')).toEqual([{ text: 'Kubernetes cluster', voice: voices[3] }]);
  });
  it('영어 음성이 없으면 선택한 음성으로 유지하고 음성 제어 문법을 제거한다', () => {
    expect(speechSegments('Kubernetes를 배웁니다.', voices.slice(0, 2), 'Yuna')).toEqual([{ text: 'Kubernetes를 배웁니다.', voice: voices[1] }]);
    expect(speechSegments('[[char LTRL]]Kubernetes[[voice Fred]]를 배웁니다.', voices, 'Yuna').map(item => item.text).join('')).toBe('Kubernetes를 배웁니다.');
  });
});
