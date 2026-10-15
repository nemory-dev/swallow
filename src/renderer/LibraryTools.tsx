import { useLanguage } from './LanguageContext.js';
import { useRef, useState } from 'react';
import type { DocumentSummary, EvidenceReference, SearchHit, StorageInfo, SwallowBridge, LibraryScope } from '../shared/types.js';

export function LibraryTools({ bridge, documents, storage, open, archive, pending, scope, scopeName }: {
  bridge: SwallowBridge; documents: DocumentSummary[]; storage?: StorageInfo; pending: boolean;
  open: (reference: EvidenceReference) => Promise<void>; archive: () => Promise<void>;
  scope: LibraryScope; scopeName: string;
}) {
  const { t, errorText, localizeText } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState('');
  async function perform(operation: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(null); setMessage('');
    try { await operation(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <>
    <button className="import-button" disabled={pending} onClick={() => dialog.current?.showModal()}>{t('library.title')} <span>{t('library.local')}</span></button>
    <dialog ref={dialog} className="library-tools" aria-labelledby="library-tools-title">
      <div className="panel-heading"><h2 id="library-tools-title">{t('library.title')}</h2><button className="secondary-button" disabled={busy} onClick={() => dialog.current?.close()}>{t('common.close')}</button></div>
      <p className="small-copy">{t('library.searchHelp')}</p>
      <p className="small-copy">{t('library.scope', { name: scopeName })}</p>
      <form className="library-search-form" onSubmit={event => { event.preventDefault(); void perform(async () => { setResults(await bridge.searchLibrary(query, scope)); setSearched(true); }); }}>
        <label className="sr-only" htmlFor="library-search">{t('library.query')}</label><input id="library-search" autoFocus value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setSearched(false); setResults([]); }} placeholder={t('library.queryPlaceholder')} disabled={busy} />
        <button className="primary-button" disabled={busy || !query.trim()}>{t('library.search')}</button>
      </form>
      {busy && <p role="status">{t('common.processing')}</p>}{error && <p role="alert" className="inline-error">{localizeText(error)}</p>}{message && <p role="status">{localizeText(message)}</p>}
      {searched && <p className="small-copy">{results.length ? t('library.resultsLimit', { max: 20, count: results.length }) : t('library.noResults')}</p>}
      <ol className="search-results">{results.map(hit => <li key={`${hit.documentId}:${hit.unitId}`}>
        <strong>{hit.title}</strong><p className="small-copy">{hit.page ? t('pdf.page', { page: hit.page }) : hit.section} · {hit.archived ? t('library.archived') : t('library.material')}</p>
        <blockquote lang="">{hit.excerpt}</blockquote><button className="text-button" disabled={busy} onClick={() => void perform(async () => { await open(hit); dialog.current?.close(); })}>{hit.archived ? `${t('library.restoreAndOpen')} ↗` : `${t('library.openEvidence')} ↗`}</button>
      </li>)}</ol>
      <details className="storage-controls"><summary>{t('library.storage')}</summary>
        <p className="small-copy">{t('library.storageCounts', { active: storage?.activeCount ?? 0, archived: storage?.archivedCount ?? 0 })}</p>
        {storage?.migration && <p className="small-copy">{t('library.migration', { count: storage.migration.documents, total: storage.migration.units, active: storage.migration.recalls, archived: storage.migration.pdfs })}</p>}
        <button className="secondary-button" disabled={busy || pending} onClick={() => void perform(async () => { await archive(); setSearched(false); setResults([]); setMessage(t('library.archivedMessage')); })}>{t('library.archive')}</button>
        <label className="archive-setting"><input type="checkbox" checked={storage?.autoArchive ?? false} disabled={busy} onChange={event => { const enabled = event.target.checked; void perform(() => bridge.setAutoArchive(enabled)); }} />{t('library.autoArchive')}</label>
        <p className="small-copy">{t('library.autoArchiveHelp')}</p>
        <button className="secondary-button" disabled={busy} onClick={() => void perform(async () => { await bridge.compactStorage(); setMessage(t('library.compactedMessage')); })}>{t('library.compact')}</button>
        <ul className="archive-list">{documents.filter(doc => doc.archived).map(doc => <li key={doc.id}><span>{doc.title}</span><button className="text-button" disabled={busy} onClick={() => void perform(async () => { await bridge.restoreDocument(doc.id); setResults([]); setSearched(false); setMessage(t('library.restoredMessage')); })}>{t('library.restore')}</button></li>)}</ul>
      </details>
    </dialog>
  </>;
}
