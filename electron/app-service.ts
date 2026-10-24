import { sameAIIdentity } from '../src/shared/ai-identity.js';
import { validateResponseLanguage } from '../src/shared/ai-identity.js';
import { validateTranslationScope } from '../src/learning/translation.js';
import { unitPage } from '../src/learning/pdf.js';
import { SourceTranslator, TRANSLATION_REVISION } from './translation.js';
import type { AIResultIdentity, ResponseLanguage, TranslationScope, SourceTranslation, CoachProvider } from '../src/shared/types.js';
import { errorText, PublicError, localizeText } from '../src/shared/public-errors.js';
import { type LanguagePreferences, resolveLanguagePreferences, validateLanguagePreferences } from '../src/shared/i18n.js';
import type { LibraryScope } from '../src/shared/types.js';
import type { AIModel, ProviderId, OllamaEndpoint } from '../src/shared/types.js';
import type { OllamaProvider } from './ollama.js';
import type { ChatGPTProvider } from './chatgpt.js';
import type { AddDocumentInput, AppState, EvidenceReference, ReadingGuide, RecallFeedback, StudyAction, SessionAction, ExplanationStyle, StudySession, StudyDocument, TermNote } from '../src/shared/types.js';
import { applyStudyAction, createDocument, emptyLibrary, getDocument, getUnit } from '../src/learning/document.js';
import { requireText } from '../src/learning/guide.js';
import { LibraryStore } from './library.js';
import { STUDY_GUIDE_REVISION, STUDY_FEEDBACK_REVISION, StudyCoach, type CoachHint } from './coach.js';
import { applySessionAction, createStudySession, studyQuestion } from '../src/learning/session.js';
import { studyInputDocument, termSearchUrl } from './study-input.js';
import { fetchDocumentUrl } from './document-url.js';

type StudyAIResult<K extends 'guide' | 'feedback'> = K extends 'guide' ? ReadingGuide : RecallFeedback;

export function safeError(error: unknown): string { return errorText(error, 'ko'); }

