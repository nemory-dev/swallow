import type { AppLanguage } from '../shared/i18n.js';
import { useLanguage } from './LanguageContext.js';
import { useEffect, useRef, useState } from 'react';
import type { ReadingUnit, StudyDocument, SwallowBridge, VisualEvidence } from '../shared/types.js';
import { unitPage } from '../learning/pdf.js';
import { useUpdatePreparation } from './update-preparation.js';

export function VisualEvidenceList({ evidence, onPage, responseLanguage = 'ko' }: { evidence?: VisualEvidence[]; onPage: (page: number) => void; responseLanguage?: AppLanguage }) {
  const { t } = useLanguage();
  if (!evidence?.length) return null;
  return <div className="visual-evidence"><h4>{t('pdf.visualEvidence')}</h4>{evidence.map((item, index) => <div key={index}>
    <button className="text-button" onClick={() => onPage(item.page)}>{t('pdf.openEvidence', { page: item.page })} ↗</button>
    <p lang={responseLanguage}>{item.description}</p><p className="small-copy">{t('pdf.uncertaintyLabel')} {item.uncertainty}</p>
  </div>)}</div>;
}

export function PdfReader({ bridge, doc, unit, requestedPage, pending }: {
  bridge: SwallowBridge; doc: StudyDocument; unit: ReadingUnit; requestedPage: { page: number } | null; pending: boolean;
}) {
  const { t, formatNumber, errorText, localizeText } = useLanguage();
  const currentPage = unitPage(doc, unit)!.page;
  const [page, setPage] = useState(currentPage);
  const [image, setImage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const metadata = doc.pdf!.pages[page - 1]!;
  const noteKey = `swallow.pdf-note.${doc.id}.${page}`;
  useUpdatePreparation(async () => {
    if (savingRef.current) throw new Error('PDF 메모 저장을 마친 뒤 업데이트해 주세요.');
    if (noteError) throw new Error('PDF 임시 메모 저장소에 문제가 있습니다. 그림 메모를 저장한 뒤 업데이트해 주세요.');
    if (note !== (metadata.note ?? '')) await saveNote();
  });
  useEffect(() => { if (requestedPage !== null) setPage(requestedPage.page); }, [requestedPage]);
  useEffect(() => {
    try { setNote(localStorage.getItem(noteKey) ?? metadata.note ?? ''); }
    catch { setNote(metadata.note ?? ''); setNoteError('임시 메모를 읽지 못했습니다. 이동 전 메모 저장을 눌러 주세요.'); }
  }, [noteKey, metadata.note]);
  useEffect(() => {
    let live = true;
    setImage(null); setError(null); setLoading(true);
    void bridge.renderPdfPage(doc.id, page).then(value => { if (live) setImage(value); })
      .catch(cause => { if (live) setError(errorText(cause, 'errors.pdfPage')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [bridge, doc.id, page, retry]);
  function editNote(value: string) {
    setNote(value); setNoteError(null);
    try { localStorage.setItem(noteKey, value); }
    catch { setNoteError('임시 메모 자동 보관에 실패했습니다. 이동 전 메모 저장을 눌러 주세요.'); }
  }
  async function saveNote() {
    if (savingRef.current) throw new Error('PDF 메모를 저장하는 중입니다.');
    savingRef.current = true;
    setSaving(true); setNoteError(null);
    try {
      await bridge.study({ type: 'save-pdf-note', documentId: doc.id, page, note });
      try { localStorage.removeItem(noteKey); } catch { /* Saved note remains in library.json. */ }
    } catch (cause) { setNoteError(errorText(cause, 'errors.noteSave')); throw cause; }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <section className="pdf-reader" id="pdf-reader" aria-label={t('pdf.region')}>
    <div className="pdf-toolbar"><strong>{t('pdf.position', { page, total: doc.pdf!.pages.length })}</strong>
      <button className="text-button" disabled={!image} onClick={() => { setZoom(100); dialog.current?.showModal(); }}>{t('pdf.zoom')} ↗</button>
    </div>
    <div className="pdf-navigation">
      <button className="secondary-button" disabled={page <= 1 || loading || saving} onClick={() => setPage(page - 1)}>{t('pdf.previous')}</button>
      <label>{t('pdf.pageLabel')} <input aria-label={t('pdf.pageNumber')} type="number" min={1} max={doc.pdf!.pages.length} value={page} disabled={loading || saving} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= doc.pdf!.pages.length) setPage(value); }} /></label>
      <button className="secondary-button" disabled={page >= doc.pdf!.pages.length || loading || saving} onClick={() => setPage(page + 1)}>{t('pdf.next')}</button>
      {page !== currentPage && <button className="text-button" disabled={loading || saving} onClick={() => setPage(currentPage)}>{t('pdf.backToPassage', { page: currentPage })}</button>}
    </div>
    {loading && <p role="status" className="small-copy">{t('pdf.loading')}</p>}
    {error && <p className="inline-error" role="alert">{localizeText(error)} <button className="text-button" onClick={() => setRetry(value => value + 1)}>{t('pdf.retry')}</button></p>}
    {image && <button className="pdf-page-preview" aria-label={t('pdf.zoomPage', { page })} onClick={() => { setZoom(100); dialog.current?.showModal(); }}><img src={image} alt={t('pdf.pageAlt', { page })} /></button>}
    <p className="small-copy">{metadata.method === 'ocr' ? t('pdf.ocrHelp') : metadata.method === 'empty' ? t('pdf.emptyHelp') : t('pdf.textHelp')} {t('pdf.sendPage', { page: currentPage })}</p>
    <details className="pdf-note"><summary>{t('pdf.figureNote')}</summary><p className="small-copy">{t('pdf.figureNoteHelp')}</p>
      {noteError && <p className="inline-error" role="alert">{errorText(new Error(noteError))}</p>}<textarea lang="" aria-label={t('pdf.noteLabel', { page })} value={note} maxLength={3000} disabled={saving || pending} onChange={event => editNote(event.target.value)} />
      <button className="secondary-button" disabled={saving || pending || note.trim() === (metadata.note ?? '')} onClick={() => void saveNote().catch(() => {})}>{saving ? t('common.saving') : t('pdf.saveNote')}</button>
    </details>
    <dialog ref={dialog} className="pdf-dialog"><div className="pdf-toolbar"><strong>{t('pdf.zoomTitle', { page })}</strong><label>{t('pdf.zoomAction')} <input aria-label={t('pdf.zoomLabel')} type="range" min={50} max={250} step={25} value={zoom} onChange={event => setZoom(Number(event.target.value))} /> {formatNumber(zoom)}%</label><button className="secondary-button" onClick={() => dialog.current?.close()}>{t('common.close')}</button></div><div className="pdf-zoom-scroll">{image && <img style={{ width: `${zoom}%` }} src={image} alt={t('pdf.zoomedAlt', { page })} />}</div></dialog>
  </section>;
}
