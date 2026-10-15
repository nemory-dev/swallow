import { useLanguage } from './LanguageContext.js';
import { useEffect, useRef, useState } from 'react';
import type { DocumentSummary, LearningFolder, LibraryScope } from '../shared/types.js';
import { inScope } from '../learning/folders.js';

export function FolderNavigation({ folders, documents, scope, select, pending, error, editingChanged, create, rename, remove }: {
  folders: LearningFolder[]; documents: DocumentSummary[]; scope: LibraryScope; pending: boolean; error: string | null;
  select: (scope: LibraryScope) => void; editingChanged: (editing: boolean) => void;
  create: (name: string) => Promise<boolean>; rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => void;
}) {
  const { t, formatNumber, localizeText } = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => { editingChanged(editing !== null); return () => editingChanged(false); }, [editing, editingChanged]);
  useEffect(() => { if (editing) { dialog.current?.showModal(); input.current?.focus(); } }, [editing?.id]);
  const count = (value: LibraryScope) => documents.filter(doc => !doc.archived && inScope(doc.folderId, value)).length;
  const title = editing?.id ? t('folder.rename') : t('folder.new');
  return <section className="folder-navigation" aria-label={t('folder.heading')}>
    <nav aria-label={t('folder.scope')}>
      {([{ kind: 'all' }, { kind: 'unfiled' }] as const).map(value => <button key={value.kind} className={`folder-item ${scope.kind === value.kind ? 'selected' : ''}`} aria-label={value.kind === 'all' ? t('folder.all') : t('folder.unfiled')} aria-pressed={scope.kind === value.kind} disabled={pending} onClick={() => select(value)}><span>{value.kind === 'all' ? t('folder.all') : t('folder.unfiled')}</span><span>{formatNumber(count(value))}</span></button>)}
    </nav>
    <div className="folder-heading"><button className="text-button" aria-label={collapsed ? t('folder.expand') : t('folder.collapse')} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? '▸' : '▾'} {t('folder.heading')}</button><button className="icon-button" aria-label={t('folder.new')} title={t('folder.new')} disabled={pending} onClick={() => { setMenu(null); setEditing({ id: null, name: '' }); }}>＋</button></div>
    {!collapsed && <nav aria-label={t('folder.list')}>{folders.map(folder => <div className="folder-row" key={folder.id}>
      <div className="folder-row-main"><button className={`folder-item ${scope.kind === 'folder' && scope.folderId === folder.id ? 'selected' : ''}`} aria-label={folder.name} aria-pressed={scope.kind === 'folder' && scope.folderId === folder.id} disabled={pending} onClick={() => select({ kind: 'folder', folderId: folder.id })}><span title={folder.name}>⌑ {folder.name}</span><span>{formatNumber(count({ kind: 'folder', folderId: folder.id }))}</span></button><button className="folder-menu-toggle" aria-label={t('folder.manage', { name: folder.name })} aria-expanded={menu === folder.id} disabled={pending} onClick={() => setMenu(menu === folder.id ? null : folder.id)}>⋯</button></div>
      {menu === folder.id && <div className="folder-actions"><button className="text-button" disabled={pending} onClick={() => { setMenu(null); setEditing({ id: folder.id, name: folder.name }); }}>{t('folder.renameAction')}</button><button className="text-button" disabled={pending} onClick={() => { if (window.confirm(t('folder.deleteConfirm', { name: folder.name }))) { setMenu(null); remove(folder.id); } }}>{t('folder.delete')}</button></div>}
    </div>)}{folders.length === 0 && <p className="folder-hint">{t('folder.empty')}</p>}</nav>}
    {editing && <dialog ref={dialog} className="folder-dialog" aria-label={title} onCancel={event => { if (pending) event.preventDefault(); else setEditing(null); }}><form onSubmit={event => { event.preventDefault(); if (pending) return; void (async () => { const success = editing.id ? await rename(editing.id, editing.name) : await create(editing.name); if (success) setEditing(null); })(); }}>
      <div className="panel-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label={t('folder.closeEdit')} disabled={pending} onClick={() => setEditing(null)}>×</button></div>
      <label className="field-label">{t('folder.name')}<input ref={input} value={editing.name} maxLength={50} required disabled={pending} onChange={event => setEditing({ ...editing, name: event.target.value })} placeholder={t('folder.namePlaceholder')} /></label>
      {error && <p className="inline-error" role="alert">{localizeText(error)}</p>}
      <div className="folder-dialog-footer"><button type="button" className="secondary-button" disabled={pending} onClick={() => setEditing(null)}>{t('common.cancel')}</button><button className="primary-button" disabled={pending || !editing.name.trim()}>{editing.id ? t('common.save') : t('common.create')}</button></div>
    </form></dialog>}
  </section>;
}

export function DocumentFolderMenu({ document, folders, pending, move }: {
  document: DocumentSummary; folders: LearningFolder[]; pending: boolean; move: (id: string, folderId: string | null) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  return <div className="document-folder-menu"><button className="folder-menu-toggle" aria-label={t('document.menu', { title: document.title })} aria-expanded={open} disabled={pending} onClick={() => setOpen(!open)}>⋯</button>
    {open && <label className="document-folder-select">{t('folder.move')}<select aria-label={t('document.moveToFolder', { title: document.title })} value={document.folderId ?? ''} disabled={pending} onChange={event => move(document.id, event.target.value || null)}><option value="">{t('folder.unfiled')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
  </div>;
}
