import type { AppLanguage, LanguagePreferences, LanguageResolution } from './i18n.js';
export type { LanguagePreferences, LanguageResolution } from './i18n.js';
// Runtime providers are explicit; historical AI provenance remains readable.
export type ProviderId = 'ollama' | 'chatgpt';
export type ResponseLanguage = AppLanguage;
export interface ModelCapabilities {
  text: 'supported' | 'unsupported' | 'unknown'; vision: 'supported' | 'unsupported' | 'unknown';
  structuredOutput: 'supported' | 'unsupported' | 'unknown'; executionLocation: 'same-device' | 'remote' | 'unknown';
}
export interface AIModel {
  slug: string; displayName: string; providerId?: ProviderId; connectionId?: string;
  upstreamModelId?: string; modelFingerprint?: string; capabilities?: ModelCapabilities;
}
export interface OllamaEndpoint { host: '127.0.0.1' | '::1'; port: number }
export interface OllamaState {
  status: 'disconnected' | 'checking' | 'ready' | 'unavailable' | 'error';
  endpoint: OllamaEndpoint; revision: number; models: AIModel[]; message: string; version?: string; checkedAt?: string;
}
export type CoachInputMessage = {
  role: 'user' | 'assistant' | 'developer';
  content: string | ({ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'low' | 'high' | 'auto' })[];
};
export interface CoachRequest {
  model: string; input: string | CoachInputMessage[]; instructions?: string;
  responseLanguage?: ResponseLanguage; responseSchema?: Record<string, unknown>;
  signal?: AbortSignal; onDelta?: (delta: string) => void;
}
export interface CoachProvider { streamResponse(options: CoachRequest): Promise<{ text: string }> }
export interface AIResultIdentity {
  providerId: ProviderId | 'chatgpt' | 'gemini'; connectionId: string; upstreamModelId: string; modelFingerprint?: string;
  responseLanguage: ResponseLanguage;
  promptRevision?: number;
}
export type Rating = 'again' | 'hard' | 'good';
export interface ReadingUnit { id: string; start: number; end: number; text: string; section: string }
export interface PdfPage { page: number; start: number; end: number; method: 'text' | 'ocr' | 'empty'; note?: string }
export interface PdfSource { assetId: string; pages: PdfPage[] }
export interface VisualEvidence { page: number; description: string; uncertainty: string }
export interface PdfImportState { status: 'idle' | 'importing' | 'saving'; message: string }
export interface ReadingGuide {
  identity?: AIResultIdentity;
  visualEvidence?: VisualEvidence[];
  overview: string;
  keyPoints: { title: string; explanation: string; quote: string }[];
  question: string;
}
export interface RecallFeedback { identity?: AIResultIdentity; visualEvidence?: VisualEvidence[]; assessment: string; missingPoints: string[]; nextStep: string }
export interface StudyAnswerFeedback { question: string; answer: string; model: string; result: RecallFeedback }
export interface RecallRecord {
  answer: string; savedAt: string; feedback?: RecallFeedback;
  rating?: Rating; reviewAt?: string;
}
/** Unreviewed translation draft; storage never certifies semantic accuracy. */
export interface SourceTranslation {
  sourceText: string; text: string; targetLanguage: ResponseLanguage;
  model: string; identity: AIResultIdentity; createdAt: string;
}
export type TranslationScope = 'unit' | 'document';
export interface StudyDocument {
  id: string; title: string; source: string; goal: string; createdAt: string;
  sourceUrl?: string;
  pdf?: PdfSource;
  units: ReadingUnit[]; position: number; readUnitIds: string[];
  guides: Record<string, { model: string; guide: ReadingGuide; revision?: number }>;
  recalls: Record<string, RecallRecord>;
  translations?: Record<string, Partial<Record<ResponseLanguage, SourceTranslation>>>;
}
export interface LibraryState {
  version: 1; documents: StudyDocument[]; activeDocumentId: string | null;
  selectedModel: string | null;
}
export interface DocumentSummary {
  folderId?: string | null;
  id: string; title: string; unitCount: number; readCount: number; recallCount: number;
  archived: boolean; lastUsedAt: string;
}
export interface LearningFolder { id: string; name: string; createdAt: string }
export type LibraryScope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'folder'; folderId: string };
export interface DueReview { documentId: string; unitId: string; position: number; reviewAt: string }
export interface EvidenceReference { documentId: string; unitId: string; sourceHash: string }
export interface SearchHit extends EvidenceReference {
  title: string; section: string; page?: number; start: number; end: number;
  excerpt: string; archived: boolean;
}
export interface SourceEvidence extends EvidenceReference { text: string; page?: number; truncated: boolean }
export type StudyStep = 'explain' | 'check' | 'note' | 'done';
export interface TermNote {
  responseLanguage?: ResponseLanguage; identity?: AIResultIdentity;
  term: string; explanation: string; kind: 'ai' | 'source' | 'web' | 'note';
  sourceTitle?: string; sourceUrl?: string; quote?: string; reference?: EvidenceReference;
}
export interface StudySession {
  responseLanguage?: ResponseLanguage;
  documentId: string; sourceHash: string; unitId: string; passageIndex: number;
  step: StudyStep; answer: string; unknown: boolean; terms: TermNote[];
  guide?: ReadingGuide; guideModel?: string; guideStyle?: ExplanationStyle; updatedAt: string;
  guideRevision?: number;
  answerFeedback?: StudyAnswerFeedback;
  relearning?: LearningAttempt[];
}
export interface LearningAttempt { question: string; answer: string }
export interface StudyNote {
  responseLanguage?: ResponseLanguage; guideIdentity?: AIResultIdentity;
  id: string; source: EvidenceReference; passageIndex: number; page?: number;
  title: string; summary: string; summaryOrigin: 'ai' | 'source'; sourceExcerpt: string;
  question: string; userAnswer: string; unknown: boolean; unresolved: string[];
  guideModel?: string; evidenceQuotes?: string[]; visualEvidence?: VisualEvidence[];
  answerFeedback?: StudyAnswerFeedback;
  terms: TermNote[]; createdAt: string; updatedAt: string;
  relearning?: LearningAttempt[];
}
export interface StudyWorkspace { session: StudySession | null; notes: StudyNote[] }
export type SessionAction =
  | { type: 'start'; documentId: string }
  | { type: 'step'; documentId: string; step: StudyStep }
  | { type: 'answer'; documentId: string; answer: string; unknown: boolean }
  | { type: 'relearn'; documentId: string; answer: string }
  | { type: 'next'; documentId: string }
  | { type: 'add-term'; documentId: string; term: TermNote };
