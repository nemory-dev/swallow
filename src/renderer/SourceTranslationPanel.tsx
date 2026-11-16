import { useRef, useState } from 'react';
import { unitPage } from '../learning/pdf.js';
import { readingPassages } from '../learning/reading.js';
import { compareTranslationNumbers, translationPassage, translationSentencePairs } from '../learning/translation.js';
import { aiUnavailableReason } from '../shared/ai.js';
import type { AppState, ReadingUnit, ResponseLanguage, SourceTranslation, StudyDocument, SwallowBridge, TranslationScope } from '../shared/types.js';
import { useLanguage } from './LanguageContext.js';
import type { TranslationControls } from './TranslationStatus.js';

export function SourceTranslationPanel({ bridge, state, doc, unitId, passageIndex, translation, disabled = false }: {
  bridge: SwallowBridge; state: AppState; doc: StudyDocument; unitId: string; passageIndex?: number; disabled?: boolean;
  translation: TranslationControls;
}) {
  const { t, formatDate } = useLanguage();
  const [targetLanguage, setTargetLanguage] = useState<ResponseLanguage>('ko');
  const savedDraft = useRef<HTMLDetailsElement>(null);

  const unit = doc.units.find(item => item.id === unitId);
  const hasText = (item: ReadingUnit) => !!item.text.trim() && unitPage(doc, item)?.method !== 'empty';
  const passages = unit && passageIndex !== undefined ? readingPassages(unit.text, doc.passageVersion ?? 1) : [];
  const currentSource = passageIndex === undefined ? unit?.text : passages[passageIndex];
  const canTranslateCurrent = !!unit && !!currentSource?.trim() && hasText(unit);
  const unavailable = aiUnavailableReason(state, bridge.mode === 'desktop');
  const { pendingScope, start } = translation;
  const blocked = disabled || !!pendingScope || !!state.busy || !!unavailable;
  const translatableUnits = doc.units.filter(hasText);
  const savedCount = translatableUnits.filter(item => doc.translations?.[item.id]?.[targetLanguage]?.sourceText === item.text).length;
  const unitDraft = doc.translations?.[unitId]?.[targetLanguage];
  const validUnitDraft = unitDraft?.sourceText === unit?.text ? unitDraft : undefined;
  const passageDraft = passageIndex === undefined ? undefined : doc.passageTranslations?.[unitId]?.[passageIndex]?.[targetLanguage];
  const current = passageDraft?.sourceText === currentSource && passageDraft ? passageDraft
    : passageIndex === undefined ? validUnitDraft
    : validUnitDraft && translationPassage(validUnitDraft, passages, passageIndex);
  const location = (item: ReadingUnit) => {
    const page = unitPage(doc, item)?.page;
    return `${t('reading.unit', { index: doc.units.findIndex(value => value.id === item.id) + 1 })}${page ? ` · ${t('pdf.page', { page })}` : ''}${item.section && !page ? ` · ${item.section}` : ''}`;
  };

  function translate(scope: TranslationScope) {
    if (savedDraft.current) savedDraft.current.open = true;
    void start(doc.id, targetLanguage, scope, scope === 'document' ? undefined : unitId, scope === 'passage' ? passageIndex : undefined);
  }
  function renderDraft(translation: SourceTranslation) {
    return <><p className="translation-review-status">{t('translation.reviewStatus')}</p>
      {!translation.sentenceEnds && <p className="small-copy">{t('translation.regenerateForSentences')}</p>}
      <p className="translation-text preserve-text" lang={translation.targetLanguage}>{translationSentencePairs(translation).map(({ source, text }, index) => {
          const differences = translation.sentenceEnds ? compareTranslationNumbers(source, text) : null;
          if (!differences || (!differences.source.length && !differences.translation.length))
            return <span key={index}>{text || t('translation.missingSentence')}</span>;
          const detail = t('translation.numberSource', { values: differences.source.join(' · ') || t('translation.numberMissing') })
            + ' → ' + t('translation.numberDraft', { values: differences.translation.join(' · ') || t('translation.numberMissing') });
          const content = text.trimEnd();
          return <span key={index}>{content || t('translation.missingSentence')} <small className="translation-numbers" title={detail}>
            ({t('translation.numberMismatch')})<span className="sr-only"> {detail}</span>
          </small>{text.slice(content.length)}</span>;
        })}</p>
      <p className="small-copy translation-metadata">{t('translation.savedWith', { model: state.models.find(model => model.slug === translation.model)?.displayName ?? translation.identity.upstreamModelId, date: formatDate(translation.createdAt) })}</p></>;
  }

  return <section className="source-translation" aria-label={t('translation.title')}>
    <h3>{t('translation.title')}</h3>
    <p className="small-copy">{t(passageIndex === undefined ? 'translation.help' : 'translation.passageHelp')}</p>
    <div className="translation-controls"><label>{t('translation.targetLanguage')}<select value={targetLanguage} onChange={event => setTargetLanguage(event.target.value as ResponseLanguage)}><option value="ko">{t('language.ko')}</option><option value="en">{t('language.en')}</option></select></label><button className="secondary-button" disabled={blocked || !canTranslateCurrent} onClick={() => translate(passageIndex === undefined ? 'unit' : 'passage')}>{t(pendingScope && pendingScope !== 'document' ? 'translation.processing' : 'translation.current')}</button><button className="secondary-button" disabled={blocked || !translatableUnits.length} onClick={() => translate('document')}>{t(pendingScope === 'document' ? 'translation.processingDocument' : 'translation.document')}</button></div>
    {unavailable && <p className="small-copy">{t('translation.connectHelp')}</p>}
    {unit && !canTranslateCurrent && <p className="small-copy">{t('translation.noText')}</p>}
    {doc.pdf && <p className="small-copy">{t('translation.pdfText')}</p>}
    <details className="translation-saved" ref={savedDraft}>
      <summary>{t('translation.viewSavedDraft')}</summary>
      {unit && current ? <div className="translation-current"><h4>{t('translation.savedCurrent', { location: passageIndex === undefined ? location(unit) : location(unit) + ' · ' + t('study.partPosition', { index: passageIndex + 1, total: passages.length }) })}</h4>{renderDraft(current)}</div> : <p className="small-copy translation-empty">{t(validUnitDraft ? 'translation.regenerateForPassages' : 'translation.noSavedCurrent')}</p>}
      {savedCount > 0 && <p className="small-copy translation-metadata">{t('translation.savedDocument', { count: savedCount, total: translatableUnits.length })}</p>}
    </details>
  </section>;
}
