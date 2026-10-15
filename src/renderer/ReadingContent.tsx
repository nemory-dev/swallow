import { useLanguage } from './LanguageContext.js';
import { useEffect, useMemo, useState } from 'react';
import { readingPassages } from '../learning/reading.js';
import { preferredVoice } from '../learning/speech.js';
import type { ReadingUnit, SpeechState, SpeechVoice, SwallowBridge } from '../shared/types.js';

export function ReadingContent({ bridge, documentId, unit, onRead, onRecall, pending }: {
  bridge: SwallowBridge; documentId: string; unit: ReadingUnit;
  onRead: () => Promise<boolean>; onRecall: () => void; pending: boolean;
}) {
  const { t, formatNumber, errorText, localizeText } = useLanguage();
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [rate, setRate] = useState(1);
  const [speech, setSpeech] = useState<SpeechState>({ status: 'idle', error: null });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aloud, setAloud] = useState(false);
  const [position, setPosition] = useState(0);
  const [completed, setCompleted] = useState(false);
  const passages = useMemo(() => readingPassages(unit.text), [unit.text]);
  useEffect(() => {
    let disposed = false;
    const unsubscribe = bridge.onSpeechState(state => { if (!disposed) setSpeech(state); });
    void bridge.getSpeechState().then(state => { if (!disposed) setSpeech(state); }).catch(cause => {
      if (!disposed) setError(errorText(cause));
    });
    void bridge.getSpeechVoices().then(list => {
      if (disposed) return;
      setVoices(list);
      setVoiceId((preferredVoice(list, /[가-힣]/.test(unit.text) ? 'ko' : 'en') ?? list[0])?.id ?? '');
      if (!list.length) setError('로컬 음성이 없습니다. 데스크톱 앱 또는 macOS 음성 설정을 확인하세요.');
    }).catch(cause => { if (!disposed) setError(errorText(cause)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; unsubscribe(); void bridge.controlSpeech('stop').catch(() => {}); };
  }, [bridge, documentId, unit.id, unit.text]);
  async function audio(operation: () => Promise<void>) {
    setError(null);
    try { await operation(); } catch (cause) { setError(errorText(cause)); }
  }
  return <>
    <section className="reading-tools" aria-label={t('speech.tools')}>
      <div className="reading-tool-actions">
        <button className="secondary-button" disabled={loading || !voiceId} onClick={() => void audio(() => speech.status === 'speaking' ? bridge.controlSpeech('pause') : speech.status === 'paused' ? bridge.controlSpeech('resume') : bridge.speak({ documentId, unitId: unit.id, voiceId, rate }))}>
          {speech.status === 'speaking' ? t('speech.pauseButton') : speech.status === 'paused' ? t('speech.resumeButton') : t('speech.readButton')}
        </button>
        {speech.status !== 'idle' && <button className="text-button" onClick={() => void audio(() => bridge.controlSpeech('stop'))}>{t('speech.stop')}</button>}
        <button className="text-button" aria-pressed={aloud} onClick={() => { void audio(() => bridge.controlSpeech('stop')); setAloud(value => !value); }}> {aloud ? t('speech.allSource') : t('speech.readYourself')}</button>
      </div>
      <div className="voice-settings">
        <label>{t('speech.voiceShort')}<select aria-label={t('speech.voice')} disabled={loading || speech.status !== 'idle'} value={voiceId} onChange={event => setVoiceId(event.target.value)}>
          {!voiceId && <option value="">{loading ? t('common.loading') : t('speech.noAvailable')}</option>}
          {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.lang}</option>)}
        </select></label>
        <label>{t('speech.speed')}<select aria-label={t('speech.rate')} disabled={speech.status !== 'idle'} value={rate} onChange={event => setRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{formatNumber(value)}{t('speech.speedSuffix')}</option>)}</select></label>
      </div>
      <p className="small-copy">{t('speech.help')}</p>
      {(error || speech.error) && <p className="inline-error" role="alert">{error ? localizeText(error) : speech.error ? errorText(new Error(speech.error)) : null}</p>}
    </section>
    {aloud ? <section className="aloud-reader" aria-label={t('speech.practice')}>
      <div className="aloud-heading"><strong>{t('speech.readYourself')}</strong><span>{formatNumber(position + 1)} / {formatNumber(passages.length)}</span></div>
      <p className="small-copy">{t('speech.practiceHelp')}</p>
      <article className="source-text aloud-passage" lang="">{passages[position]}</article>
      {completed ? <div className="aloud-complete" role="status"><p>{t('speech.practiceComplete')}</p><button className="primary-button" onClick={onRecall}>{t('speech.hideRecall')}</button></div> : <div className="aloud-actions">
        <button className="text-button" disabled={position === 0 || pending} onClick={() => setPosition(value => value - 1)}>{t('speech.previousPart')}</button>
        <button className="primary-button" disabled={pending} onClick={() => {
          if (position < passages.length - 1) setPosition(value => value + 1);
          else void onRead().then(success => { if (success) setCompleted(true); });
        }}>{position === passages.length - 1 ? t('speech.readComplete') : t('speech.readPart')}</button>
      </div>}
    </section> : <article className="source-text" lang="">{unit.text}</article>}
  </>;
}
