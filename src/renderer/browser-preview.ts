import { applyStudyAction, createDocument, emptyLibrary, validateLibrary } from '../learning/document.js';
import { BrowserSpeech } from './browser-speech.js';
import { getDocument, getUnit } from '../learning/document.js';
import type { ImportedDocument, AppState, LibraryState, SwallowBridge, StudySession, StudyNote, StudyWorkspace } from '../shared/types.js';
import { applySessionAction, createStudySession, createStudyNote, studyPassage, validateStudySession, validateStudyNote } from '../learning/session.js';
import { termSearchUrl } from '../../electron/study-input.js';
import type { LearningFolder, LibraryScope } from '../shared/types.js';
import { folderNameKey, inScope, normalizeFolderName, validateFolderId, validateScope } from '../learning/folders.js';
import { resolveLanguagePreferences, validateLanguagePreferences, type LanguageResolution } from '../shared/i18n.js';
import { PublicError } from '../shared/public-errors.js';

const STORAGE_KEY = 'swallow.library.v1';
const STUDY_KEY = 'swallow.study.v1';
const PREFERENCES_KEY = 'swallow.preferences.v1';
type FolderData = { folders: LearningFolder[]; documentFolders: Record<string, string> };
const folderOf = (data: FolderData, id: string) => Object.hasOwn(data.documentFolders, id) ? data.documentFolders[id]! : null;

