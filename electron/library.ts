import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, stat, chmod, link, rm, open } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzip, gzipSync, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import type { DocumentSummary, DueReview, EvidenceReference, LibraryState, MigrationReport, RecallRecord, SearchHit, SourceEvidence, StorageInfo, StudyDocument, StudySession, StudyNote, StudyWorkspace } from '../src/shared/types.js';
import { emptyLibrary, validateLibrary } from '../src/learning/document.js';
import { unitPage } from '../src/learning/pdf.js';
import { validatePdf } from '../src/learning/pdf.js';
import { createStudyNote, validateStudyNote, validateStudySession } from '../src/learning/session.js';
import { initializeSchema, verifyDatabase } from './library-schema.js';
import type { LearningFolder, LibraryScope } from '../src/shared/types.js';
import { folderNameKey, normalizeFolderName, validateFolderId, validateScope } from '../src/learning/folders.js';
import { resolveLanguagePreferences, validateLanguagePreferences, type LanguagePreferences, type LanguageResolution } from '../src/shared/i18n.js';
import { PublicError } from '../src/shared/public-errors.js';

const compress = promisify(gzip);
// ASCII tokens prevent unicode61 folding distinct short strings (e/é, σ/ς).
const shortToken = (text: string) => 't' + [...text].map(char => char.codePointAt(0)!.toString(16)).join('x');
export const sourceHash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(',')}}`;
  return JSON.stringify(value);
}
type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const validateDocument = (doc: StudyDocument) => validateLibrary({ ...emptyLibrary(), documents: [doc], activeDocumentId: doc.id }).documents[0]!;
const documentHash = (source: string, pdf?: StudyDocument['pdf']) => sourceHash(canonical({ source, assetId: pdf?.assetId ?? null }));
const unpack = (value: unknown) => gunzipSync(Buffer.from(value as Uint8Array), { maxOutputLength: 80_000_000 }).toString('utf8');

export class LibraryStore {
  private db: DatabaseSync | null = null;
  private state: LibraryState = emptyLibrary();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private identity: { dev: number; ino: number } | null = null;
  readonly databasePath: string;
  private existingInstallation: boolean;
  constructor(private readonly legacyPath: string) {
    this.databasePath = join(dirname(legacyPath), 'library.sqlite');
    this.existingInstallation = existsSync(legacyPath) || existsSync(this.databasePath);
  }
  initializeLanguagePreferences(systemLocales: readonly string[] = []): Promise<LanguageResolution> {
    return this.enqueue(() => {
      // Recheck the legacy file: migration callers may create it after constructing the store.
      const installation = this.existingInstallation || existsSync(this.legacyPath) ? 'existing' : 'new';
      const row = this.database().prepare('SELECT value FROM settings WHERE key=?').get('language-preferences');
      let stored: unknown;
      if (row) { try { stored = parse(row.value); } catch { stored = null; } }
      const result = resolveLanguagePreferences({ installation, systemLocales, stored });
      if (result.status !== 'missing') return result;
      try { this.transaction(() => this.set('language-preferences', result.preferences)); }
      catch { throw new PublicError('language.saveFailed'); }
      return { ...result, status: 'valid' };
    });
  }
  setLanguagePreferences(input: LanguagePreferences): Promise<void> {
    return this.enqueue(() => {
      const preferences = validateLanguagePreferences(input);
      try {
        this.transaction(() => {
          const row = this.database().prepare('SELECT value FROM settings WHERE key=?').get('language-preferences');
          if (row) {
            let stored: unknown;
            try { stored = parse(row.value); } catch { stored = null; }
            if (resolveLanguagePreferences({ installation: 'existing', stored }).status === 'invalid') {
              // Explicit setting changes retain the corrupted original in the same transaction.
              this.database().prepare('INSERT INTO settings VALUES (?,?)').run(`language-preferences.invalid.${randomUUID()}`, String(row.value));
            }
          }
          this.set('language-preferences', preferences);
        });
      } catch { throw new PublicError('language.saveFailed'); }
    });
  }
  private database() { if (!this.db) throw new Error('저장 파일을 먼저 읽어 주세요.'); return this.db; }
  private setting<T>(key: string, fallback: T): T { const row = this.database().prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? parse<T>(row.value) : fallback; }
  private set(key: string, value: unknown) { this.database().prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  private transaction<T>(operation: () => T): T {
    const db = this.database();
    const identity = statSync(this.databasePath);
    if (identity.dev !== this.identity?.dev || identity.ino !== this.identity?.ino) throw new Error('저장소 파일이 이동되거나 교체되었습니다. 앱을 종료하고 백업을 확인하세요.');
    db.exec('BEGIN IMMEDIATE');
    try { const value = operation(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  async load(): Promise<LibraryState> {
    if (this.loaded) return this.snapshot();
    try {
      await mkdir(dirname(this.databasePath), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
      this.identity = statSync(this.databasePath);
      await chmod(this.databasePath, 0o600);
      await this.backupBeforeFolders();
      initializeSchema(this.db); verifyDatabase(this.db);
      if (!this.setting('initialized', false)) await this.migrate();
      this.refresh(); this.loaded = true; return this.snapshot();
    } catch (error) {
      this.close();
      if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
      throw new Error('SQLite 저장소를 열거나 이전하지 못했습니다. 기존 library.json·pdf·백업을 보존하고 저장 권한과 디스크 공간을 확인하세요.');
    }
  }
  private async backupBeforeFolders() {
    const db = this.database(), version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (version !== 1 && version !== 2) return;
    verifyDatabase(db);
    const backup = join(dirname(this.databasePath), `library.pre-folders-v${version}.sqlite`);
    const verify = (path: string) => {
      const copy = new DatabaseSync(path, { readOnly: true });
      try {
        verifyDatabase(copy);
        if (Number(copy.prepare('PRAGMA user_version').get()!.user_version) !== version) throw new Error('이전 백업의 버전이 다릅니다. 기존 백업을 확인하세요.');
      } finally { copy.close(); }
    };
    try { await stat(backup); verify(backup); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${backup}.${randomUUID()}.tmp`;
    try {
      db.prepare('VACUUM INTO ?').run(temporary); await chmod(temporary, 0o600); verify(temporary);
      await link(temporary, backup);
    } finally { await rm(temporary, { force: true }); }
  }
  folders(): LearningFolder[] {
    return this.database().prepare('SELECT id,name,created_at FROM learning_folders ORDER BY rowid').all()
      .map(row => ({ id: String(row.id), name: String(row.name), createdAt: String(row.created_at) }));
  }
  private requireFolder(id: string) {
    validateFolderId(id);
    if (!this.database().prepare('SELECT id FROM learning_folders WHERE id=?').get(id)) throw new PublicError('public.folderMissing');
  }
  private uniqueFolderName(value: string, except?: string): string {
    const name = normalizeFolderName(value);
    if (this.folders().some(folder => folder.id !== except && folderNameKey(folder.name) === folderNameKey(name))) throw new PublicError('public.folderDuplicate');
    return name;
  }
  createFolder(value: string): Promise<LearningFolder> {
    return this.enqueue(() => this.transaction(() => {
      const folder = { id: randomUUID(), name: this.uniqueFolderName(value), createdAt: new Date().toISOString() };
      this.database().prepare('INSERT INTO learning_folders(id,name,created_at) VALUES (?,?,?)').run(folder.id, folder.name, folder.createdAt); return folder;
    }));
  }
  renameFolder(id: string, value: string): Promise<void> {
    return this.enqueue(() => this.transaction(() => { this.requireFolder(id); this.database().prepare('UPDATE learning_folders SET name=? WHERE id=?').run(this.uniqueFolderName(value, id), id); }));
  }
  deleteFolder(id: string): Promise<void> {
    return this.enqueue(() => this.transaction(() => { this.requireFolder(id); this.database().prepare('DELETE FROM learning_folders WHERE id=?').run(id); }));
  }
  moveDocument(documentId: string, folderId: string | null): Promise<void> {
    return this.enqueue(() => this.transaction(() => {
      if (typeof documentId !== 'string' || !this.database().prepare('SELECT id FROM documents WHERE id=?').get(documentId)) throw new Error('자료를 찾을 수 없습니다.');
      if (folderId !== null) this.requireFolder(folderId);
      this.database().prepare('DELETE FROM document_folders WHERE document_id=?').run(documentId);
      if (folderId !== null) this.database().prepare('INSERT INTO document_folders(document_id,folder_id) VALUES (?,?)').run(documentId, folderId);
    }));
  }
  addDocument(document: StudyDocument, folderId: string | null = null): Promise<LibraryState> {
    return this.enqueue(() => {
      this.transaction(() => {
        if (folderId !== null) this.requireFolder(folderId);
        if (this.database().prepare('SELECT id FROM documents WHERE id=?').get(document.id)) throw new Error('이미 저장한 자료입니다.');
        this.writeDocument(document);
        if (folderId !== null) this.database().prepare('INSERT INTO document_folders(document_id,folder_id) VALUES (?,?)').run(document.id, folderId);
        this.set('activeDocumentId', document.id);
      }); this.refresh(); return this.snapshot();
    });
  }
  private scopeClause(value?: LibraryScope): { sql: string; parameters: string[] } {
    const scope = validateScope(value);
    if (scope.kind === 'all') return { sql: '1=1', parameters: [] };
    if (scope.kind === 'unfiled') return { sql: 'NOT EXISTS(SELECT 1 FROM document_folders f WHERE f.document_id=d.id)', parameters: [] };
    this.requireFolder(scope.folderId);
    return { sql: 'EXISTS(SELECT 1 FROM document_folders f WHERE f.document_id=d.id AND f.folder_id=?)', parameters: [scope.folderId] };
  }
  private async migrate() {
    let bytes: Buffer;
    try {
      if ((await stat(this.legacyPath)).size > 300_000_000) throw new Error('이전할 JSON이 너무 큽니다. 기존 파일을 백업한 뒤 확인하세요.');
      bytes = await readFile(this.legacyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.transaction(() => this.set('initialized', true)); return; }
      throw error;
    }
    let legacy: LibraryState;
    try { legacy = validateLibrary(JSON.parse(bytes.toString('utf8'))); }
    catch { throw new Error('기존 저장 파일 검증에 실패해 이전을 중단했습니다. library.json은 변경하지 않았습니다.'); }
    const digest = sourceHash(bytes); const backup = `backups/library-v1-${digest}.json.gz`;
    await mkdir(join(dirname(this.legacyPath), 'backups'), { recursive: true, mode: 0o700 });
    const backupPath = join(dirname(this.legacyPath), backup);
    const temporary = `${backupPath}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(await compress(bytes)); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, backupPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { await rm(temporary, { force: true }); }
    if (!gunzipSync(await readFile(backupPath), { maxOutputLength: 300_000_000 }).equals(bytes)) throw new Error('압축 백업 검증에 실패해 이전을 중단했습니다. 기존 파일은 보존했습니다.');
    let pdfs = 0;
    for (const doc of legacy.documents) if (doc.pdf) {
      const asset = await readFile(join(dirname(this.legacyPath), 'pdf', `${doc.pdf.assetId}.pdf`));
      if (sourceHash(asset) !== doc.pdf.assetId) throw new Error('PDF 원본 해시가 달라 이전을 중단했습니다. 기존 파일은 보존했습니다.');
      pdfs++;
    }
    if (sourceHash(await readFile(this.legacyPath)) !== digest) throw new Error('이전 중 기존 학습 파일이 변경되었습니다. 다른 앱을 종료하고 다시 시작하세요.');
    this.transaction(() => {
      for (const doc of legacy.documents) this.writeDocument(doc, doc.createdAt);
      this.set('activeDocumentId', legacy.activeDocumentId); this.set('selectedModel', legacy.selectedModel);
      if (canonical(this.exportLibrary()) !== canonical(legacy)) throw new Error('이전한 데이터가 원본과 일치하지 않습니다. 이전을 롤백했습니다.');
      verifyDatabase(this.database());
      const report: MigrationReport = { verified: true, documents: legacy.documents.length, units: legacy.documents.reduce((n, d) => n + d.units.length, 0), recalls: legacy.documents.reduce((n, d) => n + Object.keys(d.recalls).length, 0), pdfs, sourceHash: digest, backup, completedAt: new Date().toISOString() };
      this.set('migration', report); this.set('initialized', true);
    });
  }
  private readDocument(id: string): StudyDocument {
    const db = this.database(); const row = db.prepare('SELECT * FROM documents WHERE id=?').get(id);
    if (!row) throw new Error('자료를 찾을 수 없습니다.');
    if (row.archived_at !== null) {
      try {
        const json = unpack(row.archive_payload);
        if (sourceHash(json) !== row.archive_hash) throw new Error();
        const doc = validateDocument(JSON.parse(json));
        if (doc.id !== id || documentHash(doc.source, doc.pdf) !== row.source_hash) throw new Error();
        return doc;
      } catch { throw new Error('압축 보관 자료가 손상되었거나 검증에 실패했습니다. 압축 원본은 보존했습니다.'); }
    }
    const metadata = parse<Omit<StudyDocument, 'source' | 'units' | 'guides' | 'recalls'>>(row.metadata);
    const source = String(row.source);
    if (documentHash(source, metadata.pdf) !== row.source_hash) throw new Error('저장된 원문 해시가 달라 읽기를 중단했습니다. 백업을 확인하세요.');
    const units = db.prepare('SELECT * FROM chunks WHERE document_id=? ORDER BY position').all(id).map(c => ({ id: String(c.unit_id), start: Number(c.start), end: Number(c.end), text: source.slice(Number(c.start), Number(c.end)), section: String(c.section) }));
    const guides = Object.fromEntries(db.prepare('SELECT * FROM guides WHERE document_id=?').all(id).map(g => {
      if (g.source_hash !== row.source_hash) throw new Error('안내의 근거 버전이 원문과 다릅니다.');
      return [String(g.unit_id), parse(g.value)];
    }));
    const recalls = Object.fromEntries(db.prepare('SELECT * FROM recalls WHERE document_id=?').all(id).map(r => [String(r.unit_id), parse(r.value)]));
    return validateDocument({ ...metadata, source, units, guides, recalls });
  }
  private readSource(id: string): Pick<StudyDocument, 'id' | 'title' | 'source' | 'pdf'> {
    const row = this.database().prepare('SELECT source,source_hash,metadata,archived_at FROM documents WHERE id=?').get(id);
    if (!row) throw new Error('자료를 찾을 수 없습니다.');
    if (row.archived_at !== null) { const doc = this.readDocument(id); return { id: doc.id, title: doc.title, source: doc.source, ...(doc.pdf ? { pdf: doc.pdf } : {}) }; }
    const source = String(row.source); const metadata = parse<StudyDocument>(row.metadata);
    if (metadata.id !== id || documentHash(source, metadata.pdf) !== row.source_hash) throw new Error('저장된 원문이 변경되었습니다. 백업을 확인하세요.');
    return { id, title: metadata.title, source, ...(metadata.pdf ? { pdf: validatePdf(metadata.pdf, source) } : {}) };
  }
  private writeDocument(doc: StudyDocument, usedAt = new Date().toISOString(), restoring = false) {
    validateDocument(doc);
    const db = this.database(); const existing = db.prepare('SELECT * FROM documents WHERE id=?').get(doc.id);
    if (existing?.archived_at && !restoring) throw new Error('보관한 자료를 먼저 복원하세요.');
    const { source, units, guides, recalls, ...metadata } = doc;
    const digest = documentHash(source, doc.pdf); const ordinal = existing?.ordinal ?? db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 n FROM documents').get()!.n;
    if (existing && existing.source_hash !== digest) throw new Error('저장한 원문·PDF는 변경할 수 없습니다. 새 문서로 가져오세요.');
    if (existing && !restoring && doc.pdf) {
      const previous = parse<StudyDocument>(existing.metadata);
      const saved = db.prepare('SELECT value FROM study_sessions WHERE document_id=?').get(doc.id);
      if (saved) {
        const session = validateStudySession(parse(saved.value), doc, digest);
        const unit = units.find(value => value.id === session.unitId)!;
        const page = unitPage(doc, unit)?.page;
        if (page && previous.pdf?.pages[page - 1]?.note !== doc.pdf.pages[page - 1]?.note) {
          const { guide: _guide, guideModel: _model, guideStyle: _style, guideRevision: _revision, answerFeedback: _feedback, ...remaining } = session;
          db.prepare('UPDATE study_sessions SET value=? WHERE document_id=?').run(JSON.stringify({ ...remaining, updatedAt: new Date().toISOString() }), doc.id);
        }
      }
    }
    db.prepare(`INSERT INTO documents VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,metadata=excluded.metadata,source=excluded.source,source_hash=excluded.source_hash,last_used_at=excluded.last_used_at,archived_at=NULL,archive_payload=NULL,archive_hash=NULL,unit_count=excluded.unit_count,read_count=excluded.read_count,recall_count=excluded.recall_count`).run(doc.id, doc.title, JSON.stringify(metadata), source, digest, Number(ordinal), usedAt, units.length, doc.readUnitIds.length, Object.values(recalls).filter(r => r.answer.trim()).length);
    if (!existing || existing.source_hash !== digest || existing.title !== doc.title) {
      db.prepare('DELETE FROM chunks WHERE document_id=?').run(doc.id);
      const insert = db.prepare('INSERT INTO chunks(document_id,unit_id,position,start,end,section,page) VALUES (?,?,?,?,?,?,?)');
      const index = db.prepare('INSERT INTO source_search(rowid,text) VALUES (?,?)');
      const shortIndex = db.prepare('INSERT INTO source_short_search(rowid,text) VALUES (?,?)');
      units.forEach((unit, position) => {
        const row = insert.run(doc.id, unit.id, position, unit.start, unit.end, unit.section, unitPage(doc, unit)?.page ?? null);
        const text = `${doc.title}\n${unit.text}`.normalize('NFKC').toLowerCase(); index.run(row.lastInsertRowid, text);
        const tokens = new Set<string>();
        for (const word of text.match(/[\p{L}\p{N}]+/gu) ?? []) {
          const chars = [...word]; chars.forEach((char, i) => { tokens.add(char); if (chars[i + 1]) tokens.add(char + chars[i + 1]); });
        }
        shortIndex.run(row.lastInsertRowid, [...tokens].map(shortToken).join(' '));
      });
    }
    const oldRecalls = new Map(db.prepare('SELECT unit_id,value FROM recalls WHERE document_id=?').all(doc.id).map(r => [String(r.unit_id), parse<RecallRecord>(r.value)]));
    db.prepare('DELETE FROM guides WHERE document_id=?').run(doc.id);
    for (const [unitId, guide] of Object.entries(guides)) db.prepare('INSERT INTO guides VALUES (?,?,?,?)').run(doc.id, unitId, JSON.stringify(guide), digest);
    db.prepare('DELETE FROM recalls WHERE document_id=?').run(doc.id);
    for (const [unitId, record] of Object.entries(recalls)) {
      db.prepare('INSERT INTO recalls VALUES (?,?,?,?)').run(doc.id, unitId, JSON.stringify(record), record.reviewAt ?? null);
      if (restoring) continue;
      const previous = oldRecalls.get(unitId);
      if (!previous || previous.answer !== record.answer || previous.savedAt !== record.savedAt) db.prepare('INSERT INTO recall_attempts(document_id,unit_id,saved_at,value) VALUES (?,?,?,?)').run(doc.id, unitId, record.savedAt, gzipSync(JSON.stringify(record)));
      else if (!(previous.feedback && !record.feedback) && !(previous.rating && !record.rating)) db.prepare('UPDATE recall_attempts SET value=? WHERE id=(SELECT MAX(id) FROM recall_attempts WHERE document_id=? AND unit_id=?)').run(gzipSync(JSON.stringify(record)), doc.id, unitId);
    }
  }
  private refresh() {
    let id = this.setting<string | null>('activeDocumentId', null);
    if (id && !this.database().prepare('SELECT id FROM documents WHERE id=? AND archived_at IS NULL').get(id)) id = null;
    this.state = { ...emptyLibrary(), selectedModel: this.setting('selectedModel', null), activeDocumentId: id, documents: id ? [this.readDocument(id)] : [] };
  }
  snapshot(): LibraryState { return structuredClone(this.state); }
  exportLibrary(): LibraryState {
    return { ...emptyLibrary(), activeDocumentId: this.setting('activeDocumentId', null), selectedModel: this.setting('selectedModel', null), documents: this.database().prepare('SELECT id FROM documents ORDER BY ordinal').all().map(r => this.readDocument(String(r.id))) };
  }
  update(reduce: (state: LibraryState) => LibraryState): Promise<LibraryState> {
    return this.enqueue(() => {
      if (!this.loaded) throw new Error('저장 파일을 먼저 읽어 주세요.');
      const before = this.snapshot(); const next = validateLibrary(reduce(this.snapshot()));
      try {
        this.transaction(() => {
          const deleted = before.documents.filter(doc => !next.documents.some(d => d.id === doc.id));
          for (const doc of deleted) this.database().prepare('DELETE FROM documents WHERE id=?').run(doc.id);
          for (const doc of next.documents) if (canonical(doc) !== canonical(before.documents.find(d => d.id === doc.id))) this.writeDocument(doc);
          const active = next.activeDocumentId ?? (deleted.length ? this.database().prepare('SELECT id FROM documents WHERE archived_at IS NULL ORDER BY ordinal LIMIT 1').get()?.id ?? null : null);
          this.set('activeDocumentId', active); this.set('selectedModel', next.selectedModel);
        });
        this.refresh(); return this.snapshot();
      } catch (error) {
        if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
        throw new Error('학습 기록을 저장하지 못했습니다. 저장 권한과 디스크 여유 공간을 확인하세요. 이전 기록은 유지했습니다.');
      }
    });
  }
  select(id: string): Promise<LibraryState> {
    return this.enqueue(() => {
      const row = this.database().prepare('SELECT archived_at FROM documents WHERE id=?').get(id);
      if (!row) throw new Error('자료를 찾을 수 없습니다.'); if (row.archived_at) throw new Error('압축 보관한 자료입니다. 먼저 복원하세요.');
      this.readDocument(id);
      this.transaction(() => { this.set('activeDocumentId', id); this.database().prepare('UPDATE documents SET last_used_at=? WHERE id=?').run(new Date().toISOString(), id); });
      this.refresh(); return this.snapshot();
    });
  }
  catalog(): DocumentSummary[] { return this.database().prepare('SELECT d.id,d.title,d.unit_count,d.read_count,d.recall_count,d.archived_at,d.last_used_at,f.folder_id FROM documents d LEFT JOIN document_folders f ON f.document_id=d.id ORDER BY d.ordinal DESC').all().map(r => ({ id: String(r.id), folderId: r.folder_id === null ? null : String(r.folder_id), title: String(r.title), unitCount: Number(r.unit_count), readCount: Number(r.read_count), recallCount: Number(r.recall_count), archived: r.archived_at !== null, lastUsedAt: String(r.last_used_at) })); }
  due(now = new Date().toISOString()): DueReview[] { return this.database().prepare(`SELECT r.document_id,r.unit_id,r.review_at,c.position FROM recalls r JOIN documents d ON d.id=r.document_id JOIN chunks c ON c.document_id=r.document_id AND c.unit_id=r.unit_id WHERE d.archived_at IS NULL AND julianday(r.review_at)<=julianday(?) ORDER BY julianday(r.review_at),r.document_id,c.position`).all(now).map(r => ({ documentId: String(r.document_id), unitId: String(r.unit_id), position: Number(r.position), reviewAt: String(r.review_at) })); }
  history(documentId: string, unitId: string): RecallRecord[] { return this.database().prepare('SELECT value FROM recall_attempts WHERE document_id=? AND unit_id=? ORDER BY id').all(documentId, unitId).map(r => JSON.parse(unpack(r.value))); }
  storageInfo(): StorageInfo { const counts = this.database().prepare('SELECT COUNT(*) total,SUM(archived_at IS NOT NULL) archived FROM documents').get()!; return { autoArchive: this.setting('autoArchive', false), activeCount: Number(counts.total) - Number(counts.archived ?? 0), archivedCount: Number(counts.archived ?? 0), migration: this.setting('migration', null) }; }
  search(query: string, scope?: LibraryScope): SearchHit[] {
    const filter = this.scopeClause(scope);
    if (typeof query !== 'string' || query.length > 200) throw new Error('검색어는 200자 이내로 입력하세요.');
    const terms = query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? []; if (!terms.length) return [];
    const long = terms.filter(t => [...t].length >= 3), short = terms.filter(t => [...t].length < 3);
    const joins = `${long.length ? 'JOIN source_search ON source_search.rowid=c.id' : ''} ${short.length ? 'JOIN source_short_search ON source_short_search.rowid=c.id' : ''}`;
    const clauses = [...(long.length ? ['source_search MATCH ?'] : []), ...(short.length ? ['source_short_search MATCH ?'] : [])];
    const parameters = [...(long.length ? [long.map(word => `"${word}"`).join(' AND ')] : []), ...(short.length ? [short.map(word => `"${shortToken(word)}"`).join(' AND ')] : [])];
    const rows: Row[] = this.database().prepare(`SELECT c.*,d.title,d.archived_at,d.source_hash FROM chunks c JOIN documents d ON d.id=c.document_id ${joins} WHERE ${clauses.join(' AND ')} AND ${filter.sql} ORDER BY ${long.length ? 'bm25(source_search),' : ''}d.ordinal DESC,c.position LIMIT 20`).all(...parameters, ...filter.parameters);
    const docs = new Map<string, ReturnType<LibraryStore['readSource']>>(); const results: SearchHit[] = [];
    for (const r of rows) {
      const id = String(r.document_id); let doc = docs.get(id); if (!doc) { doc = this.readSource(id); docs.set(id, doc); }
      if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || Number(r.start) < 0 || Number(r.end) <= Number(r.start) || Number(r.end) > doc.source.length) throw new Error('검색 구간 위치가 원문과 다릅니다.');
      const text = doc.source.slice(Number(r.start), Number(r.end)); const haystack = `${doc.title}\n${text}`.normalize('NFKC').toLowerCase();
      if (!terms.every(t => haystack.includes(t))) continue;
      const index = Math.max(0, text.normalize('NFKC').toLowerCase().indexOf(terms[0]!) - 45);
      const page = doc.pdf?.pages.find(page => Number(r.start) >= page.start && Number(r.end) <= page.end)?.page;
      results.push({ documentId: id, unitId: String(r.unit_id), title: doc.title, section: String(r.section), start: Number(r.start), end: Number(r.end), sourceHash: String(r.source_hash), excerpt: text.slice(index, index + 220), archived: r.archived_at !== null, ...(page ? { page } : {}) });
      if (results.length >= 20) break;
    }
    return results;
  }
  evidence(reference: EvidenceReference, maxCharacters = 1800): SourceEvidence {
    if (!reference || typeof reference.documentId !== 'string' || typeof reference.unitId !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sourceHash)) throw new Error('근거 참조가 잘못되었습니다.');
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 6000) throw new Error('근거 문자 한도가 잘못되었습니다.');
    const row = this.database().prepare('SELECT source_hash FROM documents WHERE id=?').get(reference.documentId);
    if (!row || row.source_hash !== reference.sourceHash) throw new Error('자료가 삭제되었거나 변경되었습니다. 다시 검색하세요.');
    const doc = this.readSource(reference.documentId);
    const unit = this.database().prepare('SELECT start,end FROM chunks WHERE document_id=? AND unit_id=?').get(reference.documentId, reference.unitId);
    if (!unit || Number(unit.start) < 0 || Number(unit.end) > doc.source.length || Number(unit.end) <= Number(unit.start)) throw new Error('원문 구간을 찾을 수 없습니다.');
    const page = doc.pdf?.pages.find(page => Number(unit.start) >= page.start && Number(unit.end) <= page.end)?.page;
    const original = doc.source.slice(Number(unit.start), Number(unit.end));
    let text = original.slice(0, maxCharacters); if (/[\uD800-\uDBFF]/.test(text.at(-1) ?? '')) text = text.slice(0, -1);
    return { documentId: reference.documentId, unitId: reference.unitId, sourceHash: reference.sourceHash, text, truncated: text.length < original.length, ...(page ? { page } : {}) };
  }
  evidenceContext(references: EvidenceReference[], maxCharacters = 6000): SourceEvidence[] {
    if (!Array.isArray(references) || references.length > 12 || !Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 12_000) throw new Error('근거 개수와 문자 한도를 확인하세요.');
    const used = new Set<string>(); const result: SourceEvidence[] = []; let remaining = maxCharacters;
    for (const reference of references) {
      const key = `${reference.documentId}:${reference.unitId}`; if (used.has(key)) continue;
      if (!remaining) break; const evidence = this.evidence(reference, Math.min(1800, remaining));
      remaining -= evidence.text.length; used.add(key); result.push(evidence);
    } return result;
  }
  sourceReference(documentId: string, unitId: string): EvidenceReference {
    if (typeof documentId !== 'string' || typeof unitId !== 'string') throw new Error('자료와 읽기 단위를 확인하세요.');
    const row = this.database().prepare('SELECT d.source_hash FROM documents d JOIN chunks c ON c.document_id=d.id WHERE d.id=? AND c.unit_id=?').get(documentId, unitId);
    if (!row) throw new Error('자료의 원문 구간을 찾을 수 없습니다.');
    return { documentId, unitId, sourceHash: String(row.source_hash) };
  }
  private readStudySession(document: StudyDocument): StudySession | null {
    const row = this.database().prepare('SELECT value FROM study_sessions WHERE document_id=?').get(document.id);
    if (!row) return null;
    return validateStudySession(parse(row.value), document, this.sourceReference(document.id, document.units[0]!.id).sourceHash);
  }
  studyWorkspace(documentId: string): StudyWorkspace {
    const document = this.readDocument(documentId), source = this.sourceReference(documentId, document.units[0]!.id);
    const session = this.readStudySession(document);
    const notes = this.database().prepare('SELECT value FROM study_notes WHERE document_id=? ORDER BY updated_at DESC,id LIMIT 100').all(documentId)
      .map(row => validateStudyNote(parse(row.value), document, source.sourceHash));
    return { session, notes };
  }
  updateStudySession(documentId: string, reduce: (session: StudySession | null, document: StudyDocument, reference: EvidenceReference) => StudySession): Promise<StudySession> {
    return this.enqueue(() => {
      try {
        return this.transaction(() => {
          const document = this.readDocument(documentId);
          if (this.database().prepare('SELECT archived_at FROM documents WHERE id=?').get(documentId)!.archived_at !== null) throw new Error('보관한 자료를 먼저 복원하세요.');
          const session = this.readStudySession(document);
          const reference = this.sourceReference(documentId, session?.unitId ?? document.units[document.position]!.id);
          const next = validateStudySession(reduce(session, document, reference), document, reference.sourceHash);
          this.database().prepare('INSERT INTO study_sessions(document_id,value) VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET value=excluded.value').run(documentId, JSON.stringify(next));
          this.database().prepare('UPDATE documents SET last_used_at=? WHERE id=?').run(new Date().toISOString(), documentId);
          return next;
        });
      } catch (error) {
        if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
        throw new Error('학습 세션을 저장하지 못했습니다. 저장 권한과 디스크 여유 공간을 확인하세요. 이전 기록은 유지했습니다.');
      }
    });
  }
  saveStudyNote(documentId: string): Promise<StudyNote> {
    return this.enqueue(() => {
      try {
        return this.transaction(() => {
          const document = this.readDocument(documentId);
          if (this.database().prepare('SELECT archived_at FROM documents WHERE id=?').get(documentId)!.archived_at !== null) throw new Error('보관한 자료를 먼저 복원하세요.');
          const session = this.readStudySession(document);
          if (!session) throw new Error('먼저 학습을 시작해 주세요.');
          const note = createStudyNote(document, session);
          const existing = this.database().prepare('SELECT value FROM study_notes WHERE id=?').get(note.id);
          if (existing) note.createdAt = validateStudyNote(parse(existing.value), document, session.sourceHash).createdAt;
          const searchText = [note.title, note.summary, note.sourceExcerpt, note.question, note.userAnswer, ...note.unresolved,
            ...(note.answerFeedback ? [note.answerFeedback.result.assessment, ...note.answerFeedback.result.missingPoints, note.answerFeedback.result.nextStep] : []),
            ...(note.relearning ?? []).flatMap(attempt => [attempt.question, attempt.answer]),
            ...note.terms.flatMap(term => [term.term, term.explanation, term.quote ?? '', term.sourceTitle ?? ''])].join('\n').normalize('NFKC').toLowerCase();
          this.database().prepare(`INSERT INTO study_notes(id,document_id,source_hash,value,search_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET value=excluded.value,search_text=excluded.search_text,updated_at=excluded.updated_at`)
            .run(note.id, documentId, note.source.sourceHash, JSON.stringify(note), searchText, note.createdAt, note.updatedAt);
          const completed = validateStudySession({ ...session, step: 'done', updatedAt: note.updatedAt }, document, note.source.sourceHash);
          this.database().prepare('UPDATE study_sessions SET value=? WHERE document_id=?').run(JSON.stringify(completed), documentId);
          this.database().prepare('UPDATE documents SET last_used_at=? WHERE id=?').run(note.updatedAt, documentId);
          return note;
        });
      } catch (error) {
        if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
        throw new Error('학습 노트를 저장하지 못했습니다. 저장 권한과 디스크 여유 공간을 확인하세요. 이전 기록은 유지했습니다.');
      }
    });
  }
  searchStudyNotes(query: string, scope?: LibraryScope): StudyNote[] {
    const filter = this.scopeClause(scope);
    if (typeof query !== 'string' || query.length > 200) throw new Error('검색어는 200자 이내로 입력하세요.');
    const needle = query.trim().normalize('NFKC').toLowerCase();
    if (!needle) return [];
    const rows = this.database().prepare(`SELECT n.value FROM study_notes n JOIN documents d ON d.id=n.document_id AND d.source_hash=n.source_hash
      WHERE instr(n.search_text,?)>0 AND ${filter.sql} ORDER BY n.updated_at DESC,n.id LIMIT 20`).all(needle, ...filter.parameters);
    return rows.map(row => validateStudyNote(parse(row.value)));
  }
  async archive(id: string, automaticBefore?: string): Promise<boolean> {
    return this.enqueue(async () => {
      const row = this.database().prepare('SELECT archived_at,last_used_at FROM documents WHERE id=?').get(id);
      if (!row) throw new Error('자료를 찾을 수 없습니다.'); if (row.archived_at !== null) return false;
      if (automaticBefore && (!this.setting('autoArchive', false) || this.state.activeDocumentId === id || Date.parse(String(row.last_used_at)) >= Date.parse(automaticBefore) || this.database().prepare('SELECT 1 FROM recalls WHERE document_id=? AND review_at IS NOT NULL LIMIT 1').get(id) || this.database().prepare("SELECT 1 FROM study_sessions WHERE document_id=? AND json_extract(value,'$.step')<>'done'").get(id))) return false;
      const doc = this.readDocument(id);
      const json = JSON.stringify(doc); const compressed = await compress(json);
      if (unpack(compressed) !== json) throw new Error('압축 검증에 실패했습니다. 원문은 유지했습니다.');
      this.transaction(() => {
        this.database().prepare("UPDATE documents SET source=NULL,metadata='{}',archived_at=?,archive_payload=?,archive_hash=? WHERE id=?").run(new Date().toISOString(), compressed, sourceHash(json), id);
        this.database().prepare('DELETE FROM guides WHERE document_id=?').run(id); this.database().prepare('DELETE FROM recalls WHERE document_id=?').run(id);
        if (this.state.activeDocumentId === id) this.set('activeDocumentId', null);
      }); this.refresh(); return true;
    });
  }
  restore(id: string): Promise<void> { return this.enqueue(() => { const row = this.database().prepare('SELECT archived_at FROM documents WHERE id=?').get(id); if (!row) throw new Error('자료를 찾을 수 없습니다.'); if (row.archived_at === null) return; const doc = this.readDocument(id); this.transaction(() => this.writeDocument(doc, new Date().toISOString(), true)); this.refresh(); }); }
  setAutoArchive(enabled: boolean): Promise<void> { return this.enqueue(() => { if (typeof enabled !== 'boolean') throw new Error('자동 보관 설정이 잘못되었습니다.'); this.transaction(() => this.set('autoArchive', enabled)); }); }
  async maintain(now = new Date().toISOString()): Promise<number> {
    if (!this.loaded || !this.setting('autoArchive', false)) return 0;
    const threshold = new Date(Date.parse(now) - 90 * 86_400_000).toISOString();
    const candidates = this.database().prepare(`SELECT id FROM documents d WHERE archived_at IS NULL AND id<>? AND julianday(last_used_at)<julianday(?) AND NOT EXISTS(SELECT 1 FROM recalls r WHERE r.document_id=d.id AND r.review_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM study_sessions s WHERE s.document_id=d.id AND json_extract(s.value,'$.step')<>'done') ORDER BY last_used_at LIMIT 3`).all(this.state.activeDocumentId ?? '', threshold);
    let count = 0; for (const row of candidates) if (await this.archive(String(row.id), threshold)) count++; return count;
  }
  compact(): Promise<void> { return this.enqueue(() => { verifyDatabase(this.database()); this.database().exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(512); PRAGMA optimize;'); }); }
  close() { this.loaded = false; this.db?.close(); this.db = null; }
}
