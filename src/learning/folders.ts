import type { LibraryScope } from '../shared/types.js';

export function normalizeFolderName(value: string): string {
  if (typeof value !== 'string') throw new Error('폴더 이름을 입력하세요.');
  const name = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!name || name.length > 50 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('폴더 이름은 1~50자로 입력하세요.');
  return name;
}
export const folderNameKey = (value: string) => normalizeFolderName(value).toLowerCase();
export function validateFolderId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('폴더 ID가 잘못되었습니다.');
  return value;
}
export function validateScope(value: LibraryScope = { kind: 'all' }): LibraryScope {
  if (value?.kind === 'all' || value?.kind === 'unfiled') return { kind: value.kind };
  if (value?.kind === 'folder') return { kind: 'folder', folderId: validateFolderId(value.folderId) };
  throw new Error('검색 범위가 잘못되었습니다.');
}
export function inScope(folderId: string | null | undefined, scope: LibraryScope): boolean {
  return scope.kind === 'all' || (scope.kind === 'unfiled' ? !folderId : folderId === scope.folderId);
}
