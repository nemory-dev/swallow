import { useLanguage } from './LanguageContext.js';
import { useEffect, useRef, useState } from 'react';
import type { AddDocumentInput, SwallowBridge } from '../shared/types.js';

export function AddDocumentDialog({ bridge, onClose, onAdd, pending, error, folderName }: {
  bridge: SwallowBridge; onClose: () => void; onAdd: (input: AddDocumentInput) => Promise<boolean>; pending: boolean; error: string | null;
  folderName: string;
}) {
  const { t, errorText, localizeText } = useLanguage();
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const fetchPending = useRef(false);
  useEffect(() => { live.current = true; dialogRef.current?.showModal(); titleInput.current?.focus(); return () => { live.current = false; }; }, []);
  const busy = pending || fetching;
  async function importUrl() {
    if (fetchPending.current) return;
    if (source.trim() && !window.confirm(t('document.replaceConfirm'))) return;
    fetchPending.current = true; setFetching(true); setFetchError(null);
    try {
      const result = await bridge.fetchDocumentUrl(url.trim());
      if (live.current) { setTitle(result.title); setSource(result.source); setSourceUrl(result.sourceUrl); }
    } catch (cause) { if (live.current) setFetchError(errorText(cause, 'errors.documentImport')); }
    finally { fetchPending.current = false; if (live.current) setFetching(false); }
  }
  return <dialog ref={dialogRef} className="document-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy) void onAdd({ title: (title.trim() || source.split(/\r?\n/).map(line => line.replace(/^\s*#+\s*/, '').trim()).find(Boolean) || t('document.newTitle')).slice(0, 160), goal, source, ...(sourceUrl ? { sourceUrl } : {}) }); }}>
      <div className="panel-heading"><h2>{t('document.add')}</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label={t('document.closeAdd')}>×</button></div>
      <p className="small-copy">{t('document.pasteHelp')}</p>
      <p className="small-copy">{t('document.location', { name: folderName })}</p>
      <label className="field-label">{t('document.url')} <span className="optional">{t('common.optional')}</span><div className="url-input-row"><input type="url" aria-label={t('document.url')} value={url} maxLength={4096} disabled={busy} onChange={event => setUrl(event.target.value)} placeholder="https://react.dev/learn" /><button type="button" className="secondary-button" disabled={busy || !url.trim()} onClick={() => void importUrl()}>{fetching ? t('document.fetching') : t('document.fetch')}</button></div></label>
      <p className="small-copy">{t('document.importDesktopHelp')}</p>
      {(error || fetchError) && <p className="inline-error" role="alert">{(fetchError ?? error) ? localizeText((fetchError ?? error)!) : null}</p>}
      {sourceUrl && <p className="imported-source" role="status">{t('document.imported', { url: sourceUrl })}<br />{t('document.importedHelp')}</p>}
      <label className="field-label">{t('document.title')} <span className="optional">{t('document.titleHelp')}</span><input ref={titleInput} value={title} maxLength={160} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder={t('document.titlePlaceholder')} /></label>
      <label className="field-label">{t('document.goal')} <span className="optional">{t('common.optional')}</span><input value={goal} maxLength={1000} disabled={busy} onChange={event => setGoal(event.target.value)} placeholder={t('document.goalPlaceholder')} /></label>
      <label className="field-label">{t('document.source')}<textarea lang="" className="source-input" value={source} maxLength={1_000_000} required disabled={busy} onChange={event => setSource(event.target.value)} placeholder={t('document.sourcePlaceholder')} /></label>
      <div className="dialog-footer"><span className="small-copy">{t('document.characterLimit', { count: source.length, max: 1_000_000 })} · {bridge.mode === 'browser' ? t('document.browserLimit', { max: 20 }) : t('document.localStorage')}</span><button className="primary-button" disabled={busy || !source.trim()}>{pending ? t('common.saving') : t('document.addAndStudy')}</button></div>
    </form>
  </dialog>;
}
