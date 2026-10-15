// Run after npm run build. Does not access authentication files or call AI.
import { LibraryStore, canonical, sourceHash } from '../dist-electron/electron/library.js';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, stat, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
const args = process.argv.slice(2);
const path = args[args.indexOf('--data-dir') + 1];
if (!args.includes('--data-dir') || !path || !isAbsolute(path)) throw new Error('--data-dir에 절대 경로를 지정하세요. 기본은 임시 복사본 검증이며 --migrate가 있을 때만 실제 이전합니다.');
const execute = args.includes('--migrate');
const bytes = await readFile(join(path, 'library.json'));
const original = JSON.parse(bytes.toString());
const root = execute ? path : await mkdtemp(join(tmpdir(), 'swallow-migration-proof-'));
let store;
try {
  if (!execute) {
    await writeFile(join(root, 'library.json'), bytes, { mode: 0o600 });
    await mkdir(join(root, 'pdf'), { mode: 0o700 });
    for (const doc of original.documents) if (doc.pdf) await copyFile(join(path, 'pdf', `${doc.pdf.assetId}.pdf`), join(root, 'pdf', `${doc.pdf.assetId}.pdf`));
  }
  store = new LibraryStore(join(root, 'library.json')); await store.load();
  const result = store.exportLibrary();
  const report = store.storageInfo().migration;
  if (!report?.verified || canonical(result) !== canonical(original)) throw new Error('이전 결과가 기존 JSON과 일치하지 않습니다. 실제 앱에서 저장한 뒤에는 이 스크립트를 재사용하지 마세요.');
  if (sourceHash(await readFile(join(root, 'library.json'))) !== sourceHash(bytes)) throw new Error('기존 JSON이 변경되었습니다.');
  if (!gunzipSync(await readFile(join(root, report.backup))).equals(bytes)) throw new Error('이전 백업 검증 실패');
  for (const doc of result.documents) if (doc.pdf && sourceHash(await readFile(join(root, 'pdf', `${doc.pdf.assetId}.pdf`))) !== doc.pdf.assetId) throw new Error('PDF 해시 검증 실패');
  const databasePath = store.databasePath; store.close();
  console.log(JSON.stringify({ mode: execute ? 'migrated' : 'verified-copy', verified: true, documents: report.documents, units: report.units, recalls: report.recalls, pdfs: report.pdfs, jsonUnchanged: true, backupVerified: true, pdfHashesVerified: true, databaseBytes: (await stat(databasePath)).size }, null, 2));
} finally { store?.close(); if (!execute) await rm(root, { recursive: true, force: true }); }
