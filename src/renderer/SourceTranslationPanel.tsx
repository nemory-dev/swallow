import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { unitPage } from '../learning/pdf.js';
import { readingPassages } from '../learning/reading.js';
import { compareTranslationNumbers, translationSentencePairs } from '../learning/translation.js';
import { aiUnavailableReason } from '../shared/ai.js';
import type { AppState, ReadingUnit, ResponseLanguage, SourceTranslation, StudyDocument, SwallowBridge, TranslationScope } from '../shared/types.js';
import { useLanguage } from './LanguageContext.js';

function SavedTranslationUnit({ title, renderDraft }: { title: string; renderDraft: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="translation-saved-unit" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>
    {open && renderDraft()}
  </details>;
}

export function SourceTranslationPanel({ bridge, state, doc, unitId, passageIndex, disabled = false }: {
  bridge: SwallowBridge; state: AppState; doc: StudyDocument; unitId: string; passageIndex?: number; disabled?: boolean;
}) {
  const { t, localizeText, errorText, formatDate } = useLanguage();
  const [targetLanguage, setTargetLanguage] = useState<ResponseLanguage>('ko');
  const [requestPending, setRequestPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [failure, setFailure] = useState<{ context: string; text: string } | null>(null);
  const requestLock = useRef(false);
  const cancelLock = useRef(false);
  const savedDetails = useRef<HTMLDetailsElement>(null);
  const live = useRef(true);
  const context = JSON.stringify([doc.id, unitId, passageIndex, state.library.selectedModel, targetLanguage]);
  const currentContext = useRef(context); currentContext.current = context;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const unit = doc.units.find(item => item.id === unitId);
  const hasText = (item: ReadingUnit) => !!item.text.trim() && unitPage(doc, item)?.method !== 'empty';
  const passages = unit && passageIndex !== undefined ? readingPassages(unit.text) : [];
  const currentSource = passageIndex === undefined ? unit?.text : passages[passageIndex];
  const canTranslateCurrent = !!unit && !!currentSource?.trim() && hasText(unit);
  const unavailable = aiUnavailableReason(state, bridge.mode === 'desktop');
  const busy = state.busy?.kind === 'translation' && state.busy.documentId === doc.id ? state.busy : null;
  const blocked = disabled || requestPending || !!state.busy || !!unavailable;
  const saved = doc.units.flatMap(item => {
    const translation = doc.translations?.[item.id]?.[targetLanguage];
    return translation && translation.sourceText === item.text ? [{ unit: item, translation }] : [];
  });
  const current = passageIndex === undefined ? doc.translations?.[unitId]?.[targetLanguage] : doc.passageTranslations?.[unitId]?.[passageIndex]?.[targetLanguage];
  const location = (item: ReadingUnit) => {
    const page = unitPage(doc, item)?.page;
    return `${t('reading.unit', { index: doc.units.findIndex(value => value.id === item.id) + 1 })}${page ? ` · ${t('pdf.page', { page })}` : ''}${item.section && !page ? ` · ${item.section}` : ''}`;
  };

  async function translate(scope: TranslationScope) {
    if (requestLock.current || blocked || (scope === 'document' ? !doc.units.some(hasText) : !canTranslateCurrent)) return;
    const requestedContext = context;
    requestLock.current = true; setRequestPending(true); setFailure(null);
    if (scope === 'document' && savedDetails.current) savedDetails.current.open = true;
    try { await bridge.translateDocument(doc.id, targetLanguage, scope, scope === 'document' ? undefined : unitId, scope === 'passage' ? passageIndex : undefined); }
    catch (cause) { if (live.current && currentContext.current === requestedContext) setFailure({ context: requestedContext, text: errorText(cause) }); }
    finally { requestLock.current = false; if (live.current) setRequestPending(false); }
  }
  async function cancel() {
    if (cancelLock.current || !busy) return;
    const requestedContext = context;
    cancelLock.current = true; setCancelPending(true);
    try { await bridge.cancelRequest(); }
    catch (cause) { if (live.current && currentContext.current === requestedContext) setFailure({ context: requestedContext, text: errorText(cause) }); }
    finally { cancelLock.current = false; if (live.current) setCancelPending(false); }
  }
  function comparison(translation: SourceTranslation) {
    return <><p className="translation-review-status">{t('translation.reviewStatus')}</p>
      {!translation.sentenceEnds && <p className="small-copy">{t('translation.regenerateForSentences')}</p>}
      <table className="translation-comparison">
        <thead><tr>
          <th scope="col">{t('document.source')}</th>
          <th scope="col">{t('translation.resultLanguage', { language: t(translation.targetLanguage === 'ko' ? 'language.ko' : 'language.en') })}</th>
        </tr></thead>
        <tbody>{translationSentencePairs(translation).map(({ source, text }, index) => {
          const differences = translation.sentenceEnds ? compareTranslationNumbers(source, text) : null;
          return <tr key={index}>
            <td><p className="preserve-text" lang="">{source}</p></td>
            <td>
              {text.trim() ? <p className="preserve-text" lang={translation.targetLanguage}>{text}</p> : <p>{t('translation.missingSentence')}</p>}
              {differences && (differences.source.length > 0 || differences.translation.length > 0) && <div className="translation-numbers">
                <strong>{t('translation.numberMismatch')}</strong>
                <p>{t('translation.numberSource', { values: differences.source.join(' · ') || t('translation.numberMissing') })}</p>
                <p>{t('translation.numberDraft', { values: differences.translation.join(' · ') || t('translation.numberMissing') })}</p>
              </div>}
            </td>
          </tr>;
        })}</tbody>
      </table>
      <p className="small-copy translation-metadata">{t('translation.savedWith', { model: state.models.find(model => model.slug === translation.model)?.displayName ?? translation.identity.upstreamModelId, date: formatDate(translation.createdAt) })}</p></>;
  }

  return <section className="source-translation" aria-label={t('translation.title')}>
    <h3>{t('translation.title')}</h3>
    <p className="small-copy">{t(passageIndex === undefined ? 'translation.help' : 'translation.passageHelp')}</p>
    <div className="translation-controls"><label>{t('translation.targetLanguage')}<select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value as ResponseLanguage)}><option value="ko">{t('language.ko')}</option><option value="en">{t('language.en')}</option></select></label><button className="secondary-button" disabled={blocked || !canTranslateCurrent} onClick={() => { void translate(passageIndex === undefined ? 'unit' : 'passage'); }}>{t('translation.current')}</button><button className="secondary-button" disabled={blocked || !doc.units.some(hasText)} onClick={() => { void translate('document'); }}>{t('translation.document')}</button></div>
    {unavailable && <p className="small-copy">{t('translation.connectHelp')}</p>}
    {unit && !canTranslateCurrent && <p className="small-copy">{t('translation.noText')}</p>}
    {doc.pdf && <p className="small-copy">{t('translation.pdfText')}</p>}
    {(busy || requestPending) && <div className="translation-progress" role="status"><p>{busy?.progress ? t('translation.progress', { count: busy.progress.completed, total: busy.progress.total }) : t('translation.processing')}{busy?.targetLanguage ? ` · ${t(busy.targetLanguage === 'ko' ? 'language.ko' : 'language.en')}` : ''}</p>{busy && <button className="text-button" disabled={cancelPending} onClick={() => { void cancel(); }}>{cancelPending ? t('translation.cancelling') : t('translation.cancel')}</button>}</div>}
    {failure?.context === context && <p className="inline-error" role="alert">{localizeText(failure.text)}</p>}
    {unit && current && current.sourceText === currentSource ? <div className="translation-current"><h4>{t('translation.savedCurrent', { location: passageIndex === undefined ? location(unit) : location(unit) + ' · ' + t('study.partPosition', { index: passageIndex + 1, total: passages.length }) })}</h4>{comparison(current)}</div> : <p className="small-copy translation-empty">{t('translation.noSavedCurrent')}</p>}
    <details className="translation-saved" ref={savedDetails}>
      <summary>{t('translation.savedDocument', { count: saved.length, total: doc.units.filter(hasText).length })}</summary>
      <p className="small-copy">{t('translation.savedHelp')}</p>
      {saved.map(({ unit: savedUnit, translation }) => <SavedTranslationUnit key={doc.id + ':' + savedUnit.id} title={location(savedUnit)} renderDraft={() => comparison(translation)} />)}
      {!saved.length && <p className="small-copy">{t('translation.noSavedDocument')}</p>}
    </details>
  </section>;
}
