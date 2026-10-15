import { createTranslator } from '../shared/i18n.js';
import type { AIModel } from '../shared/types.js';
import { LanguageProvider, useLanguage } from './LanguageContext.js';
import { LanguageSettings } from './LanguageSettings.js';
import { FolderNavigation, DocumentFolderMenu } from './FolderNavigation.js';
import { inScope } from '../learning/folders.js';
import type { DocumentSummary, LibraryScope } from '../shared/types.js';
import { useEffect, useRef, useState } from 'react';
import { AddDocumentDialog } from './AddDocumentDialog.js';
import { PdfReader, VisualEvidenceList } from './PdfReader.js';
import { ReadingContent } from './ReadingContent.js';
import { SourceTranslationPanel } from './SourceTranslationPanel.js';
import { LibraryTools } from './LibraryTools.js';
import { UpdateSettings } from './UpdateSettings.js';
import { saveAndInstallUpdate } from './update-install.js';
import { UpdatePreparationContext } from './update-preparation.js';
import { assertStudyDraftsForUpdate, clearStudyDrafts, StudyFlow } from './StudyFlow.js';
import { isOllamaModel, aiUnavailableReason, pdfAIBlocked, modelListed, OLLAMA_PROTOCOL_VERSIONS } from '../shared/ai.js';
import type { AddDocumentInput, AppState, Rating, PdfImportState, ReadingUnit, StudyDocument, SwallowBridge } from '../shared/types.js';

const DRAFT_KEY = 'swallow.recall-drafts.v1';
type Draft = { answer: string; baseSavedAt: string | null };
type DraftStore = { entries: Record<string, Draft>; error: string | null; blocked: boolean };
const draftKey = (documentId: string, unitId: string) => `${documentId}:${unitId}`;

function loadDrafts(): DraftStore {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw === null) return { entries: {}, error: null, blocked: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    for (const entry of Object.values(value)) {
      if (!entry || typeof entry !== 'object' || typeof entry.answer !== 'string'
        || !(entry.baseSavedAt === null || typeof entry.baseSavedAt === 'string')) throw new Error();
    }
    return { entries: value as Record<string, Draft>, error: null, blocked: false };
  } catch {
    return { entries: {}, blocked: true, error: '임시 답안 저장소를 읽지 못했습니다. 기존 데이터는 보존했습니다. 답안을 입력한 뒤 반드시 “답안 저장”을 눌러 학습 기록에 저장하세요.' };
  }
}

const SAMPLE: AddDocumentInput = {
  title: '작업 기억과 능동적 회상',
  goal: '능동적 회상이 왜 학습에 도움이 되는지 내 말로 설명하기',
  source: '# 작업 기억과 학습\n\n작업 기억은 정보를 잠시 유지하면서 처리하는 데 쓰인다. 한 번에 처리할 수 있는 정보에는 한계가 있으므로, 새로운 개념을 배울 때는 내용을 작은 단위로 나누고 이미 아는 지식과 연결하는 편이 이해에 도움이 된다.\n\n# 능동적 회상\n\n능동적 회상은 자료를 보지 않고 배운 내용을 기억에서 꺼내는 연습이다. 글을 다시 읽을 때 느끼는 익숙함만으로는 스스로 설명할 수 있는지 확인하기 어렵다. 읽기를 멈추고 핵심 내용을 자기 말로 설명하면 무엇을 알고 무엇을 놓쳤는지 드러난다.\n\n# 간격을 둔 복습\n\n한 번에 오래 반복하는 대신 시간을 두고 다시 떠올리는 연습을 할 수 있다. 기억이 흐려질 때 복습하면 약한 부분을 확인하기 쉽다. 답이 막혔다면 원문을 확인하고, 다시 숨긴 뒤 핵심을 설명해 보자. 복습 날짜와 스스로 느낀 난이도를 함께 기록하면 다음 학습을 계획하는 데 도움이 된다.',
};

// Chosen only when the user explicitly adds a sample. Existing documents are never replaced.
const SAMPLE_EN: AddDocumentInput = {
  title: 'Working memory and active recall',
  goal: 'Explain in my own words why active recall helps learning',
  source: '# Working memory and learning\n\nWorking memory briefly holds and processes information. Its capacity is limited, so breaking a new concept into smaller parts and connecting it to what you already know can help understanding.\n\n# Active recall\n\nActive recall means retrieving what you learned without looking at the material. The familiarity you feel when rereading does not show whether you can explain it yourself. Pause and explain the main idea in your own words to find what you know and what you missed.\n\n# Spaced review\n\nInstead of repeating everything at once, return to it after a delay. Review when memory starts to fade to identify weak points. If you get stuck, check the source, hide it again and explain the main idea. Record a review date and your own difficulty rating to plan your next study.',
};

