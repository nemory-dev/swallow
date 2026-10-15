import { useLanguage } from './LanguageContext.js';
import type { LibraryScope } from '../shared/types.js';
import { useRef, useState } from 'react';
import type { SearchHit, StudyNote, SwallowBridge, TermNote } from '../shared/types.js';

export function TermLookup({ provider, bridge, documentId, disabled, aiAvailable, add, request, scope, scopeName }: {
  scope: LibraryScope; scopeName: string;
  provider?: string; bridge: SwallowBridge; documentId: string; disabled: boolean; aiAvailable: boolean;
  add: (term: TermNote) => Promise<void>; request: (operation: () => Promise<void>) => Promise<void>;
}) {
  const { t, errorText, localizeText } = useLanguage();
  const [term, setTerm] = useState('');
  const [url, setUrl] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<TermNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const resultTerm = useRef('');
  const query = term.trim();
  const run = (operation: () => Promise<void>) => { setError(null); void request(operation).catch(cause => setError(errorText(cause, 'errors.term'))); };
  const save = (value: TermNote) => run(async () => { await add(value); setAdded(true); });
  return <details className="term-lookup"><summary>{t('term.title')}</summary>
    <p className="small-copy">{t('term.scopeHelp', { name: scopeName })}</p>
    <label className="field-label">{t('term.input')}<input value={term} maxLength={120} disabled={disabled} onChange={event => { setTerm(event.target.value); setResult(null); setHits([]); setNotes([]); setSearched(false); setAdded(false); }} placeholder={t('term.placeholder')} /></label>
    <div className="study-actions"><button className="text-button" disabled={disabled} onClick={() => { const selected = window.getSelection()?.toString().trim() ?? ''; if (selected.length > 120) { setError('용어는 120자 이내로 선택해 주세요.'); return; } if (!selected) { setError('원문에서 용어를 선택한 뒤 눌러 주세요.'); return; } setTerm(selected); setResult(null); setHits([]); setNotes([]); setSearched(false); setAdded(false); }}>{t('term.selection')}</button>
      <button className="secondary-button" disabled={disabled || !query} onClick={() => run(async () => { const [sources, saved] = await Promise.all([bridge.searchLibrary(query, scope), bridge.searchStudyNotes(query, scope)]); resultTerm.current = query; setHits(sources); setNotes(saved); setResult(null); setSearched(true); setAdded(false); })}>{t('term.search')}</button>
      <button className="text-button" disabled={disabled || !query || !aiAvailable} onClick={() => run(async () => { setResult(await bridge.explainTerm(documentId, query)); setAdded(false); })}>{t('term.ask')}</button>
    </div>
    <p className="small-copy">{t('term.providerHelp', { provider: provider ?? t('term.selectedProvider') })}</p>
    {error && <p className="inline-error" role="alert">{localizeText(error)}</p>}
    {searched && <div className="term-results" aria-label={t('term.resultsRegion')}>{hits.length + notes.length === 0 && <p>{t('term.noResults')}</p>}
      {hits.map((hit, index) => <article key={`${hit.documentId}:${hit.unitId}:${index}`}><strong>{t('term.sourceTitle', { title: hit.title })}{hit.page ? ` · ${t('pdf.page', { page: hit.page })}` : ''}</strong><blockquote lang="">{hit.excerpt}</blockquote><button className="text-button" disabled={disabled || added} onClick={() => save({ term: resultTerm.current, explanation: hit.excerpt, kind: 'source', sourceTitle: hit.title, quote: hit.excerpt, reference: { documentId: hit.documentId, unitId: hit.unitId, sourceHash: hit.sourceHash } })}>{t('term.addSource')}</button></article>)}
      {notes.map(note => <article key={note.id}><strong>{t('term.savedNoteTitle', { title: note.title })}</strong><p>{note.summaryOrigin === 'ai' ? t('term.aiNoteOrigin') : t('term.sourceNoteOrigin')}</p>{note.summaryOrigin === 'source' ? <><h4>{t('study.sourceExcerpt')}</h4><p className="preserve-text" lang="">{note.sourceExcerpt}</p></> : <p className="preserve-text" lang={note.responseLanguage ?? note.guideIdentity?.responseLanguage ?? 'ko'}>{note.summary}</p>}<button className="text-button" disabled={disabled || added} onClick={() => save({ term: resultTerm.current, explanation: note.summary.slice(0, 6000), kind: 'note', sourceTitle: note.title, quote: note.sourceExcerpt, reference: note.source })}>{t('term.addNote')}</button></article>)}
    </div>}
    <details className="term-web"><summary>{t('term.web')}</summary><p className="small-copy">{t('term.webHelp')}</p><button className="secondary-button" disabled={disabled || !query} onClick={() => run(() => bridge.openTermSearch(query))}>{t('term.openSearch')}</button>
      <label className="field-label">{t('term.url')}<input type="url" value={url} maxLength={4096} disabled={disabled} onChange={event => { setUrl(event.target.value); setResult(null); setAdded(false); }} placeholder="https://…" /></label><p className="small-copy">{t('term.urlSendHelp', { provider: provider ?? t('term.selectedProvider') })}</p><button className="secondary-button" disabled={disabled || !query || !url.trim() || !aiAvailable} onClick={() => run(async () => { setResult(await bridge.explainTerm(documentId, query, url.trim())); setAdded(false); })}>{t('term.findUrl')}</button>
    </details>
    {result && <article className="term-result"><strong>{result.kind === 'web' ? t('term.urlExplanation') : t('term.aiExplanation')} · {result.term}</strong><p className="preserve-text" lang={result.responseLanguage ?? result.identity?.responseLanguage ?? 'ko'}>{result.explanation}</p>{result.sourceUrl && <p className="source-url">{t('common.sourceUrl', { url: result.sourceUrl })}</p>}{result.quote && <blockquote lang="">{result.quote}</blockquote>}<p className="small-copy">{t('study.checkAi')}</p><button className="secondary-button" disabled={disabled || added} onClick={() => save(result)}>{t('term.add')}</button></article>}
    {added && <p role="status" className="small-copy">{t('term.added')}</p>}
  </details>;
}
