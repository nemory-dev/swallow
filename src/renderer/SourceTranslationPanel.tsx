import { useEffect, useRef, useState } from 'react';
import { unitPage } from '../learning/pdf.js';
import { aiUnavailableReason } from '../shared/ai.js';
import type { AppState, ReadingUnit, ResponseLanguage, SourceTranslation, StudyDocument, SwallowBridge, TranslationScope } from '../shared/types.js';
import { useLanguage } from './LanguageContext.js';

export function SourceTranslationPanel({ bridge, state, doc, unitId, disabled = false }: {
  bridge: SwallowBridge; state: AppState; doc: StudyDocument; unitId: string; disabled?: boolean;
}) {
  const { t, localizeText, errorText, formatDate } = useLanguage();
  const [targetLanguage, setTargetLanguage] = useState<ResponseLanguage>('ko');
  const [requestPending, setRequestPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [failure, setFailure] = useState<{ context: string; text: string } | null>(null);
  const requestLock = useRef(false);
  const cancelLock = useRef(false);
  const live = useRef(true);
  const context = JSON.stringify([doc.id, unitId, state.library.selectedModel, targetLanguage]);
  const currentContext = useRef(context); currentContext.current = context;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const unit = doc.units.find(item => item.id === unitId);
  const hasText = (item: ReadingUnit) => !!item.text.trim() && unitPage(doc, item)?.method !== 'empty';
  const unavailable = aiUnavailableReason(state, bridge.mode === 'desktop');
  const busy = state.busy?.kind === 'translation' && state.busy.documentId === doc.id ? state.busy : null;
  const blocked = disabled || requestPending || !!state.busy || !!unavailable;
  const saved = doc.units.flatMap(item => {
    const translation = doc.translations?.[item.id]?.[targetLanguage];
    return translation && translation.sourceText === item.text ? [{ unit: item, translation }] : [];
  });
  const current = saved.find(item => item.unit.id === unitId);
  const location = (item: ReadingUnit) => {
    const page = unitPage(doc, item)?.page;
    return `${t('reading.unit', { index: doc.units.findIndex(value => value.id === item.id) + 1 })}${page ? ` · ${t('pdf.page', { page })}` : ''}${item.section && !page ? ` · ${item.section}` : ''}`;
  };

  async function translate(scope: TranslationScope) {
    if (requestLock.current || blocked || !unit || (scope === 'unit' ? !hasText(unit) : !doc.units.some(hasText))) return;
    const requestedContext = context;
    requestLock.current = true; setRequestPending(true); setFailure(null);
    try { await bridge.translateDocument(doc.id, targetLanguage, scope, scope === 'unit' ? unitId : undefined); }
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
    return <><p className="translation-review-status">{t('translation.reviewStatus')}</p><div className="translation-comparison"><div><h4>{t('document.source')}</h4><p className="preserve-text" lang="">{translation.sourceText}</p></div><div><h4>{t('translation.resultLanguage', { language: t(targetLanguage === 'ko' ? 'language.ko' : 'language.en') })}</h4><p className="preserve-text" lang={translation.targetLanguage}>{translation.text}</p></div></div><p className="small-copy translation-metadata">{t('translation.savedWith', { model: state.models.find(model => model.slug === translation.model)?.displayName ?? translation.identity.upstreamModelId, date: formatDate(translation.createdAt) })}</p></>;
  }

  return <section className="source-translation" aria-label={t('translation.title')}>
    <h3>{t('translation.title')}</h3>
    <p className="small-copy">{t('translation.help')}</p>
    <div className="translation-controls"><label>{t('translation.targetLanguage')}<select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value as ResponseLanguage)}><option value="ko">{t('language.ko')}</option><option value="en">{t('language.en')}</option></select></label><button className="secondary-button" disabled={blocked || !unit || !hasText(unit)} onClick={() => { void translate('unit'); }}>{t('translation.current')}</button><button className="secondary-button" disabled={blocked || !doc.units.some(hasText)} onClick={() => { void translate('document'); }}>{t('translation.document')}</button></div>
    {unavailable && <p className="small-copy">{t('translation.connectHelp')}</p>}
    {unit && !hasText(unit) && <p className="small-copy">{t('translation.noText')}</p>}
    {doc.pdf && <p className="small-copy">{t('translation.pdfText')}</p>}
    {(busy || requestPending) && <div className="translation-progress" role="status"><p>{busy?.progress ? t('translation.progress', { count: busy.progress.completed, total: busy.progress.total }) : t('translation.processing')}{busy?.targetLanguage ? ` · ${t(busy.targetLanguage === 'ko' ? 'language.ko' : 'language.en')}` : ''}</p>{busy && <button className="text-button" disabled={cancelPending} onClick={() => { void cancel(); }}>{cancelPending ? t('translation.cancelling') : t('translation.cancel')}</button>}</div>}
    {failure?.context === context && <p className="inline-error" role="alert">{localizeText(failure.text)}</p>}
    {current ? <div className="translation-current"><h4>{t('translation.savedCurrent', { location: location(current.unit) })}</h4>{comparison(current.translation)}</div> : <p className="small-copy translation-empty">{t('translation.noSavedCurrent')}</p>}
    <details className="translation-saved"><summary>{t('translation.savedDocument', { count: saved.length, total: doc.units.filter(hasText).length })}</summary><p className="small-copy">{t('translation.savedHelp')}</p>{saved.map(item => <details key={item.unit.id} className="translation-saved-unit"><summary>{location(item.unit)}</summary>{comparison(item.translation)}</details>)}{!saved.length && <p className="small-copy">{t('translation.noSavedDocument')}</p>}</details>
  </section>;
}