export type ExplanationStyle = 'brief' | 'simple' | 'example' | 'relearn';
export interface MigrationReport {
  verified: boolean; documents: number; units: number; recalls: number; pdfs: number;
  sourceHash: string; backup: string; completedAt: string;
}
export interface StorageInfo { autoArchive: boolean; activeCount: number; archivedCount: number; migration: MigrationReport | null }
export interface AppState {
  language?: LanguageResolution;
  folders?: LearningFolder[];
  ollama?: OllamaState;
  chatgpt?: import('./chatgpt.js').ChatGPTState;
  documents?: DocumentSummary[];
  dueReviews?: DueReview[];
  storage?: StorageInfo;
  library: LibraryState;
  models: AIModel[];
  busy: { kind: 'guide' | 'feedback' | 'translation'; documentId: string; unitId: string; startedAt: string;
    targetLanguage?: ResponseLanguage; progress?: { completed: number; total: number } } | null;
  streamText: string; notice: string | null;
}
export type StudyAction =
  | { type: 'save-pdf-note'; documentId: string; page: number; note: string }
  | { type: 'select-document'; documentId: string }
  | { type: 'select-unit'; documentId: string; position: number }
  | { type: 'mark-read'; documentId: string; unitId: string }
  | { type: 'save-recall'; documentId: string; unitId: string; answer: string }
  | { type: 'rate-recall'; documentId: string; unitId: string; rating: Rating }
  | { type: 'delete-document'; documentId: string }
  | { type: 'select-model'; model: string };