function dueReviews(state: AppState): { document: StudyDocument; unit: ReadingUnit }[] {
  const now = Date.now();
  return state.library.documents.flatMap(document => document.units.flatMap(unit => {
    const reviewAt = document.recalls[unit.id]?.reviewAt;
    return reviewAt && new Date(reviewAt).getTime() <= now ? [{ document, unit }] : [];
  }));
}

function AccountPanel({ state, bridge, run, pending, close }: {
  state: AppState; bridge: SwallowBridge; run: (operation: () => Promise<void>) => void;
  pending: boolean; close: () => void;
}) {
  const { t, localizeText } = useLanguage();
  const [localHost, setLocalHost] = useState<'127.0.0.1' | '::1'>(state.ollama?.endpoint.host ?? '127.0.0.1');
  const [localPort, setLocalPort] = useState(String(state.ollama?.endpoint.port ?? 11434));
  const localBusy = pending || !!state.busy || state.ollama?.status === 'checking';
  return <section className="account-panel" aria-label={t('account.title')}>
    <div className="panel-heading"><h2>{t('account.title')}</h2><button className="icon-button" aria-label={t('account.closePanel')} onClick={close}>×</button></div>
    <p className="account-copy">{t('account.help')}</p>
    {bridge.mode === 'browser' ? <p className="status-note">{t('account.previewHelp')}</p> : <>
      <h3>{t('account.ollamaTitle')}</h3>
      <p className="account-copy">{t('account.ollamaHelp')}</p>
      <div className="connection-status"><span className={`status-dot ${state.ollama?.status === 'ready' ? 'connected' : ''}`} />{state.ollama?.message ? localizeText(state.ollama.message) : t('account.localConnectHelp')}</div>
      <label className="field-label">{t('account.localHost')}<select aria-label={t('account.ollamaHost')} value={localHost} disabled={localBusy} onChange={event => setLocalHost(event.target.value as '127.0.0.1' | '::1')}><option value="127.0.0.1">127.0.0.1</option><option value="::1">::1</option></select></label>
      <label className="field-label">{t('account.port')}<input aria-label={t('account.ollamaPort')} type="number" min={1} max={65535} step={1} value={localPort} disabled={localBusy} onChange={event => setLocalPort(event.target.value)} /></label>
      <div className="account-actions"><button className="secondary-button" disabled={localBusy || !Number.isInteger(Number(localPort)) || Number(localPort) < 1 || Number(localPort) > 65535} onClick={() => run(() => bridge.connectOllama({ host: localHost, port: Number(localPort) }))}>{t('account.connectLocal')}</button><button className="text-button" disabled={localBusy} onClick={() => run(() => bridge.refreshOllama())}>{t('account.checkLocal')}</button><button className="text-button" disabled={localBusy} onClick={() => run(() => bridge.disconnectOllama())}>{t('account.disconnectLocal')}</button></div>
      <p className="small-copy">{t('account.ollamaLimits', { versions: OLLAMA_PROTOCOL_VERSIONS.join(', ') })}</p>
    </>}
  </section>;
}

export default function App({ bridge }: { bridge: SwallowBridge }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  useEffect(() => {
    let disposed = false, received = false;
    const unsubscribe = bridge.onState(next => { received = true; if (!disposed) { setState(next); setLoadError(null); } });
    void bridge.getState().then(next => { if (!disposed && !received) { setState(next); setLoadError(null); } }).catch(cause => { if (!disposed && !received) setLoadError(cause); });
    return () => { disposed = true; unsubscribe(); };
  }, [bridge]);
  return <LanguageProvider preferences={state?.language?.preferences ?? { uiLocale: 'ko', responseLanguage: 'ko' }}>
    <AppContents bridge={bridge} state={state} setState={setState} loadError={loadError} setLoadError={setLoadError} />
  </LanguageProvider>;
}

