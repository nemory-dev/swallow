import type { AIModel } from '../shared/types.js';
import { ChatGPTUsage } from './ChatGPTSettings.js';
import { useLanguage } from './LanguageContext.js';
import type { LibraryScope } from '../shared/types.js';
import { useEffect, useRef, useState } from 'react';
import type { AppState, EvidenceReference, ExplanationStyle, SpeechState, SpeechVoice, StudyAnswerFeedback, StudyDocument, StudyNote, StudySession, StudyWorkspace, SwallowBridge, TermNote } from '../shared/types.js';
import { studyPassage, studyQuestion } from '../learning/session.js';
import { readingPassages } from '../learning/reading.js';
import { explanationProvider, pdfAIBlocked } from '../shared/ai.js';
import { preferredVoice } from '../learning/speech.js';
import { unitPage } from '../learning/pdf.js';
import { PdfReader } from './PdfReader.js';
import { TermLookup } from './TermLookup.js';
import { SourceTranslationPanel } from './SourceTranslationPanel.js';
import { useUpdatePreparation } from './update-preparation.js';

const DRAFT_KEY = 'swallow.study-drafts.v1';
const locationKey = (session: StudySession) => `${session.documentId}:${session.sourceHash}:${session.unitId}:${session.passageIndex}`;
const stepKeys = { explain: 'study.step.explain', check: 'study.step.check', note: 'study.step.note', done: 'study.step.done' } as const;
type Drafts = { entries: Record<string, string>; error: string | null; blocked: boolean };
let memoryDrafts: Drafts | undefined;
export function assertStudyDraftsForUpdate(): void {
  if (memoryDrafts?.error || memoryDrafts?.blocked) throw new Error('임시 공부 답변 저장소에 문제가 있습니다. 공부 화면에서 답변을 저장하고 저장 공간·권한을 확인한 뒤 업데이트해 주세요.');
}
export function clearStudyDrafts(documentId: string): void {
  const removeDocument = (entries: Record<string, string>) => Object.fromEntries(
    Object.entries(entries).filter(([key]) => !key.startsWith(`${documentId}:`)));
  if (memoryDrafts) memoryDrafts = { ...memoryDrafts, entries: removeDocument(memoryDrafts.entries) };
  let raw: string | null;
  try { raw = localStorage.getItem(DRAFT_KEY); }
  catch { throw new Error('문서는 삭제했지만 임시 공부 답변 저장소에 접근하지 못해 해당 초안을 지우지 못했습니다. 저장소 권한을 확인해 주세요.'); }
  if (raw === null) return;
  let entries: Record<string, string>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string' || item.length > 10000)) throw new Error();
    entries = value as Record<string, string>;
  } catch { throw new Error('문서는 삭제했지만 임시 공부 답변 저장소가 손상되어 해당 초안을 지우지 못했습니다. 다른 문서의 데이터 보호를 위해 기존 저장소를 보존했습니다.'); }
  const next = removeDocument(entries);
  if (Object.keys(next).length === Object.keys(entries).length) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); }
  catch { throw new Error('문서는 삭제했지만 임시 공부 답변 삭제를 저장하지 못했습니다. 다른 문서의 초안은 보존했습니다. 저장 공간과 브라우저 권한을 확인해 주세요.'); }
}
function loadDrafts(): Drafts {
  if (memoryDrafts) return memoryDrafts;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string' || item.length > 10000)) throw new Error();
    memoryDrafts = { entries: value as Record<string, string>, error: null, blocked: false };
    return memoryDrafts;
  } catch { memoryDrafts = { entries: {}, error: '임시 답변을 읽지 못했습니다. 기존 저장소는 보존했습니다. 이동 전에 답변 저장을 눌러 주세요.', blocked: true }; return memoryDrafts; }
}
function AnswerFeedbackContents({ value }: { value: StudyAnswerFeedback }) {
  const { t } = useLanguage();
  return <div className="feedback-content"><h4>{t('study.feedbackTitle')}</h4><p className="small-copy">{t('study.feedbackModel', { model: value.model })}</p><p className="preserve-text" lang={value.result.identity?.responseLanguage ?? 'ko'}>{value.result.assessment}</p>{value.result.missingPoints.length > 0 && <><h4>{t('study.improve')}</h4><ul>{value.result.missingPoints.map((point, index) => <li lang={value.result.identity?.responseLanguage ?? 'ko'} key={index}>{point}</li>)}</ul></>}<p className="feedback-next" lang={value.result.identity?.responseLanguage ?? 'ko'}>{value.result.nextStep}</p>{value.result.visualEvidence?.map((evidence, index) => <div key={index}><strong>{t('pdf.evidencePage', { page: evidence.page })}</strong><p lang={value.result.identity?.responseLanguage ?? 'ko'}>{evidence.description}</p><p className="small-copy">{t('pdf.uncertaintyLabel')} {evidence.uncertainty}</p></div>)}<p className="small-copy">{t('study.checkFeedback')}</p></div>;
}
function NoteContents({ note, open, disabled, doc, bridge }: { note: StudyNote; open: (reference: EvidenceReference) => void; disabled: boolean; doc: StudyDocument; bridge: SwallowBridge }) {
  const { t } = useLanguage();
  const [requestedPage, setRequestedPage] = useState<{ page: number } | null>(null);
  const sourceUnit = doc.units.find(unit => unit.id === note.source.unitId);
  return <div className="note-contents"><p className="study-origin">{note.summaryOrigin === 'ai' ? t('study.aiNote') : t('study.sourceNote')}</p>{note.summaryOrigin === 'source' ? <><h4>{t('study.sourceExcerpt')}</h4><p className="preserve-text" lang="">{note.sourceExcerpt}</p></> : <p className="preserve-text" lang={note.responseLanguage ?? note.guideIdentity?.responseLanguage ?? 'ko'}>{note.summary}</p>}{note.guideModel && <p className="small-copy">{t('study.generatedModel')} · {note.guideModel}</p>}{!!note.evidenceQuotes?.length && <details><summary>{t('study.aiEvidence')}</summary>{note.evidenceQuotes.map((quote, index) => <blockquote lang="" key={index}>{quote}</blockquote>)}</details>}{!!note.visualEvidence?.length && <details><summary>{t('study.visualEvidence')}</summary><p className="small-copy">{t('study.visualEvidenceHelp')}</p>{note.visualEvidence.map((evidence, index) => <div className="visual-evidence" key={index}><strong>{t('pdf.page', { page: evidence.page })}</strong><p lang={note.responseLanguage ?? note.guideIdentity?.responseLanguage ?? 'ko'}>{evidence.description}</p><p className="small-copy">{t('pdf.uncertaintyLabel')} {evidence.uncertainty}</p>{doc.pdf && sourceUnit && <button className="text-button" disabled={disabled} onClick={() => setRequestedPage({ page: evidence.page })}>{t('pdf.openEvidence', { page: evidence.page })}</button>}</div>)}{requestedPage && doc.pdf && sourceUnit && <><PdfReader bridge={bridge} doc={doc} unit={sourceUnit} requestedPage={requestedPage} pending={disabled} /><button className="text-button" onClick={() => setRequestedPage(null)}>{t('pdf.closeEvidence')}</button></>}</details>}<h4>{t('study.question')}</h4><p lang={note.responseLanguage ?? note.guideIdentity?.responseLanguage ?? 'ko'}>{note.question}</p><h4>{t('study.answer')}</h4>{note.unknown && <p>{t('study.unknown')}</p>}{note.userAnswer && <p className="preserve-text" lang="">{note.userAnswer}</p>}{note.answerFeedback && <AnswerFeedbackContents value={note.answerFeedback} />}{note.unresolved.length > 0 && <><h4>{t('study.unresolved')}</h4><ul>{note.unresolved.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
    {!!note.relearning?.length && <details><summary>{t('study.relearningCount', { count: note.relearning.length })}</summary>{note.relearning.map((attempt, index) => <div key={index}><h4>{attempt.question}</h4><p className="preserve-text" lang="">{attempt.answer || t('study.noAnswerUnknown')}</p></div>)}<p className="small-copy">{t('study.relearningLimit')}</p></details>}
    {note.terms.length > 0 && <><h4>{t('study.lookedUpTerms')}</h4><ul className="saved-terms">{note.terms.map((term, index) => <li key={index}><strong>{term.term}</strong> · {term.kind === 'ai' ? t('study.aiExplanation') : term.kind === 'web' ? t('term.webOrigin') : term.kind === 'note' ? t('term.savedOrigin') : t('term.sourceOrigin')}<p className="preserve-text" lang={term.kind === 'ai' || term.kind === 'web' ? term.responseLanguage ?? term.identity?.responseLanguage ?? 'ko' : ''}>{term.explanation}</p>{term.sourceTitle && <p className="small-copy">{t('common.sourceLabel', { name: term.sourceTitle })}</p>}{term.sourceUrl && <p className="source-url">{term.sourceUrl}</p>}{term.quote && <blockquote lang="">{term.quote}</blockquote>}</li>)}</ul></>}
    <details><summary>{t('study.sourceExcerpt')}</summary><blockquote lang="">{note.sourceExcerpt}</blockquote></details><p className="small-copy">{note.title} · {note.page ? `${t('pdf.page', { page: note.page })} · ` : ''}{t('study.noteSource', { index: note.passageIndex + 1, reference: note.source.unitId })}</p><button className="text-button" disabled={disabled} onClick={() => open(note.source)}>{t('library.openEvidence')}</button>
  </div>;
}
export function StudyFlow({ bridge, doc, state, pending, aiAvailable, aiDisabledReason, onConnect, onLegacy, onBusyChange, scope, scopeName }: {
  scope: LibraryScope; scopeName: string;
  bridge: SwallowBridge; doc: StudyDocument; state: AppState; pending: boolean; aiAvailable: boolean; aiDisabledReason: string | null;
  onConnect: () => void; onLegacy: (reference?: EvidenceReference) => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const { t, formatNumber, formatDate, errorText, localizeText } = useLanguage();
  const [workspace, setWorkspace] = useState<StudyWorkspace | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const workRef = useRef(false);
  const speechControlLock = useRef(false);
  const live = useRef(true);
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const [drafts, setDrafts] = useState(loadDrafts);
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [rate, setRate] = useState(1);
  const [speech, setSpeech] = useState<SpeechState>({ status: 'idle', error: null });
  const [retry, setRetry] = useState(0);
  const disabled = pending || working || !!state.busy || loading;
  const answerDisabled = pending || working || loading || (!!state.busy && state.busy.kind !== 'translation');
  const speechControlDisabled = pending || working || loading;
  const session = workspace?.session;
  const key = session ? locationKey(session) : null;
  const answer = key && Object.hasOwn(drafts.entries, key) ? drafts.entries[key]! : session?.answer ?? '';
  const currentFeedback = answer === session?.answer && !session?.unknown ? session?.answerFeedback : undefined;
  const unit = doc.units.find(value => value.id === session?.unitId);
  const passage = session && unit ? studyPassage(doc, session) : '';
  const pageInfo = unit ? unitPage(doc, unit) : undefined;
  const page = pageInfo?.page;
  const currentUnitIndex = unit ? doc.units.findIndex(item => item.id === unit.id) : -1;
  const hasNextPassage = !!session && currentUnitIndex >= 0 && doc.units.slice(currentUnitIndex).some((item, index) =>
    readingPassages(item.text).slice(index === 0 ? session.passageIndex + 1 : 0).some(value => value.trim().length > 0));
  const terminal = !!session && !!unit && !hasNextPassage;
  useUpdatePreparation(async () => {
    if (loading || !workspace || workRef.current || state.busy) throw new Error('공부를 불러오거나 처리하는 중입니다. 작업을 마친 뒤 업데이트해 주세요.');
    if (draftsRef.current.error || draftsRef.current.blocked) throw new Error('임시 답변 저장소에 문제가 있습니다. 답변을 저장하고 저장 공간·권한을 확인한 뒤 업데이트해 주세요.');
    const draft = key ? draftsRef.current.entries[key] : undefined;
    if (session?.step === 'check' && draft !== undefined && draft !== session.answer) {
      const saved = await bridge.studySession({ type: 'answer', documentId: doc.id, answer: draft, unknown: session.unknown });
      if (live.current) setWorkspace(saved);
    }
  });

  useEffect(() => {
    live.current = true;
    let current = true; setLoading(true);
    void bridge.getStudyWorkspace(doc.id).then(value => { if (current) { setWorkspace(value); setError(null); } }).catch(cause => { if (current) setError(errorText(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; live.current = false; busyCallback.current(false); };
  }, [bridge, doc.id, retry, pageInfo?.note]);
  useEffect(() => {
    let current = true;
    void bridge.getSpeechVoices().then(value => { if (current) setVoices(value); }).catch(cause => { if (current) setError(errorText(cause)); });
    void bridge.getSpeechState().then(value => { if (current) setSpeech(value); }).catch(cause => { if (current) setError(errorText(cause)); });
    const unsubscribe = bridge.onSpeechState(setSpeech);
    return () => { current = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    void bridge.controlSpeech('stop').catch(cause => { if (live.current) setError(errorText(cause)); });
    return () => { void bridge.controlSpeech('stop').catch(() => undefined); };
  }, [bridge, doc.id, session?.step, session?.unitId, session?.passageIndex, started]);
  useEffect(() => {
    if (!drafts.error || Object.keys(drafts.entries).length === 0) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [drafts.error, answer, session]);

  async function request(operation: () => Promise<void>): Promise<void> {
    if (workRef.current || pending || state.busy) throw new Error('다른 작업을 마친 뒤 다시 시도하세요.');
    workRef.current = true; setWorking(true); busyCallback.current(true); setError(null);
    try { await operation(); }
    catch (cause) { if (live.current) setError(errorText(cause)); throw cause; }
    finally { workRef.current = false; if (live.current) { setWorking(false); busyCallback.current(false); } }
  }
  const run = (operation: () => Promise<void>) => { void request(operation).catch(() => undefined); };
  async function controlSpeech(action: 'pause' | 'resume' | 'stop') {
    if (speechControlLock.current || speechControlDisabled) return;
    speechControlLock.current = true;
    try { await bridge.controlSpeech(action); }
    catch (cause) { if (live.current) setError(errorText(cause)); }
    finally { speechControlLock.current = false; }
  }
  function editAnswer(value: string) {
    if (!key) return;
    let next = { ...draftsRef.current, entries: { ...draftsRef.current.entries, [key]: value } };
    if (!next.blocked) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next.entries)); next = { ...next, error: null }; }
      catch { next = { ...next, error: '임시 답변 자동 보관에 실패했습니다. 이동 전에 답변 저장을 눌러 주세요.' }; }
    }
    memoryDrafts = next; draftsRef.current = next; setDrafts(next);
  }
  async function saveAnswer(unknown: boolean, advance: boolean) {
    const saved = await bridge.studySession({ type: 'answer', documentId: doc.id, answer, unknown });
    if (live.current) setWorkspace(saved);
    // Retry the entire draft store, preserving other locations before clearing an earlier quota error.
    if (key && Object.hasOwn(draftsRef.current.entries, key)) editAnswer(answer);
    if (advance) { const next = await bridge.studySession({ type: 'step', documentId: doc.id, step: 'note' }); if (live.current) setWorkspace(next); }
  }
  async function feedback() {
    await saveAnswer(false, false);
    const value = await bridge.feedbackStudy(doc.id);
    if (live.current) setWorkspace(value);
  }
  async function relearn() {
    const saved = await bridge.studySession({ type: 'relearn', documentId: doc.id, answer });
    if (live.current) setWorkspace(saved);
    if (aiAvailable) {
      const explained = await bridge.explainStudy(doc.id, 'relearn');
      if (live.current) setWorkspace(explained);
    }
  }
  async function addTerm(term: TermNote) { const value = await bridge.studySession({ type: 'add-term', documentId: doc.id, term }); if (live.current) setWorkspace(value); }
  const openEvidence = (reference: EvidenceReference) => run(() => onLegacy(reference));
  const explain = (style: ExplanationStyle) => run(async () => { const value = await bridge.explainStudy(doc.id, style); if (live.current) setWorkspace(value); });
  const voiceFor = (text: string) => voiceId || preferredVoice(voices, /[가-힣]/.test(text) ? 'ko' : 'en')?.id || voices[0]?.id || '';
  const modelDisplayName = (model: AIModel): string => model.displayName;
  const retryAttempt = session?.relearning?.at(-1);

  return <main className="study-pane" aria-label={t('study.region')}>
    <div className="study-topline"><span>{t('study.tagline')}</span><button className="text-button" disabled={disabled} onClick={() => run(() => onLegacy())}>{t('study.legacy')}</button></div>
    <h2 className="document-heading" lang="">{doc.title}</h2>{doc.goal && <p className="learning-goal"><span>{t('document.goal')}</span>{doc.goal}</p>}
    {(error || drafts.error || speech.error) && <div role="alert" className="inline-error">{error && <p>{localizeText(error)}</p>}{drafts.error && <p>{errorText(new Error(drafts.error))}</p>}{speech.error && <p>{errorText(new Error(speech.error))}</p>}</div>}
    <details className="study-model-settings"><summary>{t('model.settings')}</summary><label className="field-label">{t('model.label')}<select aria-label={t('model.label')} value={state.models.some(model => model.slug === state.library.selectedModel) ? state.library.selectedModel ?? '' : ''} disabled={disabled || !state.models.length} onChange={event => run(() => bridge.study({ type: 'select-model', model: event.target.value }))}>{!state.models.some(model => model.slug === state.library.selectedModel) && <option value="">{state.library.selectedModel ? t('model.unavailable', { model: state.library.selectedModel }) : t('model.choose')}</option>}{state.models.map(model => <option key={model.slug} value={model.slug}>{modelDisplayName(model)}</option>)}</select></label><button className="text-button" disabled={disabled || bridge.mode !== 'desktop'} onClick={() => run(() => bridge.refreshModels())}>{t('model.refresh')}</button></details><ChatGPTUsage state={state} bridge={bridge} run={run} />
    {loading ? <p role="status">{t('study.loadingSaved')}</p> : !workspace ? <button className="secondary-button" onClick={() => setRetry(value => value + 1)}>{t('common.reload')}</button> : !started ? <section className="study-start"><h3>{session ? t('study.resumePrompt') : t('study.emptyTitle')}</h3><p>{t('study.startHelp')}</p>{session && <p className="small-copy">{t('study.savedPosition', { index: doc.units.findIndex(item => item.id === session.unitId) + 1, count: session.passageIndex + 1, step: t(stepKeys[session.step]) })}</p>}<button className="primary-button" disabled={disabled} onClick={() => run(async () => { const value = await bridge.studySession({ type: 'start', documentId: doc.id }); if (live.current) { setWorkspace(value); setStarted(true); } })}>{session ? t('study.resume') : t('study.start')}</button><p className="small-copy">{t('study.offlineHelp')}</p></section> : session && unit ? <>
      <ol className="study-steps" aria-label={t('study.steps')}>{(['explain', 'check', 'note', 'done'] as const).map((step, index) => <li key={step} aria-current={session.step === step ? 'step' : undefined}><span>{index + 1}</span>{t(stepKeys[step])}</li>)}</ol>
      <p className="study-location">{unit.section || t('document.source')}{page ? ` · ${t('pdf.page', { page })}` : ''} · {t('study.partPosition', { index: session.passageIndex + 1, total: readingPassages(unit.text).length })}</p>
      {session.step === 'explain' && <section className="study-speech" aria-label={t('speech.region')}><div className="study-actions"><button className="secondary-button" disabled={disabled || voices.length === 0 || speech.status !== 'idle'} onClick={() => run(() => bridge.speakStudy(doc.id, 'source', voiceFor(passage), rate))}>{t('speech.source')}</button><button className="secondary-button" disabled={disabled || voices.length === 0 || !session.guide || speech.status !== 'idle'} onClick={() => run(() => bridge.speakStudy(doc.id, 'explanation', voiceFor(session.guide?.overview ?? ''), rate))}>{t('speech.explanation')}</button>{speech.status === 'speaking' && <button className="text-button" disabled={speechControlDisabled} onClick={() => { void controlSpeech('pause'); }}>{t('speech.pause')}</button>}{speech.status === 'paused' && <button className="text-button" disabled={speechControlDisabled} onClick={() => { void controlSpeech('resume'); }}>{t('speech.resumeListening')}</button>}{speech.status !== 'idle' && <button className="text-button" disabled={speechControlDisabled} onClick={() => { void controlSpeech('stop'); }}>{t('speech.stopListening')}</button>}</div><p className="small-copy">{speech.status === 'speaking' ? t('speech.speaking') : speech.status === 'paused' ? t('speech.paused') : voices.length === 0 ? t('speech.noLocalVoice') : t('speech.deviceHelp', { voice: voices.find(voice => voice.id === voiceFor(session.guide?.overview ?? passage))?.name ?? t('speech.checkVoice') })}</p><details><summary>{t('speech.settings')}</summary><div className="voice-settings"><label>{t('speech.voiceLabel')}<select value={voiceId} disabled={disabled || speech.status !== 'idle'} onChange={event => setVoiceId(event.target.value)}><option value="">{t('speech.autoVoice')}</option>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {voice.lang}</option>)}</select></label><label>{t('speech.rate')}<select value={rate} disabled={disabled || speech.status !== 'idle'} onChange={event => setRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map(value => <option key={value} value={value}>{formatNumber(value)}{t('speech.speedSuffix')}</option>)}</select></label></div></details></section>}
      {session.step === 'explain' ? <section className="study-turn"><h3>{retryAttempt ? t('study.restartKnown') : t('study.startHere')}</h3>{retryAttempt && <div className="study-relearning"><p>{t('study.retryQuestion', { question: retryAttempt.question })}</p><p className="preserve-text">{t('study.retryAnswer', { answer: retryAttempt.answer || t('study.nothingYet') })}</p><p className="small-copy">{t('study.relearningHelp')}</p>{!session.guide && <button className="primary-button" disabled={disabled || !aiAvailable} onClick={() => explain('relearn')}>{t('study.relearn')}</button>}</div>}
        {!aiAvailable && <p className="small-copy">{aiDisabledReason}<button className="text-button" onClick={onConnect}>{t('account.studySettings')}</button></p>}
        <p className="small-copy">{doc.pdf && pdfAIBlocked(state) ? t('study.pdfUnsupported') : t('study.sendExplanation', { image: page ? t('study.sendImage', { page }) : '', retry: retryAttempt ? t('study.retryPayload') : '', provider: explanationProvider(state.library.selectedModel) })}</p>
        <div className="study-actions"><button className="primary-button" disabled={disabled || !aiAvailable} onClick={() => explain('brief')}>{session.guide ? t('study.briefAgain') : t('study.briefRequest')}</button><button className="secondary-button" disabled={disabled || !aiAvailable} onClick={() => explain('simple')}>{t('study.simple')}</button><button className="secondary-button" disabled={disabled || !aiAvailable} onClick={() => explain('example')}>{t('study.example')}</button></div>
        {session.guide && <div className="study-explanation"><h3>{t('study.aiExplanation')}</h3><p className="small-copy">{t('model.explanation')} · {state.models.find(model => model.slug === session.guideModel)?.displayName ?? session.guideModel ?? t('common.unknown')}</p><p lang={session.guide?.identity?.responseLanguage ?? session.responseLanguage ?? 'ko'}>{session.guide.overview}</p>{session.guide.keyPoints.map((point, index) => <div key={index}><strong>{point.title}</strong><p lang={session.guide?.identity?.responseLanguage ?? session.responseLanguage ?? 'ko'}>{point.explanation}</p>{point.quote && <blockquote lang="">{point.quote}</blockquote>}</div>)}<p className="small-copy">{t('study.checkAi')}</p></div>}
        <details className="study-original"><summary>{t('study.sourceCharacters', { count: passage.length })}</summary><pre className="study-source" lang="">{passage}</pre></details>{doc.pdf && <details className="study-pdf"><summary>{t('study.pdfSource', { page: page! })}</summary><PdfReader key={unit.id} bridge={bridge} doc={doc} unit={unit} requestedPage={null} pending={disabled} /></details>}
        <button className="primary-button study-next" disabled={disabled} onClick={() => run(async () => { const next = await bridge.studySession({ type: 'step', documentId: doc.id, step: 'check' }); if (live.current) setWorkspace(next); })}>{t('study.tryQuestion')}</button>
      </section> : session.step === 'check' ? <section className="study-turn"><h3>{t('study.answerHelp')}</h3><p className="study-question" lang={session.responseLanguage ?? 'ko'}>{studyQuestion(session)}</p><label className="field-label">{t('study.answer')}<textarea lang="" className="study-answer" value={answer} maxLength={10000} disabled={answerDisabled} onChange={event => editAnswer(event.target.value)} placeholder={t('study.answerPlaceholder')} /></label><p className="small-copy">{t('count.characters', { count: answer.length })} · {answer === session.answer ? t('study.savedAnswer') : t('study.draftAnswer')}</p><div className="study-actions"><button className="secondary-button" disabled={disabled || !answer.trim()} onClick={() => run(() => saveAnswer(false, false))}>{t('study.saveAnswer')}</button><button className="primary-button" disabled={disabled || !answer.trim() || !aiAvailable} onClick={() => run(feedback)}>{t('study.answerFeedback')}</button><button className="secondary-button" disabled={disabled || !answer.trim()} onClick={() => run(() => saveAnswer(false, true))}>{t('study.saveAndNote')}</button><button className="secondary-button" disabled={disabled} onClick={() => run(relearn)}>{t('study.unknown')}</button></div><p className="small-copy">{t('study.feedbackSend', { provider: explanationProvider(state.library.selectedModel) })}</p>{!aiAvailable && <p className="small-copy">{aiDisabledReason}<button className="text-button" disabled={disabled} onClick={onConnect}>{t('account.studySettings')}</button></p>}{currentFeedback && <AnswerFeedbackContents value={currentFeedback} />}{session.answerFeedback && !currentFeedback && <p className="small-copy">{t('study.feedbackStale')}</p>}<details><summary>{t('study.sourceIfStuck')}</summary><pre className="study-source" lang="">{passage}</pre></details><button className="text-button" disabled={disabled} onClick={() => run(async () => { const next = await bridge.studySession({ type: 'step', documentId: doc.id, step: 'explain' }); if (live.current) setWorkspace(next); })}>{t('study.backExplain')}</button><button className="text-button" disabled={disabled} onClick={() => run(() => saveAnswer(true, true))}>{t('study.saveUnknown')}</button></section> : session.step === 'note' ? <section className="study-turn"><h3>{t('study.notePrompt')}</h3><p className="study-origin">{session.answerFeedback ? t('study.saveFeedbackHelp') : session.guide ? t('study.saveAiHelp') : t('study.saveSourceHelp')}</p><p className="preserve-text" lang={session.guide ? session.guide.identity?.responseLanguage ?? session.responseLanguage ?? 'ko' : ''}>{session.guide?.overview ?? passage}</p><h4>{t('study.answer')}</h4>{session.unknown && <p>{t('study.unknownNote')}</p>}{session.answer && <p className="preserve-text" lang="">{session.answer}</p>}{session.answerFeedback && <AnswerFeedbackContents value={session.answerFeedback} />}<p className="small-copy">{t('study.notePreviewSource', { title: doc.title, index: session.passageIndex + 1, count: session.terms.length })}{page ? ` · ${t('pdf.page', { page })}` : ''}</p><div className="study-actions"><button className="primary-button" disabled={disabled} onClick={() => run(async () => { const value = await bridge.saveStudyNote(doc.id); if (live.current) setWorkspace(value); })}>{t('study.saveNote')}</button><button className="text-button" disabled={disabled} onClick={() => run(async () => { const value = await bridge.studySession({ type: 'step', documentId: doc.id, step: 'check' }); if (live.current) setWorkspace(value); })}>{t('study.editAnswer')}</button></div></section> : <section className="study-turn study-complete"><h3>{t('study.completed')}</h3><p>{t('study.savedNoteHelp')}</p><div className="study-actions"><button className="secondary-button" disabled={disabled} onClick={() => setStarted(false)}>{t('study.finish')}</button><button className="primary-button" disabled={disabled || terminal} onClick={() => run(async () => { const value = await bridge.studySession({ type: 'next', documentId: doc.id }); if (live.current) setWorkspace(value); })}>{t('study.next')}</button></div>{terminal && <p className="small-copy">{t('study.terminal')}</p>}</section>}

      <SourceTranslationPanel bridge={bridge} state={state} doc={doc} unitId={session.unitId} disabled={pending || working || loading} />
      <TermLookup key={`${key}:${scope.kind}:${scope.kind === 'folder' ? scope.folderId : ''}`} scope={scope} scopeName={scopeName} provider={explanationProvider(state.library.selectedModel)} bridge={bridge} documentId={doc.id} disabled={disabled} aiAvailable={aiAvailable} request={request} add={addTerm} />
    </> : <p role="alert">{t('study.locationMissing')}</p>}
    {working && <p role="status" className="small-copy">{t('common.processing')}{state.busy?.kind === 'feedback' ? t('study.waitingFeedback') : state.busy ? t('study.waitingAi') : ''}</p>}{state.busy && <button className="text-button" onClick={() => { void bridge.cancelRequest().catch(cause => setError(errorText(cause))); }}>{t('study.cancelAi')}</button>}
    <details className="study-notes"><summary>{t('study.savedNotes', { count: workspace?.notes.length ?? 0 })}</summary>{workspace?.notes.length ? workspace.notes.map(note => <details key={note.id} className="saved-note"><summary>{note.page ? `${t('pdf.page', { page: note.page })} · ` : ''}{t('study.savedNoteHeading', { index: note.passageIndex + 1, date: formatDate(note.updatedAt) })}</summary><NoteContents note={note} open={openEvidence} disabled={disabled} doc={doc} bridge={bridge} /></details>) : <p className="small-copy">{t('study.noNotesHelp')}</p>}</details>
  </main>;
}
