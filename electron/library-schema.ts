import type { DatabaseSync } from 'node:sqlite';

export function initializeSchema(db: DatabaseSync) {
  let version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (![0, 1, 2, 3].includes(version)) throw new Error('더 최신 버전의 저장소입니다. 앱을 업데이트하세요.');
  if (version === 0) {
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new Error('지원하지 않는 SQLite 저장소입니다. 기존 파일은 보존했습니다.');
    db.exec(`PRAGMA auto_vacuum=INCREMENTAL;
      BEGIN IMMEDIATE;
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, metadata TEXT NOT NULL, source TEXT,
        source_hash TEXT NOT NULL, ordinal INTEGER NOT NULL, last_used_at TEXT NOT NULL,
        archived_at TEXT, archive_payload BLOB, archive_hash TEXT,
        unit_count INTEGER NOT NULL, read_count INTEGER NOT NULL, recall_count INTEGER NOT NULL,
        CHECK ((archived_at IS NULL AND source IS NOT NULL AND archive_payload IS NULL) OR
               (archived_at IS NOT NULL AND source IS NULL AND archive_payload IS NOT NULL))
      );
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL, position INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
        section TEXT NOT NULL, page INTEGER, UNIQUE(document_id,unit_id)
      );
      CREATE VIRTUAL TABLE source_search USING fts5(text, content='', contentless_delete=1, tokenize='trigram case_sensitive 1');
      CREATE VIRTUAL TABLE source_short_search USING fts5(text, content='', contentless_delete=1, tokenize='unicode61');
      CREATE TRIGGER chunks_delete AFTER DELETE ON chunks BEGIN
        DELETE FROM source_search WHERE rowid=old.id;
        DELETE FROM source_short_search WHERE rowid=old.id;
      END;
      CREATE TABLE guides (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL, value TEXT NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY(document_id,unit_id));
      CREATE TABLE recalls (document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL, value TEXT NOT NULL, review_at TEXT, PRIMARY KEY(document_id,unit_id));
      CREATE INDEX recalls_due ON recalls(review_at) WHERE review_at IS NOT NULL;
      CREATE TABLE recall_attempts (id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        unit_id TEXT NOT NULL, saved_at TEXT NOT NULL, value BLOB NOT NULL);
      CREATE INDEX attempts_unit ON recall_attempts(document_id,unit_id,id);
      PRAGMA user_version=1;
      COMMIT;`);
  }
  if (version === 0) version = 1;
  if (version === 1 || version === 2) {
    try {
      db.exec('BEGIN IMMEDIATE;');
      if (version === 1) db.exec(`
        CREATE TABLE study_sessions (document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, value TEXT NOT NULL);
        CREATE TABLE study_notes (
          id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          source_hash TEXT NOT NULL, value TEXT NOT NULL, search_text TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX study_notes_document ON study_notes(document_id, updated_at DESC);`);
      db.exec(`
        CREATE TABLE learning_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
        CREATE TABLE document_folders (
          document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
          folder_id TEXT NOT NULL REFERENCES learning_folders(id) ON DELETE CASCADE
        );
        CREATE INDEX document_folders_folder ON document_folders(folder_id);
        PRAGMA user_version=3;
        COMMIT;`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
}
export function verifyDatabase(db: DatabaseSync) {
  if (db.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('저장소 무결성 검사에 실패했습니다. 백업을 보존하고 복구하세요.');
}