/** Browser preview stores real reading work locally. Account/AI work needs the desktop bridge. */
export function createBrowserPreview(): SwallowBridge {
  const speech = new BrowserSpeech();
  let current: AppState | null = null;
  let folderData: FolderData = { folders: [], documentFolders: {} };
  const listeners = new Set<(state: AppState) => void>();

  function load(): AppState {
    if (current) return current;
    let library: LibraryState;
    let existingInstallation = false;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      existingInstallation = saved !== null || localStorage.getItem(STUDY_KEY) !== null;
      const raw = saved === null ? emptyLibrary() : JSON.parse(saved);
      library = validateLibrary(raw);
      if (raw.folders !== undefined || raw.documentFolders !== undefined) {
        if (!Array.isArray(raw.folders) || !raw.documentFolders || typeof raw.documentFolders !== 'object' || Array.isArray(raw.documentFolders)) throw new Error();
        const seen = new Set<string>(), names = new Set<string>();
        for (const folder of raw.folders) {
          validateFolderId(folder.id); const key = folderNameKey(folder.name);
          if (seen.has(folder.id) || names.has(key) || typeof folder.createdAt !== 'string' || !Number.isFinite(Date.parse(folder.createdAt))) throw new Error();
          seen.add(folder.id); names.add(key);
        }
        for (const [id, folderId] of Object.entries(raw.documentFolders)) {
          if (typeof folderId !== 'string' || !seen.has(folderId) || !library.documents.some(doc => doc.id === id)) throw new Error();
        }
        folderData = { folders: raw.folders, documentFolders: raw.documentFolders };
      }
    } catch {
      throw new Error('브라우저의 학습 데이터를 읽을 수 없습니다. 기존 데이터는 그대로 보존했습니다. 브라우저 저장 공간과 데이터를 확인한 뒤 다시 시도하세요.');
    }
    let language: LanguageResolution;
    let notice: string | null = null;
    try {
      const raw = localStorage.getItem(PREFERENCES_KEY);
      let stored: unknown;
      if (raw !== null) { try { stored = JSON.parse(raw); } catch { stored = null; } }
      language = resolveLanguagePreferences({ installation: existingInstallation ? 'existing' : 'new',
        systemLocales: typeof navigator === 'undefined' ? [] : navigator.languages, stored });
      if (language.status === 'missing') {
        try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(language.preferences)); language = { ...language, status: 'valid' }; }
        catch { notice = new PublicError('language.saveFailed').message; }
      }
    } catch {
      language = resolveLanguagePreferences({ installation: 'existing', stored: null });
      notice = new PublicError('language.invalidSettings').message;
    }
    current = {
      language,
      library,
      models: [],
      busy: null, streamText: '', notice,
    };
    attachCatalog(current, folderData);
    return current;
  }

  function attachCatalog(state: AppState, data: FolderData) {
    state.folders = structuredClone(data.folders);
    state.documents = state.library.documents.map(doc => ({ id: doc.id, title: doc.title, unitCount: doc.units.length, readCount: doc.readUnitIds.length, recallCount: Object.values(doc.recalls).filter(record => record.answer.trim()).length, archived: false, lastUsedAt: doc.createdAt, folderId: folderOf(data, doc.id) }));
  }
  function persist(library: LibraryState, data: FolderData = folderData): void {
    const previous = load();
    const next = { ...data, documentFolders: Object.fromEntries(Object.entries(data.documentFolders).filter(([id]) => library.documents.some(doc => doc.id === id))) };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...library, ...next }));
    } catch {
      throw new Error('학습 내용을 저장하지 못했습니다. 브라우저 저장 공간이나 권한을 확인하세요. 입력한 내용은 화면에 남아 있습니다.');
    }
    current = { ...previous, library, notice: null };
    folderData = next; attachCatalog(current, folderData);
    for (const listener of listeners) listener(current);
  }
  function requireFolder(id: string) {
    load(); validateFolderId(id);
    if (!folderData.folders.some(folder => folder.id === id)) throw new Error('폴더를 찾을 수 없습니다.');
  }
  function uniqueName(value: string, except?: string) {
    load(); const name = normalizeFolderName(value);
    if (folderData.folders.some(folder => folder.id !== except && folderNameKey(folder.name) === folderNameKey(name))) throw new Error('같은 이름의 폴더가 있습니다.');
    return name;
  }
  function checkedScope(value?: LibraryScope) {
    load(); const scope = validateScope(value); if (scope.kind === 'folder') requireFolder(scope.folderId); return scope;
  }

  const desktopOnly = async (): Promise<void> => {
    throw new Error('AI 계정 연결과 AI 학습은 데스크톱 앱에서 사용할 수 있습니다. 브라우저에서는 문서 읽기와 회상 답안 저장을 이용하세요.');
  };
  function studyData(): { sessions: Record<string, StudySession>; notes: Record<string, StudyNote> } {
    try {
      const raw = localStorage.getItem(STUDY_KEY);
      if (!raw) return { sessions: {}, notes: {} };
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !data.sessions || !data.notes || typeof data.sessions !== 'object' || typeof data.notes !== 'object' || Array.isArray(data.sessions) || Array.isArray(data.notes)) throw new Error();
      return data;
    } catch { throw new Error('학습 세션과 노트를 읽지 못했습니다. 기존 데이터는 보존했습니다.'); }
  }
  function persistStudy(data: ReturnType<typeof studyData>) {
    try { localStorage.setItem(STUDY_KEY, JSON.stringify(data)); }
    catch { throw new Error('세션과 요점노트를 저장하지 못했습니다. 입력을 보존한 뒤 저장 공간을 확인하세요.'); }
  }
  async function hashDocument(source: string) {
    const bytes = new TextEncoder().encode(source);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  async function workspace(documentId: string): Promise<StudyWorkspace> {
    const doc = getDocument(load().library, documentId), data = studyData(), hash = await hashDocument(doc.source);
    return {
      session: data.sessions[documentId] ? validateStudySession(data.sessions[documentId], doc, hash) : null,
      notes: Object.values(data.notes).filter(note => note?.source?.documentId === documentId).map(note => validateStudyNote(note, doc, hash)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100),
    };
  }

  const bridge: SwallowBridge = {
    async setLanguagePreferences(input) {
      const previous = load(), preferences = validateLanguagePreferences(input);
      try {
        const raw = localStorage.getItem(PREFERENCES_KEY);
        if (raw !== null) {
          let stored: unknown; try { stored = JSON.parse(raw); } catch { stored = null; }
          if (resolveLanguagePreferences({ installation: 'existing', stored }).status === 'invalid') {
            localStorage.setItem(`${PREFERENCES_KEY}.invalid.${crypto.randomUUID()}`, raw);
          }
        }
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      } catch { throw new PublicError('language.saveFailed'); }
      current = { ...previous, language: { preferences, status: 'valid', invalidFields: [] }, notice: null };
      for (const listener of listeners) listener(current);
    },
    async createFolder(value) {
      const name = uniqueName(value), folder = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
      persist(load().library, { ...folderData, folders: [...folderData.folders, folder] }); return folder;
    },
    async renameFolder(id, value) {
      requireFolder(id); const name = uniqueName(value, id);
      persist(load().library, { ...folderData, folders: folderData.folders.map(folder => folder.id === id ? { ...folder, name } : folder) });
    },
    async deleteFolder(id) {
      requireFolder(id); persist(load().library, { folders: folderData.folders.filter(folder => folder.id !== id), documentFolders: Object.fromEntries(Object.entries(folderData.documentFolders).filter(([, folderId]) => folderId !== id)) });
    },
    async moveDocument(id, folderId) {
      getDocument(load().library, id); if (folderId !== null) requireFolder(folderId);
      const documentFolders = { ...folderData.documentFolders }; delete documentFolders[id];
      if (folderId !== null) documentFolders[id] = folderId;
      persist(load().library, { ...folderData, documentFolders });
    },
    getStudyWorkspace: workspace,
    async studySession(action) {
      const doc = getDocument(load().library, action.documentId);
      const hash = await hashDocument(doc.source);
      const data = studyData();
      const current = data.sessions[doc.id] ? validateStudySession(data.sessions[doc.id], doc, hash) : null;
      if (action.type !== 'start' && !current) throw new Error('먼저 공부 시작을 눌러 주세요.');
      data.sessions[doc.id] = action.type === 'start' ? current ?? createStudySession(doc, hash, undefined, load().language?.preferences.responseLanguage ?? 'ko') : applySessionAction(doc, current!, action, undefined, load().language?.preferences.responseLanguage ?? 'ko');
      speech.control('stop'); persistStudy(data);
      return workspace(doc.id);
    },
    async saveStudyNote(documentId) {
      const doc = getDocument(load().library, documentId), current = (await workspace(documentId)).session;
      if (!current) throw new Error('먼저 공부 시작을 눌러 주세요.');
      const note = createStudyNote(doc, current), data = studyData();
      if (data.notes[note.id]) note.createdAt = data.notes[note.id]!.createdAt;
      data.notes[note.id] = note;
      data.sessions[doc.id] = { ...current, step: 'done', updatedAt: note.updatedAt };
      persistStudy(data); speech.control('stop'); return workspace(doc.id);
    },
    async searchStudyNotes(query, value) {
      const scope = checkedScope(value);
      if (typeof query !== 'string' || query.length > 200) throw new Error('검색어는 200자 이내로 입력하세요.');
      if (!query.trim()) return [];
      const documents = load().library.documents, data = studyData(), results: StudyNote[] = [];
      for (const note of Object.values(data.notes)) {
        const doc = documents.find(doc => doc.id === note?.source?.documentId);
        if (!doc || !inScope(folderOf(folderData, doc.id), scope)) continue;
        const checked = validateStudyNote(note, doc, await hashDocument(doc.source));
        if ([checked.title, checked.summary, checked.userAnswer, ...(checked.relearning ?? []).flatMap(attempt => [attempt.question, attempt.answer]), ...(checked.answerFeedback ? [checked.answerFeedback.result.assessment, ...checked.answerFeedback.result.missingPoints, checked.answerFeedback.result.nextStep] : []), ...checked.terms.map(value => `${value.term} ${value.explanation}`)].join('\n').normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase())) results.push(checked);
        if (results.length >= 20) break;
      }
      return results;
    },
    translateDocument: desktopOnly,
    feedbackStudy: async () => { await desktopOnly(); throw new Error('데스크톱 앱을 이용하세요.'); },
    explainStudy: async () => { await desktopOnly(); throw new Error('데스크톱 앱을 이용하세요.'); },
    explainTerm: async () => { await desktopOnly(); throw new Error('데스크톱 앱을 이용하세요.'); },
    async openTermSearch(term) { window.open(termSearchUrl(term), '_blank', 'noopener,noreferrer'); },
    async speakStudy(documentId, content, voiceId, rate) {
      const doc = getDocument(load().library, documentId), current = (await workspace(documentId)).session;
      if (!current || load().library.activeDocumentId !== documentId || !['source', 'explanation'].includes(content)) throw new Error('현재 공부 중인 자료를 선택하세요.');
      const text = content === 'source' ? studyPassage(doc, current) : current.guide?.overview;
      if (!text) throw new Error('먼저 짧은 설명을 받아 주세요.');
      await speech.speak(text, voiceId, rate);
    },
    async searchLibrary(query, value) {
      const scope = checkedScope(value);
      if (typeof query !== 'string' || query.length > 200) throw new Error('검색어는 200자 이내로 입력하세요.');
      if (!query.trim()) return [];
      const results: import('../shared/types.js').SearchHit[] = [];
      const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
      for (const doc of load().library.documents) {
        if (!inScope(folderOf(folderData, doc.id), scope)) continue;
        for (const unit of doc.units) {
          const position = unit.text.normalize('NFKC').toLocaleLowerCase().indexOf(needle);
          if (position < 0) continue;
          results.push({ documentId: doc.id, unitId: unit.id, sourceHash: await hashDocument(doc.source), title: doc.title, section: unit.section, start: unit.start, end: unit.end, excerpt: unit.text.slice(Math.max(0, position - 45), position + 175), archived: false });
          if (results.length >= 20) return results;
        }
      }
      return results;
    },
    async openEvidence(reference) {
      const doc = getDocument(load().library, reference.documentId);
      if (await hashDocument(doc.source) !== reference.sourceHash) throw new Error('자료의 원문이 변경되었습니다. 다시 검색하세요.');
      const position = doc.units.findIndex(unit => unit.id === reference.unitId);
      if (position < 0) throw new Error('원문 구간을 찾을 수 없습니다.');
      speech.control('stop');
      persist(applyStudyAction(applyStudyAction(load().library, { type: 'select-document', documentId: doc.id }), { type: 'select-unit', documentId: doc.id, position }));
    },
    archiveDocument: desktopOnly, restoreDocument: desktopOnly,
    setAutoArchive: desktopOnly, compactStorage: desktopOnly,
    mode: 'browser',
    async getUpdateState() { return { currentVersion: '브라우저 미리보기', status: 'unavailable', message: '앱 업데이트는 설치한 PC 앱에서 확인하세요.' }; },
    onUpdateState() { return () => {}; },
    async checkForUpdates() { throw new Error('앱 업데이트는 설치한 PC 앱에서 확인하세요.'); },
    async installUpdate() { throw new Error('앱 업데이트는 설치한 PC 앱에서 확인하세요.'); },
    async getState() { return load(); },
    onState(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async addDocument(input) {
      const library = load().library;
      const folderId = input.folderId ?? null; if (folderId !== null) requireFolder(folderId);
      if (library.documents.length >= 20) throw new Error('문서는 최대 20개까지 보관할 수 있습니다. 문서를 삭제한 뒤 추가하세요.');
      const document = createDocument(input);
      speech.control('stop');
      persist({ ...library, documents: [...library.documents, document], activeDocumentId: document.id }, { ...folderData, documentFolders: { ...folderData.documentFolders, ...(folderId ? { [document.id]: folderId } : {}) } });
    },
    async fetchDocumentUrl(url) {
      let response: Response;
      try { response = await fetch('/__swallow/import-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(25_000) }); }
      catch { throw new Error('문서를 가져오지 못했습니다. 네트워크와 주소를 확인하거나 원문을 붙여 넣으세요.'); }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('링크 가져오기는 데스크톱 앱 또는 npm run preview에서 사용할 수 있습니다.');
      const result = await response.json() as { ok: boolean; value?: ImportedDocument; error?: string };
      if (!result.ok || !result.value) throw new Error(result.error ?? '문서 본문을 가져오지 못했습니다.');
      return result.value;
    },
    getSpeechVoices: () => speech.voices(),
    async getSpeechState() { return speech.state; },
    onSpeechState: listener => speech.subscribe(listener),
    async speak(input) {
      const library = load().library;
      const doc = getDocument(library, input.documentId); const unit = getUnit(doc, input.unitId);
      if (library.activeDocumentId !== doc.id || doc.units[doc.position]?.id !== unit.id) throw new Error('현재 읽기 구간을 선택하세요.');
      await speech.speak(unit.text, input.voiceId, input.rate);
    },
    async controlSpeech(command) { speech.control(command); },
    async cancelImport() {},
    onImportState: () => () => {},
    async renderPdfPage() { throw new Error('PDF는 macOS 데스크톱 앱에서 가져오고 읽을 수 있습니다.'); },
    async importDocument(folderId) {
      if (folderId !== undefined && folderId !== null) requireFolder(folderId);
      const file = await new Promise<File | null>((resolve) => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.txt,.md';
        picker.hidden = true;
        const finish = (file: File | null) => { picker.remove(); resolve(file); };
        picker.addEventListener('change', () => finish(picker.files?.[0] ?? null), { once: true });
        picker.addEventListener('cancel', () => finish(null), { once: true });
        document.body.append(picker);
        picker.click();
      });
      if (!file) return;
      if (!/\.(txt|md)$/i.test(file.name)) throw new Error('지금은 .txt와 .md 파일만 읽을 수 있습니다.');
      if (file.size > 4_000_000) throw new Error('파일이 너무 큽니다. 원문 100만 자 이내의 파일을 선택하세요.');
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error('파일을 읽을 수 없습니다. UTF-8 형식의 텍스트 또는 Markdown 파일인지 확인하세요.');
      }
      await bridge.addDocument({ title: file.name.replace(/\.(txt|md)$/i, ''), source, goal: '', folderId });
    },
    async study(action) {
      if (['select-document', 'select-unit', 'delete-document'].includes(action.type)) speech.control('stop');
      const next = applyStudyAction(load().library, action);
      if (action.type === 'delete-document') {
        const data = studyData(), previous = localStorage.getItem(STUDY_KEY);
        delete data.sessions[action.documentId];
        data.notes = Object.fromEntries(Object.entries(data.notes).filter(([, note]) => note.source.documentId !== action.documentId));
        persistStudy(data);
        try { persist(next); }
        catch (error) {
          try { if (previous === null) localStorage.removeItem(STUDY_KEY); else localStorage.setItem(STUDY_KEY, previous); }
          catch { throw new Error('문서 삭제를 완료하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도하세요.'); }
          throw error;
        }
      } else persist(next);
    },
    requestGuide: desktopOnly, requestFeedback: desktopOnly,
    async cancelRequest() {},
    connectChatGPT: desktopOnly, cancelChatGPTSignIn: desktopOnly, refreshChatGPT: desktopOnly, disconnectChatGPT: desktopOnly,
    acknowledgeChatGPT: desktopOnly, openChatGPTUsage: desktopOnly, refreshModels: desktopOnly,
    connectOllama: desktopOnly, refreshOllama: desktopOnly, disconnectOllama: desktopOnly,
  };
  return bridge;
}
