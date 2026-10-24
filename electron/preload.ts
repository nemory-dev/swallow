import { contextBridge, ipcRenderer } from 'electron';
import type { PdfImportState, AppState, SpeechState, SpeechVoice, ImportedDocument, SwallowBridge, UpdateState } from '../src/shared/types.js';
import { restorePublicError } from '../src/shared/public-errors.js';
async function invoke<T = void>(method: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(`swallow:${method}`, ...args) as { ok: boolean; value?: T; error?: unknown };
  if (!result.ok) throw restorePublicError(result.error);
  return result.value as T;
}
const bridge: SwallowBridge = {
  translateDocument: (id, language, scope, unitId) => invoke('translate-document', id, language, scope, unitId),
  setLanguagePreferences: preferences => invoke('set-language-preferences', preferences),
  createFolder: name => invoke('create-folder', name),
  renameFolder: (id, name) => invoke('rename-folder', id, name),
  deleteFolder: id => invoke('delete-folder', id),
  moveDocument: (id, folderId) => invoke('move-document', id, folderId),
  getUpdateState: () => invoke<UpdateState>('update-state'),
  checkForUpdates: () => invoke('check-updates'),
  installUpdate: () => invoke('install-update'),
  onUpdateState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
    ipcRenderer.on('swallow:update-state', handler);
    return () => ipcRenderer.removeListener('swallow:update-state', handler);
  },
  getStudyWorkspace: id => invoke('study-workspace', id),
  studySession: action => invoke('study-session', action),
  explainStudy: (id, style) => invoke('study-explain', id, style),
  feedbackStudy: id => invoke('study-feedback', id),
  saveStudyNote: id => invoke('study-save-note', id),
  searchStudyNotes: (query, scope) => invoke('study-search-notes', query, scope),
  explainTerm: (id, term, url) => invoke('study-term', id, term, url),
  openTermSearch: term => invoke('study-web-search', term),
  speakStudy: (id, content, voice, rate) => invoke('study-speak', id, content, voice, rate),
  searchLibrary: (query, scope) => invoke('search-library', query, scope),
  openEvidence: reference => invoke('open-evidence', reference),
  archiveDocument: id => invoke('archive-document', id),
  restoreDocument: id => invoke('restore-document', id),
  setAutoArchive: enabled => invoke('auto-archive', enabled),
  compactStorage: () => invoke('compact-storage'),
  mode: 'desktop', getState: () => invoke<AppState>('get-state'),
  onState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on('swallow:state', handler);
    return () => ipcRenderer.removeListener('swallow:state', handler);
  },
  addDocument: input => invoke('add-document', input), importDocument: folderId => invoke('import-document', folderId),
  cancelImport: () => invoke('cancel-import'),
  renderPdfPage: (documentId, page) => invoke<string>('render-pdf-page', documentId, page),
  onImportState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: PdfImportState) => listener(state);
    ipcRenderer.on('swallow:import-state', handler);
    return () => ipcRenderer.removeListener('swallow:import-state', handler);
  },
  fetchDocumentUrl: url => invoke<ImportedDocument>('fetch-document-url', url),
  getSpeechVoices: () => invoke<SpeechVoice[]>('speech-voices'), getSpeechState: () => invoke<SpeechState>('speech-state'),
  onSpeechState(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: SpeechState) => listener(state);
    ipcRenderer.on('swallow:speech-state', handler);
    return () => ipcRenderer.removeListener('swallow:speech-state', handler);
  },
  speak: input => invoke('speak', input), controlSpeech: command => invoke('control-speech', command),
  study: action => invoke('study', action),
  requestGuide: (documentId, unitId) => invoke('guide', documentId, unitId),
  requestFeedback: (documentId, unitId) => invoke('feedback', documentId, unitId),
  connectChatGPT: (consent, accountId) => invoke('chatgpt:connect', consent, accountId),
  cancelChatGPTSignIn: () => invoke('chatgpt:cancel-sign-in'),
  refreshChatGPT: () => invoke('chatgpt:refresh'),
  disconnectChatGPT: () => invoke('chatgpt:disconnect'),
  acknowledgeChatGPT: () => invoke('chatgpt:acknowledge'),
  openChatGPTUsage: () => invoke('chatgpt:usage'),
  refreshModels: () => invoke('ai:refresh-models'),
  connectOllama: endpoint => invoke('ollama:connect', endpoint),
  refreshOllama: () => invoke('ollama:refresh'),
  disconnectOllama: () => invoke('ollama:disconnect'),
  cancelRequest: () => invoke('cancel-request'),
};
contextBridge.exposeInMainWorld('swallow', bridge);