function AppContents({ bridge, state, setState, loadError, setLoadError }: {
  bridge: SwallowBridge; state: AppState | null; setState: (state: AppState) => void;
  loadError: unknown; setLoadError: (error: unknown) => void;
}) {
  const { t, formatNumber, formatDate, errorText: errorMessage, localizeText, uiLocale } = useLanguage();
  const [pdfPageRequest, setPdfPageRequest] = useState<{ page: number } | null>(null);
  const [importState, setImportState] = useState<PdfImportState>({ status: 'idle', message: '' });
  useEffect(() => bridge.onImportState(setImportState), [bridge]);
  const [error, setError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingFolderId, setAddingFolderId] = useState<string | null>(null);
  const [scope, setScope] = useState<LibraryScope>({ kind: 'all' });
  const [folderEditing, setFolderEditing] = useState(false);
  const [operationPending, setPending] = useState(false);
  const [flowPending, setFlowPending] = useState(false);
  const updatePreparations = useRef(new Set<() => Promise<void>>());
  const [legacy, setLegacy] = useState(false);
  const pending = operationPending || flowPending;
  const pendingRef = useRef(false);
  const [hiddenSource, setHiddenSource] = useState(false);
  const [draftStore, setDraftStore] = useState(loadDrafts);
  const draftsRef = useRef(draftStore);
  const readerRef = useRef<HTMLElement>(null);
  const [clockTick, setClockTick] = useState(0);
  const updateBlocked = flowPending || !!state?.busy || adding || folderEditing || importState.status !== 'idle';
  const updateBlockedRef = useRef(updateBlocked); updateBlockedRef.current = updateBlocked;
  async function installUpdate() {
    if (pendingRef.current || updateBlockedRef.current) throw new Error(t('errors.updateBlocked'));
    pendingRef.current = true; setPending(true);
    try {
      await saveAndInstallUpdate(() => updateBlockedRef.current, [async () => {
        assertStudyDraftsForUpdate();
        if (draftsRef.current.error || draftsRef.current.blocked) throw new Error('임시 답안 저장소에 문제가 있습니다. 답안을 저장하고 저장 공간·권한을 확인한 뒤 업데이트해 주세요.');
        await saveDraft();
        if (draftsRef.current.error) throw new Error(draftsRef.current.error);
      }, ...updatePreparations.current], () => bridge.installUpdate());
    } finally { pendingRef.current = false; setPending(false); }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(tick => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeDocument = state?.library.documents.find(document => document.id === state.library.activeDocumentId);
  const unit = activeDocument?.units[activeDocument.position];
  const recall = unit && activeDocument?.recalls[unit.id];
  const key = activeDocument && unit ? draftKey(activeDocument.id, unit.id) : null;
  const draft = key ? draftStore.entries[key] : undefined;
  const validDraft = draft && draft.baseSavedAt === (recall?.savedAt ?? null) ? draft : undefined;
  const answer = validDraft?.answer ?? recall?.answer ?? '';
  const dirty = !!validDraft && answer !== (recall?.answer ?? '');
  useEffect(() => { setPdfPageRequest(null); }, [activeDocument?.id, unit?.id]);
  function showPdfPage(page: number) { setHiddenSource(false); setPdfPageRequest({ page }); requestAnimationFrame(() => document.getElementById('pdf-reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  const cachedGuide = unit && activeDocument?.guides[unit.id];
  const guide = cachedGuide?.guide;
  const feedback = !dirty ? recall?.feedback : undefined;
  const allDue = state?.dueReviews ? state.dueReviews.filter(item => Date.parse(item.reviewAt) <= Date.now()) : state ? dueReviews(state).map(item => ({ documentId: item.document.id, unitId: item.unit.id, position: item.document.units.findIndex(unit => unit.id === item.unit.id), reviewAt: '' })) : [];
  const documents: DocumentSummary[] = state?.documents ?? state?.library.documents.map(doc => ({ id: doc.id, title: doc.title, unitCount: doc.units.length, readCount: doc.readUnitIds.length, recallCount: Object.values(doc.recalls).filter(record => record.answer.trim()).length, archived: false, lastUsedAt: doc.createdAt })) ?? [];
  const folders = state?.folders ?? [];
  const effectiveScope: LibraryScope = scope.kind === 'folder' && !folders.some(folder => folder.id === scope.folderId) ? { kind: 'unfiled' } : scope;
  const scopeName = effectiveScope.kind === 'all' ? t('folder.all') : effectiveScope.kind === 'unfiled' ? t('folder.unfiled') : folders.find(folder => folder.id === effectiveScope.folderId)!.name;
  const targetFolderId = effectiveScope.kind === 'folder' ? effectiveScope.folderId : null;
  const activeDocuments = documents.filter(doc => !doc.archived && inScope(doc.folderId, effectiveScope));
  const due = allDue.filter(item => documents.some(doc => doc.id === item.documentId && inScope(doc.folderId, effectiveScope)));
  const openAddDocument = () => { setAddingFolderId(targetFolderId); setError(null); setAdding(true); };
  const folderPending = pending || importState.status !== 'idle';
  const currentFolderId = documents.find(doc => doc.id === activeDocument?.id)?.folderId;
  const currentFolderName = folders.find(folder => folder.id === currentFolderId)?.name ?? t('folder.unfiled');
  void clockTick;

  useEffect(() => { setHiddenSource(false); readerRef.current?.scrollTo({ top: 0 }); }, [activeDocument?.id, unit?.id]);

  useEffect(() => {
    if (!state || (!draftStore.error && !draftStore.blocked)) return;
    const memoryOnlyDraft = state.library.documents.some(document => document.units.some(item => {
      const entry = draftStore.entries[draftKey(document.id, item.id)];
      const saved = document.recalls[item.id];
      return entry && entry.baseSavedAt === (saved?.savedAt ?? null) && entry.answer !== (saved?.answer ?? '');
    }));
    if (!memoryOnlyDraft) return;
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [state, draftStore]);

  function updateDrafts(entries: Record<string, Draft>): void {
    const previous = draftsRef.current;
    let next = { ...previous, entries };
    if (!previous.blocked) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(entries)); next = { ...next, error: null }; }
      catch { next = { ...next, error: '임시 답안을 자동 보관하지 못했습니다. 화면을 닫기 전에 “답안 저장”을 눌러 주세요. 저장 공간이나 브라우저 권한을 확인하세요.' }; }
    }
    draftsRef.current = next;
    setDraftStore(next);
  }

  function editAnswer(value: string): void {
    if (!activeDocument || !unit || !key) return;
    updateDrafts({ ...draftsRef.current.entries, [key]: { answer: value, baseSavedAt: recall?.savedAt ?? null } });
  }

  async function saveDraft(): Promise<void> {
    if (!activeDocument || !unit || !key) return;
    const entry = draftsRef.current.entries[key];
    if (!entry || entry.baseSavedAt !== (recall?.savedAt ?? null)) return;
    if (entry.answer !== (recall?.answer ?? '')) {
      await bridge.study({ type: 'save-recall', documentId: activeDocument.id, unitId: unit.id, answer: entry.answer });
    }
    if (draftsRef.current.entries[key] === entry) {
      const next = { ...draftsRef.current.entries };
      delete next[key];
      updateDrafts(next);
    }
  }

  async function perform(operation: () => Promise<void>): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true; setPending(true); setError(null);
    try { await operation(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { pendingRef.current = false; setPending(false); }
  }
  const run = (operation: () => Promise<void>) => { void perform(operation); };
  const launch = (operation: () => Promise<void>) => { setError(null); void operation().catch(cause => setError(errorMessage(cause))); };
  const goToDocument = (documentId: string) => run(async () => { await saveDraft(); await bridge.study({ type: 'select-document', documentId }); setLegacy(false); });
  const goToUnit = (position: number) => {
    if (!activeDocument) return;
    run(async () => { await saveDraft(); await bridge.study({ type: 'select-unit', documentId: activeDocument.id, position }); });
  };

  if (!state) return <main className="startup-state"><div className="wordmark">Swallow<span>{t('app.tagline')}</span></div>
    {loadError ? <><p className="inline-error" role="alert">{errorMessage(loadError)}</p><button className="primary-button" onClick={() => { setLoadError(null); void bridge.getState().then(setState).catch(cause => setLoadError(errorMessage(cause))); }}>{t('common.reload')}</button></> : <p>{t('app.loadingHistory')}</p>}
  </main>;

  const modelDisplayName = (model: AIModel): string => model.displayName;
  const modelValid = modelListed(state);
  const pdfBlocked = !!activeDocument?.pdf && pdfAIBlocked(state);
  const rawAiDisabledReason = pdfBlocked ? '선택 제공자의 PDF 이미지 설명은 아직 지원하지 않습니다. PDF 읽기·답변·노트 저장은 계속 사용할 수 있습니다.' : aiUnavailableReason(state, bridge.mode === 'desktop');
  const aiDisabledReason = rawAiDisabledReason ? localizeText(rawAiDisabledReason) : null;
  const aiAvailable = aiDisabledReason === null;
  const activeBusy = state.busy && state.busy.documentId === activeDocument?.id && state.busy.unitId === unit?.id ? state.busy : null;
  const currentModelGuide = !!cachedGuide && cachedGuide.model === state.library.selectedModel;
  const rated = !dirty ? recall?.rating : undefined;
  const rate = (rating: Rating) => {
    if (!activeDocument || !unit) return;
    run(() => bridge.study({ type: 'rate-recall', documentId: activeDocument.id, unitId: unit.id, rating }));
  };

  return <UpdatePreparationContext.Provider value={updatePreparations.current}><div className="app-shell">
    <header className="app-header"><div className="wordmark">Swallow<span>{t('app.tagline')}</span></div>
      <div className="header-actions"><LanguageSettings bridge={bridge} resolution={state.language} />{bridge.mode === 'browser' && <span className="preview-label">{t('app.browserPreview')}</span>}
        <UpdateSettings bridge={bridge} blocked={pending || updateBlocked} install={installUpdate} />
        <button className="account-toggle" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)}><span className={`status-dot ${state.ollama?.status === 'ready' ? 'connected' : ''}`} />{state.ollama?.status === 'ready' ? t('account.ollamaConnected') : t('account.title')}<span className="chevron">⌄</span></button>
      </div>
      {accountOpen && <AccountPanel state={state} bridge={bridge} run={run} pending={pending} close={() => setAccountOpen(false)} />}
    </header>

    {(error || state.notice || draftStore.error) && <div className="notice-bar" role="alert"><div>{error && <p>{localizeText(error)}</p>}{state.notice && state.notice !== error && <p>{localizeText(state.notice)}</p>}{draftStore.error && <p>{errorMessage(new Error(draftStore.error))}</p>}</div>{error && <button className="icon-button" aria-label={t('app.closeError')} onClick={() => setError(null)}>×</button>}</div>}

    <div className={`workspace ${legacy ? 'legacy-workspace' : 'guided-workspace'}`}>
      <aside className="library-pane" aria-label={t('library.region')}>
        <div className="library-title"><h1>{t('library.myStudy')}</h1><span>{bridge.mode === 'browser' ? `${formatNumber(documents.filter(doc => !doc.archived).length)}/20` : t('count.items', { count: documents.filter(doc => !doc.archived).length })}</span></div>
        <button className="primary-button add-button" disabled={pending || (bridge.mode === 'browser' && documents.length >= 20)} onClick={openAddDocument}>{t('document.addButton')}</button>
        {importState.status !== 'idle' && <p className="small-copy" role="status">{localizeText(importState.message)}{importState.status === 'importing' && <button className="text-button" onClick={() => void bridge.cancelImport().catch(cause => setError(errorMessage(cause)))}>{t('document.cancelImport')}</button>}</p>}
        <button className="import-button" disabled={pending || (bridge.mode === 'browser' && documents.length >= 20)} onClick={() => run(async () => { await saveDraft(); await bridge.importDocument(targetFolderId); })}>{t('document.importFile')} <span>{bridge.mode === 'desktop' ? '.pdf · .txt · .md' : '.txt · .md'}</span></button>
        {bridge.mode === 'desktop' && <LibraryTools key={`${effectiveScope.kind}:${targetFolderId ?? ''}`} scope={effectiveScope} scopeName={scopeName} bridge={bridge} documents={documents.filter(doc => inScope(doc.folderId, effectiveScope))} storage={state.storage} pending={pending} open={async reference => { if (pendingRef.current) throw new Error('다른 작업이 진행 중입니다.'); await saveDraft(); await bridge.openEvidence(reference); setHiddenSource(false); setLegacy(true); }} archive={async () => { if (!activeDocument) throw new Error('보관할 문서를 먼저 선택하세요.'); if (pendingRef.current) throw new Error('다른 작업이 진행 중입니다.'); await saveDraft(); await bridge.archiveDocument(activeDocument.id); }} />}
        <FolderNavigation folders={folders} documents={documents} scope={effectiveScope} select={setScope} pending={folderPending} error={error} editingChanged={setFolderEditing} create={name => perform(async () => { const folder = await bridge.createFolder(name); setScope({ kind: 'folder', folderId: folder.id }); })} rename={(id, name) => perform(() => bridge.renameFolder(id, name))} remove={id => run(() => bridge.deleteFolder(id))} />
        <p className="library-scope">{t('library.scopeHeading', { name: scopeName })}</p>
        <button className={`review-button ${due.length ? 'has-due' : ''}`} disabled={pending || due.length === 0} onClick={() => {
          const review = due[0]; if (!review) return;
          run(async () => { await saveDraft(); await bridge.study({ type: 'select-document', documentId: review.documentId }); await bridge.study({ type: 'select-unit', documentId: review.documentId, position: review.position }); });
        }}><span>{t('library.dueToday')}</span><strong>{formatNumber(due.length)}</strong></button>
        <nav className="document-list" aria-label={t('library.documents')}>
          {activeDocuments.map(document => <div className="document-row" key={document.id}><button className={`document-item ${document.id === activeDocument?.id ? 'active' : ''}`} aria-current={document.id === activeDocument?.id ? 'true' : undefined} disabled={pending} onClick={() => goToDocument(document.id)}><span className="document-name">{document.title}</span><span className="document-progress">{t('library.documentProgress', { count: document.readCount, total: document.unitCount, active: document.recallCount })}</span></button><DocumentFolderMenu document={document} folders={folders} pending={folderPending} move={(id, folderId) => run(() => bridge.moveDocument(id, folderId))} /></div>)}
          {activeDocuments.length === 0 && <p className="library-empty">{t('library.emptyScope')}<br />{t('library.emptyScopeHelp')}</p>}
        </nav>
        {activeDocument && <p className="current-document-folder">{t('library.currentFolder', { name: currentFolderName })}</p>}
        {activeDocument && legacy && <section className="unit-navigation" aria-label={t('reading.passages')}><div className="section-label">{t('reading.passages')} <span>{activeDocument.units.length}</span></div><ol>
          {activeDocument.units.map((item, index) => <li key={item.id}><button className={`unit-item ${index === activeDocument.position ? 'active' : ''}`} aria-current={index === activeDocument.position ? 'step' : undefined} disabled={pending} onClick={() => goToUnit(index)}><span className="unit-index">{String(index + 1).padStart(2, '0')}</span><span className="unit-section">{item.section || t('reading.unit', { index: index + 1 })}</span><span className="unit-state" title={activeDocument.readUnitIds.includes(item.id) ? t('reading.read') : t('reading.unread')}>{activeDocument.readUnitIds.includes(item.id) ? '✓' : '·'}</span></button></li>)}
        </ol></section>}
        <div className="library-bottom"><p>{t('library.supportText')}{bridge.mode === 'desktop' ? ' · PDF' : ''}<br />{t('library.supportLinks')}</p>{activeDocument && <button className="text-button delete-button" disabled={pending || !!state.busy} onClick={() => {
          if (!window.confirm(t('document.deleteConfirm', { title: activeDocument.title }))) return;
          run(async () => {
            await bridge.study({ type: 'delete-document', documentId: activeDocument.id });
            updateDrafts(Object.fromEntries(Object.entries(draftsRef.current.entries).filter(([storedKey]) => !storedKey.startsWith(`${activeDocument.id}:`))));
            clearStudyDrafts(activeDocument.id);
          });
        }}>{t('document.delete')}</button>}</div>
      </aside>

      {activeDocument && unit ? !legacy ? <StudyFlow key={activeDocument.id} scope={effectiveScope} scopeName={scopeName} bridge={bridge} doc={activeDocument} state={state} pending={operationPending} aiAvailable={aiAvailable} aiDisabledReason={aiDisabledReason} onConnect={() => setAccountOpen(true)} onBusyChange={busy => { pendingRef.current = busy; setFlowPending(busy); }} onLegacy={async reference => { await bridge.controlSpeech('stop'); if (reference) await bridge.openEvidence(reference); setHiddenSource(false); setLegacy(true); }} /> : <>
        <main className="reading-pane" ref={readerRef} aria-label={t('study.readingRegion')}>
          <div className="reading-topline"><span>{t('study.legacy')} <button className="text-button" disabled={pending || !!state.busy} onClick={() => run(async () => { await saveDraft(); await bridge.controlSpeech('stop'); setLegacy(false); })}>{t('study.together')}</button></span><span>{activeDocument.position + 1} / {activeDocument.units.length}</span></div>
          <h2 className="document-heading" lang="">{activeDocument.title}</h2>
          {activeDocument.sourceUrl && <p className="source-url" title={activeDocument.sourceUrl}>{t('common.sourceLabel', { name: activeDocument.sourceUrl })}</p>}
          {activeDocument.goal && <p className="learning-goal"><span>{t('document.goal')}</span>{activeDocument.goal}</p>}
          <div className="reading-progress"><span style={{ width: `${100 * activeDocument.readUnitIds.length / activeDocument.units.length}%` }} /></div>
          <div className="progress-copy"><span>{t('reading.read')} {activeDocument.readUnitIds.length}/{activeDocument.units.length}</span><span>{t('reading.progressHelp')}</span></div>
          <div className="source-heading"><h3>{unit.section || t('study.readingPassage', { index: activeDocument.position + 1 })}</h3><button className="text-button" aria-pressed={hiddenSource} onClick={() => setHiddenSource(hidden => !hidden)}>{hiddenSource ? t('reading.showAgain') : t('reading.hideRecall')}</button></div>
          {hiddenSource ? <div className="hidden-source"><span className="hidden-source-symbol">◌</span><h3>{t('reading.recallTime')}</h3><p>{t('reading.recallHelp')}<br />{t('reading.recallRetryHelp')}</p><button className="secondary-button" onClick={() => setHiddenSource(false)}>{t('reading.checkSource')}</button></div> : <>{activeDocument.pdf && <PdfReader key={`pdf:${activeDocument.id}:${unit.id}`} bridge={bridge} doc={activeDocument} unit={unit} requestedPage={pdfPageRequest} pending={pending} />}<ReadingContent key={`${activeDocument.id}:${unit.id}`} bridge={bridge} documentId={activeDocument.id} unit={unit} pending={pending} onRead={() => perform(() => bridge.study({ type: 'mark-read', documentId: activeDocument.id, unitId: unit.id }))} onRecall={() => setHiddenSource(true)} /></>}
          <div hidden={hiddenSource}><SourceTranslationPanel bridge={bridge} state={state} doc={activeDocument} unitId={unit.id} disabled={pending} /></div>
          <footer className="reading-footer"><div className="reading-status">{activeDocument.readUnitIds.includes(unit.id) ? <span>{t('reading.readDone')}</span> : <button className="secondary-button" disabled={pending} onClick={() => run(() => bridge.study({ type: 'mark-read', documentId: activeDocument.id, unitId: unit.id }))}>{t('reading.markRead')}</button>}</div><div className="reading-pagination"><button className="text-button" disabled={pending || activeDocument.position === 0} onClick={() => goToUnit(activeDocument.position - 1)}>{t('reading.previous')}</button><button className="primary-button" disabled={pending || activeDocument.position === activeDocument.units.length - 1} onClick={() => goToUnit(activeDocument.position + 1)}>{t('reading.next')}</button></div></footer>
          <p className="footer-note">{t('reading.navigationHelp')}</p>
        </main>

        <aside className="learning-pane" aria-label={t('study.guideRegion')}>
          <section className="model-control"><label htmlFor="model-select">{t('model.label')}</label><div className="model-select-row"><select id="model-select" value={modelValid ? state.library.selectedModel ?? '' : ''} disabled={pending || !!state.busy || !state.models.length} onChange={event => run(() => bridge.study({ type: 'select-model', model: event.target.value }))}>
            {!modelValid && <option value="" disabled>{state.library.selectedModel ? t('model.unavailable', { model: state.library.selectedModel }) : t('model.choose')}</option>}{state.models.map(model => <option key={model.slug} value={model.slug}>{modelDisplayName(model)}</option>)}
          </select><button className="icon-button refresh-button" title={t('model.refreshAccount')} aria-label={t('model.refresh')} disabled={bridge.mode === 'browser' || pending || !!state.busy} onClick={() => run(() => bridge.refreshOllama())}>↻</button></div>{aiDisabledReason && <p className="model-explanation">{aiDisabledReason}{bridge.mode === 'desktop' && <button className="text-button" onClick={() => setAccountOpen(true)}>{t('account.openSettings')}</button>}</p>}</section>

          {state.busy && (!activeBusy || (hiddenSource && state.busy.kind === 'translation')) && <div className="other-request">{t('reading.otherRequest', { kind: state.busy.kind === 'translation' ? t('translation.title') : state.busy.kind === 'guide' ? t('model.guide') : t('model.feedback') })}<button className="text-button" onClick={() => { void bridge.cancelRequest().catch(cause => setError(errorMessage(cause))); }}>{t('study.cancelRequest')}</button></div>}
          <section className="guide-section">{activeDocument.pdf && <p className="small-copy">{t('study.pdfUnsupported')}</p>}<div className="section-heading"><h2><span>01</span> {t('reading.understand')}</h2><button className="text-button" disabled={!aiAvailable || !!state.busy || pending} onClick={() => launch(() => bridge.requestGuide(activeDocument.id, unit.id))}>{currentModelGuide ? t('study.recheckGuide') : guide ? t('model.guideSelected') : t('model.getGuide')}</button></div>
            {activeBusy?.kind === 'guide' ? <div className="request-progress" role="status"><span className="loading-dot" /><strong>{t('model.generatingGuide')}</strong><p>{state.streamText ? t('study.received', { count: state.streamText.length }) : isOllamaModel(state.library.selectedModel) ? t('model.localWaiting') : t('model.waiting')}</p><button className="text-button" disabled={pending} onClick={() => run(() => bridge.cancelRequest())}>{t('model.cancelGeneration')}</button></div> : hiddenSource && guide ? <div className="guide-empty"><p>{t('reading.guideHidden')}</p><button className="text-button" onClick={() => setHiddenSource(false)}>{t('reading.showGuideSource')}</button></div> : guide ? <div className="guide-content"><p className="guide-overview" lang={guide.identity?.responseLanguage ?? 'ko'}>{guide.overview}</p><div className="key-points">{guide.keyPoints.map((point, index) => <div className="key-point" key={`${index}:${point.title}`}><h3>{point.title}</h3><p lang={guide.identity?.responseLanguage ?? 'ko'}>{point.explanation}</p>{point.quote && <blockquote lang="">{point.quote}</blockquote>}</div>)}</div><VisualEvidenceList responseLanguage={guide.identity?.responseLanguage ?? 'ko'} evidence={guide.visualEvidence} onPage={showPdfPage} /><p className="ai-source-note">{t('reading.checkGuide')}</p></div> : <div className="guide-empty"><p>{t('reading.readFirst')}</p><p>{t('reading.guideHelp')}</p></div>}
          </section>

          <section className="recall-section"><div className="section-heading"><h2><span>02</span> {t('reading.recall')}</h2><button className="text-button" aria-pressed={hiddenSource} onClick={() => setHiddenSource(hidden => !hidden)}>{hiddenSource ? t('study.showSource') : t('study.hideSource')}</button></div>
            <p className="recall-question" lang={guide?.identity?.responseLanguage ?? 'ko'}>{guide?.question ?? createTranslator('ko')('reading.defaultQuestion')}</p>
            <label className="sr-only" htmlFor="recall-answer">{t('study.recallAnswer')}</label><textarea lang="" id="recall-answer" className="recall-input" value={answer} maxLength={10_000} disabled={pending || activeBusy?.kind === 'feedback'} onChange={event => editAnswer(event.target.value)} placeholder={t('reading.answerPlaceholder')} />
            <div className="answer-status"><span>{dirty ? t('reading.editing') : recall ? t('reading.saved') : t('reading.offlineAnswer')}</span><span>{t('count.characters', { count: answer.length })}</span></div>
            <div className="recall-actions"><button className="secondary-button" disabled={pending || !dirty || !!activeBusy} onClick={() => run(saveDraft)}>{t('reading.saveAnswer')}</button><button className="primary-button" disabled={pending || !answer.trim() || !aiAvailable || !!state.busy} onClick={() => run(async () => { await saveDraft(); launch(() => bridge.requestFeedback(activeDocument.id, unit.id)); })}>{t('reading.feedback')}</button></div>
            {dirty && recall?.feedback && <p className="small-copy">{t('reading.changedAnswer')}</p>}
            {activeBusy?.kind === 'feedback' ? <div className="request-progress" role="status"><span className="loading-dot" /><strong>{t('model.checkingAnswer')}</strong><p>{state.streamText ? t('study.received', { count: state.streamText.length }) : isOllamaModel(state.library.selectedModel) ? t('model.localWaiting') : t('model.waiting')}</p><button className="text-button" disabled={pending} onClick={() => run(() => bridge.cancelRequest())}>{t('model.cancelGeneration')}</button></div> : feedback && <div className="feedback-content"><h3>{t('reading.answerFeedback')}</h3><p lang={feedback.identity?.responseLanguage ?? 'ko'}>{feedback.assessment}</p>{feedback.missingPoints.length > 0 && <><h4>{t('reading.recheck')}</h4><ul>{feedback.missingPoints.map((point, index) => <li lang={feedback.identity?.responseLanguage ?? 'ko'} key={index}>{point}</li>)}</ul></>}<p className="feedback-next" lang={feedback.identity?.responseLanguage ?? 'ko'}>{feedback.nextStep}</p><VisualEvidenceList responseLanguage={feedback.identity?.responseLanguage ?? 'ko'} evidence={feedback.visualEvidence} onPage={showPdfPage} /></div>}
          </section>

          <section className="rating-section"><div className="section-heading"><h2><span>03</span> {t('reading.scheduleReview')}</h2></div><p className="small-copy">{t('reading.reviewHelp')}</p><div className="rating-buttons">{([{ rating: 'again', label: t('review.again'), detail: t('review.afterDays', { count: 1 }) }, { rating: 'hard', label: t('review.hard'), detail: t('review.afterDays', { count: 3 }) }, { rating: 'good', label: t('review.good'), detail: t('review.afterDays', { count: 7 }) }] as const).map(option => <button key={option.rating} className={rated === option.rating ? 'selected' : ''} aria-pressed={rated === option.rating} disabled={pending || dirty || !recall?.answer.trim() || !!state.busy} onClick={() => rate(option.rating)}><strong>{option.label}</strong><span>{option.detail}</span></button>)}</div>{recall?.reviewAt && !dirty && <p className="next-review">{t('review.next', { date: formatDate(recall.reviewAt, { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</p>}</section>
        </aside>
      </> : <main className="empty-workspace"><div className="empty-illustration" aria-hidden="true"><span className="paper-line" /><span className="paper-line" /><span className="paper-line short" /><span className="paper-mark">↗</span></div><p className="eyebrow">{t('study.first')}</p><h2>{t('study.emptyTitle')}</h2><p className="empty-copy">{t('study.emptyIntro')}<br />{t('study.emptyFinish')}</p><div className="empty-actions"><button className="primary-button" disabled={pending} onClick={openAddDocument}>{t('study.importSource')}</button><button className="secondary-button" disabled={pending} onClick={() => run(() => bridge.importDocument(targetFolderId))}>{bridge.mode === 'desktop' ? t('study.importFiles') : t('study.importText')}</button></div><button className="text-button sample-button" disabled={pending} onClick={() => run(() => bridge.addDocument({ ...(uiLocale === 'en' ? SAMPLE_EN : SAMPLE), folderId: targetFolderId }))}>{t('study.sampleButton')}</button><p className="empty-footnote">{t('study.storageHelp')}<br />{t('study.connectLater')}</p></main>}
    </div>
    {adding && <AddDocumentDialog folderName={addingFolderId ? folders.find(folder => folder.id === addingFolderId)?.name ?? t('folder.deleted') : t('folder.unfiled')} bridge={bridge} pending={pending} error={error} onClose={() => setAdding(false)} onAdd={async input => {
      const success = await perform(async () => { await saveDraft(); await bridge.addDocument({ ...input, folderId: addingFolderId }); });
      if (success) { setAdding(false); setLegacy(false); }
      return success;
    }} />}
  </div></UpdatePreparationContext.Provider>;
}