export interface AddDocumentInput { title: string; source: string; goal: string; sourceUrl?: string; pdf?: PdfSource; folderId?: string | null }
export interface ImportedDocument { title: string; source: string; sourceUrl: string }
export interface SpeechVoice { id: string; name: string; lang: string }
export interface SpeechState { status: 'idle' | 'speaking' | 'paused'; error: string | null }
export interface SpeechInput { documentId: string; unitId: string; voiceId: string; rate: number }
export type SpeechCommand = 'pause' | 'resume' | 'stop';
export interface UpdateState {
  currentVersion: string;
  status: 'unavailable' | 'idle' | 'checking' | 'downloading' | 'stalled' | 'current' | 'downloaded' | 'preparing' | 'installing' | 'error';
  message: string; checkedAt?: string; releaseName?: string; releaseNotes?: string;
}
export interface SwallowBridge {
  translateDocument(documentId: string, targetLanguage: ResponseLanguage, scope: TranslationScope, unitId?: string): Promise<void>;
  setLanguagePreferences(preferences: LanguagePreferences): Promise<void>;
  createFolder(name: string): Promise<LearningFolder>;
  renameFolder(folderId: string, name: string): Promise<void>;
  deleteFolder(folderId: string): Promise<void>;
  moveDocument(documentId: string, folderId: string | null): Promise<void>;
  mode: 'desktop' | 'browser';
  getUpdateState(): Promise<UpdateState>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  getStudyWorkspace(documentId: string): Promise<StudyWorkspace>;
  studySession(action: SessionAction): Promise<StudyWorkspace>;
  explainStudy(documentId: string, style: ExplanationStyle): Promise<StudyWorkspace>;
  feedbackStudy(documentId: string): Promise<StudyWorkspace>;
  saveStudyNote(documentId: string): Promise<StudyWorkspace>;
  searchStudyNotes(query: string, scope?: LibraryScope): Promise<StudyNote[]>;
  explainTerm(documentId: string, term: string, sourceUrl?: string): Promise<TermNote>;
  openTermSearch(term: string): Promise<void>;
  speakStudy(documentId: string, content: 'source' | 'explanation', voiceId: string, rate: number): Promise<void>;
  searchLibrary(query: string, scope?: LibraryScope): Promise<SearchHit[]>;
  openEvidence(reference: EvidenceReference): Promise<void>;
  archiveDocument(documentId: string): Promise<void>;
  restoreDocument(documentId: string): Promise<void>;
  setAutoArchive(enabled: boolean): Promise<void>;
  compactStorage(): Promise<void>;
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  addDocument(input: AddDocumentInput): Promise<void>;
  importDocument(folderId?: string | null): Promise<void>;
  cancelImport(): Promise<void>;
  onImportState(listener: (state: PdfImportState) => void): () => void;
  renderPdfPage(documentId: string, page: number): Promise<string>;
  fetchDocumentUrl(url: string): Promise<ImportedDocument>;
  getSpeechVoices(): Promise<SpeechVoice[]>;
  getSpeechState(): Promise<SpeechState>;
  onSpeechState(listener: (state: SpeechState) => void): () => void;
  speak(input: SpeechInput): Promise<void>;
  controlSpeech(command: SpeechCommand): Promise<void>;
  study(action: StudyAction): Promise<void>;
  requestGuide(documentId: string, unitId: string): Promise<void>;
  requestFeedback(documentId: string, unitId: string): Promise<void>;
  cancelRequest(): Promise<void>;
  connectChatGPT(consent: string, accountId?: string): Promise<void>;
  cancelChatGPTSignIn(): Promise<void>;
  refreshChatGPT(): Promise<void>;
  disconnectChatGPT(): Promise<void>;
  acknowledgeChatGPT(): Promise<void>;
  openChatGPTUsage(): Promise<void>;
  refreshModels(): Promise<void>;
  connectOllama(endpoint: OllamaEndpoint): Promise<void>;
  refreshOllama(): Promise<void>;
  disconnectOllama(): Promise<void>;
}

declare global { interface Window { swallow?: SwallowBridge } }