export class AppService {
  private readonly coach: StudyCoach;
  private readonly translator: SourceTranslator;
  private readonly modelProviders = new Map<string, ProviderId>();
  private localOperation = false;
  private unsubscribeChatGPT?: () => void;
  private readonly listeners = new Set<(state: AppState) => void>();
  private state: AppState = { library: emptyLibrary(), models: [], busy: null, streamText: '', notice: null };
  private startupError: Error | null = null;
  private connectionGeneration = 0;
  private requestGeneration = 0;
  private contextTransitions = 0;
  private studyController: AbortController | null = null;
  constructor(private readonly store: LibraryStore, private readonly ollama?: Pick<OllamaProvider, 'state' | 'initialize' | 'connect' | 'refresh' | 'disconnect' | 'streamResponse' | 'cancel' | 'dispose'>, private readonly lookupSource: typeof fetchDocumentUrl = fetchDocumentUrl, private readonly chatgpt?: Pick<ChatGPTProvider, 'state' | 'initialize' | 'subscribe' | 'signIn' | 'cancelSignIn' | 'refresh' | 'disconnect' | 'acknowledgeFirstUse' | 'streamResponse' | 'cancel' | 'dispose'>) {
    const provider: CoachProvider = { streamResponse: options => {
      const providerId = this.modelProviders.get(options.model);
      if (providerId === 'chatgpt' && this.chatgpt) return this.chatgpt.streamResponse(options);
      if (providerId === 'ollama' && this.ollama) return this.ollama.streamResponse(options);
      throw new PublicError('errors.modelUnavailable');
    } };
    this.coach = new StudyCoach(provider, 180_000);
    this.translator = new SourceTranslator(provider);
    this.unsubscribeChatGPT = this.chatgpt?.subscribe(() => { this.syncChatGPT(); this.publish(); });
  }
  async initialize(systemLocales: readonly string[] = []) {
    try { this.state.library = await this.store.load(); this.refreshMetadata(); }
    catch (error) { this.startupError = new Error(safeError(error)); throw this.startupError; }
    try { this.state.language = await this.store.initializeLanguagePreferences(systemLocales); }
    catch {
      this.state.language = resolveLanguagePreferences({ installation: 'existing', stored: null });
      this.state.notice = new PublicError('language.saveFailed').message;
    }
    if (this.ollama) { await this.ollama.initialize(); this.syncOllama(); }
    if (this.chatgpt) { await this.chatgpt.initialize(); this.syncChatGPT(); }
    this.publish();
  }
  async setLanguagePreferences(preferences: LanguagePreferences): Promise<void> {
    const confirmed = validateLanguagePreferences(preferences);
    await this.store.setLanguagePreferences(confirmed);
    this.state.language = { preferences: confirmed, status: 'valid', invalidFields: [] };
    this.state.notice = null; this.publish();
  }
  getState(): AppState {
    if (this.startupError) throw this.startupError;
    const snapshot = structuredClone(this.state);
    if (snapshot.notice) snapshot.notice = localizeText(snapshot.notice, 'ko');
    if (snapshot.ollama?.message) snapshot.ollama.message = localizeText(snapshot.ollama.message, 'ko');
    return snapshot;
  }
  subscribe(listener: (state: AppState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private publish() { if (!this.startupError) for (const listener of this.listeners) listener(this.getState()); }
  private refreshMetadata() {
    this.state.folders = this.store.folders();
    this.state.documents = this.store.catalog();
    this.state.dueReviews = this.store.due('9999-12-31T00:00:00.000Z');
    this.state.storage = this.store.storageInfo();
  }
  private async update(reduce: Parameters<LibraryStore['update']>[0]) {
    this.state.library = await this.store.update(reduce);
    this.refreshMetadata();
    this.state.notice = null;
    this.publish();
  }
  private async withContextTransition<T>(operation: () => Promise<T>): Promise<T> {
    this.contextTransitions++;
    try { return await operation(); } finally { this.contextTransitions--; }
  }
  async addDocument(input: AddDocumentInput) { return this.withContextTransition(() => this.addDocumentInContext(input)); }
  private async addDocumentInContext(input: AddDocumentInput) {
    const doc = createDocument(input);
    this.cancelRequest();
    this.state.library = await this.store.addDocument(doc, input.folderId);
    this.refreshMetadata(); this.state.notice = null; this.publish();
  }
  async translateDocument(documentId: string, targetLanguage: ResponseLanguage, scope: TranslationScope, unitId?: string): Promise<void> {
    try {
      requireText(documentId, '자료 ID', 200);
      validateResponseLanguage(targetLanguage); validateTranslationScope(scope);
      if (unitId !== undefined) requireText(unitId, '읽기 단위 ID', 200);
    } catch { throw new PublicError('public.translationInvalid'); }
    const doc = structuredClone(getDocument(this.state.library, documentId));
    if (this.state.library.activeDocumentId !== documentId) throw new PublicError('public.translationContext');
    if (unitId !== undefined) getUnit(doc, unitId);
    const units = (scope === 'document' ? doc.units : [getUnit(doc, unitId ?? doc.units[doc.position]!.id)])
      .filter(unit => unit.text.trim() && unitPage(doc, unit)?.method !== 'empty');
    if (!units.length) throw new PublicError('public.translationEmpty');
    const model = this.requireStudyAI();
    const identity = this.resultIdentity(model, targetLanguage, TRANSLATION_REVISION);
    const generation = this.connectionGeneration, attempt = this.requestGeneration;
    const controller = new AbortController(); this.studyController = controller;
    const request: NonNullable<AppState['busy']> = { kind: 'translation', documentId, unitId: units[0]!.id,
      startedAt: new Date().toISOString(), targetLanguage, progress: { completed: 0, total: units.length } };
    const ensureCurrent = () => {
      if (controller.signal.aborted) throw new PublicError('public.translationCancelled');
      if (generation !== this.connectionGeneration || attempt !== this.requestGeneration || this.state.library.activeDocumentId !== documentId
        || this.state.library.selectedModel !== model || !sameAIIdentity(this.resultIdentity(model, targetLanguage, TRANSLATION_REVISION), identity))
        throw new PublicError('public.translationContext');
    };
    this.state.busy = request; this.state.notice = null; this.state.streamText = ''; this.publish();
    try {
      for (const unit of units) {
        ensureCurrent(); request.unitId = unit.id;
        const cached = getDocument(this.state.library, documentId).translations?.[unit.id]?.[targetLanguage];
        if (!(cached?.sourceText === unit.text && cached.model === model && sameAIIdentity(cached.identity, identity))) {
          const text = await this.translator.translate(unit.text, targetLanguage, model, controller.signal);
          ensureCurrent();
          const result: SourceTranslation = { sourceText: unit.text, text, targetLanguage, model, identity, createdAt: new Date().toISOString() };
          try {
            await this.update(library => {
              ensureCurrent();
              const target = getDocument(library, documentId);
              if (library.activeDocumentId !== documentId || library.selectedModel !== model || getUnit(target, unit.id).text !== unit.text)
                throw new PublicError('public.translationContext');
              target.translations = { ...target.translations, [unit.id]: { ...target.translations?.[unit.id], [targetLanguage]: result } };
              return library;
            });
          } catch (error) {
            if (error instanceof PublicError) throw error;
            throw new PublicError('public.translationSave');
          }
        }
        request.progress!.completed++; this.publish();
      }
    } catch (error) { this.state.notice = safeError(error); throw error; }
    finally {
      if (this.studyController === controller) this.studyController = null;
      if (this.state.busy === request) { this.state.busy = null; this.state.streamText = ''; this.publish(); }
    }
  }
  async study(action: StudyAction) { return this.withContextTransition(() => this.studyInContext(action)); }
  private async studyInContext(action: StudyAction) {
    if (action?.type === 'select-unit') this.cancelRequest();
    if (action?.type === 'select-document') {
      this.cancelRequest(); this.state.library = await this.store.select(action.documentId);
      this.refreshMetadata(); this.publish(); return;
    }
    if (action?.type === 'select-model') {
      if (!this.state.models.some(model => model.slug === action.model)) throw new Error('계정에서 제공하지 않는 모델입니다.');
      this.cancelRequest();
    }
    if (this.state.busy && action && 'documentId' in action && this.state.busy.documentId === action.documentId &&
      (action.type === 'delete-document' || action.type === 'save-recall' || action.type === 'rate-recall' || action.type === 'save-pdf-note')) this.cancelRequest();
    await this.update(library => applyStudyAction(library, action));
  }
  async createFolder(name: string) { const folder = await this.store.createFolder(name); this.refreshMetadata(); this.publish(); return folder; }
  async renameFolder(id: string, name: string) { await this.store.renameFolder(id, name); this.refreshMetadata(); this.publish(); }
  async deleteFolder(id: string) { await this.store.deleteFolder(id); this.refreshMetadata(); this.publish(); }
  async moveDocument(id: string, folderId: string | null) { await this.store.moveDocument(id, folderId); this.refreshMetadata(); this.publish(); }
  searchLibrary(query: string, scope?: LibraryScope) { if (this.startupError) throw this.startupError; return this.store.search(query, scope); }
  getStudyWorkspace(documentId: string) {
    requireText(documentId, '자료 ID', 200);
    if (this.startupError) throw this.startupError;
    return this.store.studyWorkspace(documentId);
  }
  searchStudyNotes(query: string, scope?: LibraryScope) { return this.store.searchStudyNotes(query, scope); }
  async studySession(action: SessionAction) { return this.withContextTransition(() => this.studySessionInContext(action)); }
  private async studySessionInContext(action: SessionAction) {
    if (!action || typeof action !== 'object') throw new Error('학습 동작이 잘못되었습니다.');
    requireText(action.documentId, '자료 ID', 200);
    getDocument(this.state.library, action.documentId);
    if (action.type === 'add-term' && action.term?.reference) {
      const evidence = this.store.evidence(action.term.reference, 6000);
      if (action.term.kind === 'source' && (!action.term.quote || !evidence.text.includes(action.term.quote))) throw new Error('용어 메모의 인용이 원문에 없습니다. 다시 검색하세요.');
    }
    this.cancelRequest();
    await this.store.updateStudySession(action.documentId, (session, doc, reference) => {
      if (action.type === 'start') return session ?? createStudySession(doc, reference.sourceHash, undefined, this.responseLanguage());
      if (!session) throw new Error('먼저 공부 시작을 눌러 주세요.');
      return applySessionAction(doc, session, action, undefined, this.responseLanguage());
    });
    return this.getStudyWorkspace(action.documentId);
  }
  async saveStudyNote(documentId: string) { return this.withContextTransition(() => this.saveStudyNoteInContext(documentId)); }
  private async saveStudyNoteInContext(documentId: string) {
    getDocument(this.state.library, documentId);
    this.cancelRequest();
    await this.store.saveStudyNote(documentId);
    return this.getStudyWorkspace(documentId);
  }
  async explainStudy(documentId: string, style: ExplanationStyle) {
    if (!['brief', 'simple', 'example', 'relearn'].includes(style)) throw new Error('설명 방식을 확인해 주세요.');
    const session = this.getStudyWorkspace(documentId).session;
    if (!session) throw new Error('먼저 공부 시작을 눌러 주세요.');
    if (style === 'relearn' && !session.relearning?.length) throw new Error('확인 질문에서 모름을 선택한 뒤 다시 설명을 요청하세요.');
    this.requireStudyAI();
    if (session.guide && session.guideRevision === STUDY_GUIDE_REVISION && session.guideModel === this.state.library.selectedModel && session.guideStyle === style && sameAIIdentity(session.guide.identity, this.resultIdentity(this.state.library.selectedModel!, session.responseLanguage ?? 'ko', STUDY_GUIDE_REVISION))) return this.getStudyWorkspace(documentId);
    await this.runStudyAI('guide', documentId, session, async doc => {
      const input = studyInputDocument(doc, session);
      return { doc: input.document, hint: { style, previousContext: input.previousContext,
        ...(style === 'relearn' ? { learner: session.relearning!.at(-1)! } : {}) } };
    }, async (guide, model, ensureCurrent) => {
      await this.store.updateStudySession(documentId, current => {
        ensureCurrent(current);
        const { answerFeedback: _feedback, ...remaining } = current!;
        return { ...remaining, guide, guideModel: model, guideStyle: style, guideRevision: STUDY_GUIDE_REVISION, updatedAt: new Date().toISOString() };
      });
    });
    return this.getStudyWorkspace(documentId);
  }
  async feedbackStudy(documentId: string) {
    const session = this.getStudyWorkspace(documentId).session;
    if (!session || session.step !== 'check') throw new Error('확인하기 단계에서 피드백을 요청하세요.');
    if (session.unknown || !session.answer.trim()) throw new Error('피드백을 받을 답변을 먼저 저장하세요.');
    const model = this.requireStudyAI(), question = studyQuestion(session);
    if (session.answerFeedback?.model === model && sameAIIdentity(session.answerFeedback.result.identity, this.resultIdentity(model, session.responseLanguage ?? 'ko', STUDY_FEEDBACK_REVISION))) return this.getStudyWorkspace(documentId);
    await this.runStudyAI('feedback', documentId, session, async doc => {
      const input = studyInputDocument(doc, session);
      return { doc: { ...input.document, recalls: { ...input.document.recalls, [session.unitId]: { answer: session.answer, savedAt: session.updatedAt } } }, hint: { question } };
    }, async (result, model, ensureCurrent) => {
      await this.store.updateStudySession(documentId, current => {
        ensureCurrent(current);
        if (studyQuestion(current!) !== question || current!.answer !== session.answer || current!.unknown || current!.step !== 'check') throw new Error('질문이나 답변이 변경되어 피드백을 저장하지 않았습니다.');
        return { ...current!, answerFeedback: { question, answer: session.answer, model, result }, updatedAt: new Date().toISOString() };
      });
    });
    return this.getStudyWorkspace(documentId);
  }
  async explainTerm(documentId: string, term: string, sourceUrl?: string): Promise<TermNote> {
    termSearchUrl(term);
    if (sourceUrl !== undefined && (typeof sourceUrl !== 'string' || sourceUrl.length > 4096)) throw new Error('공개 문서 URL을 확인하세요.');
    const session = this.getStudyWorkspace(documentId).session;
    if (!session) throw new Error('먼저 공부 시작을 눌러 주세요.');
    let result: TermNote | undefined;
    let imported: Awaited<ReturnType<typeof fetchDocumentUrl>> | undefined;
    await this.runStudyAI('guide', documentId, session, async (doc, signal) => {
      if (sourceUrl) {
        imported = await this.lookupSource(sourceUrl, { signal });
        const index = Math.max(0, imported.source.toLocaleLowerCase().indexOf(term.trim().toLocaleLowerCase()) - 300);
        const source = imported.source.slice(index, index + 1800);
        const synthetic: StudyDocument = { ...doc, source, pdf: undefined, units: [{ id: session.unitId, start: 0, end: source.length, text: source, section: imported.title }] };
        return { doc: synthetic, hint: { term: term.trim(), style: 'simple', previousContext: '' } };
      }
      const input = studyInputDocument(doc, session);
      return { doc: input.document, hint: { term: term.trim(), style: 'simple', previousContext: input.previousContext } };
    }, async (guide, _model, ensureCurrent) => {
      ensureCurrent(this.getStudyWorkspace(documentId).session);
      result = {
        term: term.trim(), explanation: [guide.overview, ...guide.keyPoints.map(point => point.explanation)].join('\n\n').slice(0, 6000),
        kind: imported ? 'web' : 'ai', responseLanguage: session.responseLanguage ?? 'ko', identity: guide.identity,
        ...(imported ? { sourceTitle: imported.title, sourceUrl: imported.sourceUrl, quote: guide.keyPoints.find(point => point.quote)?.quote } : {}),
      };
    });
    if (!result) throw new Error('용어 설명을 완료하지 못했습니다. 다시 시도하세요.');
    return result;
  }
  private responseLanguage(): ResponseLanguage { return this.state.language?.preferences.responseLanguage ?? 'ko'; }
  private resultIdentity(model: string, responseLanguage: ResponseLanguage, promptRevision: number): AIResultIdentity {
    const record = this.state.models.find(value => value.slug === model);
    const providerId = this.modelProviders.get(model);
    if (!record || !providerId) throw new PublicError('errors.modelUnavailable');
    return { providerId,
      connectionId: record.connectionId ?? 'ollama:local',
      upstreamModelId: record.upstreamModelId ?? model,
      ...(record.modelFingerprint === undefined ? {} : { modelFingerprint: record.modelFingerprint }),
      responseLanguage, promptRevision };
  }
  private requireStudyAI(): string {
    if (this.state.busy || this.contextTransitions) throw new PublicError('public.aiBusy');
    const model = this.state.library.selectedModel;
    if (!model || !this.modelProviders.has(model) || !this.state.models.some(value => value.slug === model)) throw new PublicError('errors.modelUnavailable');
    if (this.modelProviders.get(model) === 'chatgpt') {
      if (!this.chatgpt || this.state.chatgpt?.status !== 'ready') throw new PublicError('public.chatgptUnavailable');
    } else if (this.localOperation || !this.ollama || this.state.ollama?.status !== 'ready') throw new Error('Ollama 서버를 연결하고 연결 상태를 확인하세요.');
    return model;
  }
  private async runStudyAI<K extends 'guide' | 'feedback'>(
    kind: K, documentId: string, session: StudySession,
    prepare: (doc: StudyDocument, signal: AbortSignal) => Promise<{ doc: StudyDocument; hint: CoachHint }>,
    complete: (result: StudyAIResult<K>, model: string, ensureCurrent: (current: StudySession | null) => void) => Promise<void>,
  ) {
    const model = this.requireStudyAI();
    const identity = this.resultIdentity(model, session.responseLanguage ?? 'ko', kind === 'guide' ? STUDY_GUIDE_REVISION : STUDY_FEEDBACK_REVISION);
    const doc = structuredClone(getDocument(this.state.library, documentId));
    this.requireSupportedDocument(doc, model);
    const generation = this.connectionGeneration, attempt = this.requestGeneration;
    const controller = new AbortController();
    this.studyController = controller;
    let onAbort: (() => void) | undefined;
    const request = { kind, documentId, unitId: session.unitId, startedAt: new Date().toISOString() };
    const ensureCurrent = (current: StudySession | null) => {
      if (!sameAIIdentity(this.resultIdentity(model, identity.responseLanguage, identity.promptRevision!), identity)) throw new PublicError('public.contextChanged');
      if (generation !== this.connectionGeneration || attempt !== this.requestGeneration || this.state.library.activeDocumentId !== documentId || !current || current.updatedAt !== session.updatedAt || current.unitId !== session.unitId || current.passageIndex !== session.passageIndex || current.sourceHash !== session.sourceHash) throw new Error('학습 위치나 계정이 변경되어 요청을 취소했습니다.');
    };
    this.state.busy = request; this.state.streamText = ''; this.state.notice = null; this.publish();
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('학습 요청을 취소했습니다.'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const input = await Promise.race([prepare(doc, controller.signal), cancelled]);
      ensureCurrent(this.getStudyWorkspace(documentId).session);
      const result = await this.coach.run(kind, input.doc, session.unitId, () => {}, model, { ...input.hint, responseLanguage: identity.responseLanguage }) as StudyAIResult<K>;
      result.identity = identity;
      if (kind === 'guide') {
        const guide = result as ReadingGuide;
        requireText(guide.overview, '짧은 설명', 700);
        requireText(guide.question, '확인 질문', 300);
        if (guide.keyPoints.length > 2 || guide.keyPoints.some(point => point.explanation.length > 700)) throw new Error('설명이 너무 깁니다. 짧은 설명을 다시 요청하세요.');
      }
      ensureCurrent(this.getStudyWorkspace(documentId).session);
      await complete(result, model, ensureCurrent);
    } catch (error) { this.state.notice = safeError(error); throw new Error(this.state.notice); }
    finally {
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      if (this.studyController === controller) this.studyController = null;
      if (this.state.busy === request) { this.state.busy = null; this.state.streamText = ''; this.publish(); }
    }
  }
  async openEvidence(reference: EvidenceReference) { return this.withContextTransition(() => this.openEvidenceInContext(reference)); }
  private async openEvidenceInContext(reference: EvidenceReference) {
    this.store.evidence(reference);
    this.cancelRequest();
    await this.store.restore(reference.documentId);
    this.state.library = await this.store.select(reference.documentId);
    const doc = getDocument(this.state.library, reference.documentId);
    await this.update(state => applyStudyAction(state, { type: 'select-unit', documentId: doc.id, position: doc.units.findIndex(unit => unit.id === reference.unitId) }));
  }
  async archiveDocument(id: string) { return this.withContextTransition(() => this.archiveDocumentInContext(id)); }
  private async archiveDocumentInContext(id: string) {
    requireText(id, '자료 ID', 200); this.cancelRequest();
    await this.store.archive(id); this.state.library = this.store.snapshot(); this.refreshMetadata(); this.publish();
  }
  async restoreDocument(id: string) { return this.withContextTransition(() => this.restoreDocumentInContext(id)); }
  private async restoreDocumentInContext(id: string) {
    requireText(id, '자료 ID', 200); await this.store.restore(id);
    this.state.library = this.store.snapshot(); this.refreshMetadata(); this.publish();
  }
  async setAutoArchive(enabled: boolean) { await this.store.setAutoArchive(enabled); this.refreshMetadata(); this.publish(); }
  async compactStorage() { await this.store.compact(); }
  async maintainStorage() {
    if (this.startupError || this.state.busy) return;
    await this.store.maintain(); this.state.library = this.store.snapshot(); this.refreshMetadata(); this.publish();
  }
  async generate(kind: 'guide' | 'feedback', documentId: string, unitId: string) {
    requireText(documentId, '자료 ID', 200); requireText(unitId, '읽기 단위 ID', 200);
    const model = this.requireStudyAI();
    const doc = getDocument(this.state.library, documentId);
    this.requireSupportedDocument(doc, model);
    const unit = getUnit(doc, unitId);
    const savedGuide = doc.guides[unitId]?.guide;
    const language = savedGuide ? savedGuide.identity?.responseLanguage ?? 'ko' : kind === 'feedback' ? 'ko' : this.responseLanguage();
    const identity = this.resultIdentity(model, language, kind === 'guide' ? STUDY_GUIDE_REVISION : STUDY_FEEDBACK_REVISION);
    if (kind === 'guide' && doc.guides[unitId]?.model === model && doc.guides[unitId]?.revision === STUDY_GUIDE_REVISION && sameAIIdentity(doc.guides[unitId]?.guide.identity, identity)) return;
    if (kind === 'feedback' && sameAIIdentity(doc.recalls[unitId]?.feedback?.identity, identity)) return;
    const answer = doc.recalls[unitId]?.answer;
    if (kind === 'feedback' && !answer?.trim()) throw new Error('먼저 회상 답변을 저장해 주세요.');
    const generation = this.connectionGeneration;
    const attempt = this.requestGeneration;
    const request = { kind, documentId, unitId, startedAt: new Date().toISOString() };
    this.state.busy = request;
    this.state.streamText = '';
    this.state.notice = null;
    this.publish();
    let lastPublish = 0;
    try {
      const result = await this.coach.run(kind, structuredClone(doc), unitId, delta => {
        if (this.state.busy !== request || generation !== this.connectionGeneration) return;
        this.state.streamText += delta;
        if (Date.now() - lastPublish > 150) { this.publish(); lastPublish = Date.now(); }
      }, model, { responseLanguage: language });
      result.identity = identity;
      if (generation !== this.connectionGeneration) throw new Error('계정이 변경되어 학습 요청을 취소했습니다.');
      await this.update(library => {
        if (!sameAIIdentity(this.resultIdentity(model, identity.responseLanguage, identity.promptRevision!), identity)) throw new PublicError('public.contextChanged');
        if (attempt !== this.requestGeneration || generation !== this.connectionGeneration) throw new Error('학습 요청을 취소했습니다.');
        const target = getDocument(library, documentId);
        if (getUnit(target, unitId).text !== unit.text) throw new Error('원문이 변경되어 결과를 저장하지 않았습니다.');
        if (kind === 'guide') target.guides[unitId] = { model, guide: result as ReadingGuide, revision: STUDY_GUIDE_REVISION };
        else {
          const record = target.recalls[unitId];
          if (!record || record.answer !== answer) throw new Error('답변이 변경되어 이전 피드백을 저장하지 않았습니다.');
          record.feedback = result as RecallFeedback;
        }
        return library;
      });
    } catch (error) { this.state.notice = safeError(error); throw new Error(this.state.notice); }
    finally { if (this.state.busy === request) { this.state.busy = null; this.state.streamText = ''; this.publish(); } }
  }
  private requireSupportedDocument(doc: StudyDocument, _model: string) {
    if (doc.pdf) throw new PublicError('public.localPdf');
  }
  cancelRequest() { this.requestGeneration++; this.studyController?.abort(); this.coach.cancel(); this.ollama?.cancel(); this.chatgpt?.cancel(); }
  private replaceModels(provider: ProviderId, models: AIModel[]) {
    this.state.models = this.state.models.filter(model => this.modelProviders.get(model.slug) !== provider);
    for (const [slug, owner] of this.modelProviders) if (owner === provider) this.modelProviders.delete(slug);
    for (const model of models) {
      if (this.modelProviders.has(model.slug) && this.modelProviders.get(model.slug) !== provider) throw new Error('다른 제공자와 중복되는 모델 ID입니다.');
      this.modelProviders.set(model.slug, provider);
    }
    this.state.models.push(...models);
  }
  private syncChatGPT() {
    if (!this.chatgpt) return;
    this.state.chatgpt = this.chatgpt.state;
    this.replaceModels('chatgpt', this.state.chatgpt.models);
  }
  private async chatgptOperation(action: () => Promise<void>) {
    if (!this.chatgpt) throw new PublicError('public.chatgptUnavailable');
    this.connectionGeneration++; this.cancelRequest();
    try { await action(); this.state.notice = null; }
    catch (error) { this.state.notice = safeError(error); throw error; }
    finally { this.syncChatGPT(); this.publish(); }
  }
  connectChatGPT(consent: string, accountId?: string) {
    if (typeof consent !== 'string' || (accountId !== undefined && (typeof accountId !== 'string' || accountId.length > 100))) throw new PublicError('public.chatgptConsent');
    return this.chatgptOperation(() => this.chatgpt!.signIn(consent, accountId));
  }
  cancelChatGPTSignIn() { this.chatgpt?.cancelSignIn(); }
  refreshChatGPT() { return this.chatgptOperation(() => this.chatgpt!.refresh()); }
  disconnectChatGPT() { return this.chatgptOperation(() => this.chatgpt!.disconnect()); }
  async acknowledgeChatGPT() { await this.chatgpt?.acknowledgeFirstUse(); }
  refreshModels() {
    return this.state.library.selectedModel?.startsWith('chatgpt:') || (!this.state.library.selectedModel && this.state.chatgpt?.activeAccountId)
      ? this.refreshChatGPT() : this.refreshOllama();
  }
  private syncOllama() {
    if (!this.ollama) return;
    this.state.ollama = this.ollama.state;
    this.replaceModels('ollama', this.state.ollama.models);
  }
  private async ollamaOperation(action: () => Promise<void>) {
    if (!this.ollama) throw new Error('로컬 AI는 데스크톱 앱에서 연결하세요.');
    if (this.localOperation) throw new Error('로컬 AI 연결을 확인하는 중입니다.');
    this.localOperation = true;
    this.connectionGeneration++; this.cancelRequest();
    try {
      const operation = action(); this.syncOllama();
      if (this.state.ollama) this.state.ollama = { ...this.state.ollama, status: 'checking', message: '로컬 AI 연결 설정을 확인하는 중입니다.' };
      this.publish(); await operation; this.syncOllama();
    } catch (error) { this.state.notice = safeError(error); throw new Error(this.state.notice); }
    finally { this.localOperation = false; this.syncOllama(); this.publish(); }
  }
  connectOllama(endpoint: OllamaEndpoint) { return this.ollamaOperation(() => this.ollama!.connect(endpoint)); }
  refreshOllama() { return this.ollamaOperation(() => this.ollama!.refresh()); }
  disconnectOllama() { return this.ollamaOperation(() => this.ollama!.disconnect()); }
  dispose() { this.cancelRequest(); this.listeners.clear(); this.unsubscribeChatGPT?.(); this.chatgpt?.dispose(); this.ollama?.dispose(); this.store.close(); }

}
