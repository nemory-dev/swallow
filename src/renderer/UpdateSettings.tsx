import { useLanguage } from './LanguageContext.js';
import { useEffect, useRef, useState } from 'react';
import type { SwallowBridge, UpdateState } from '../shared/types.js';

export function UpdateSettings({ bridge, blocked, install }: { bridge: SwallowBridge; blocked: boolean; install: () => Promise<void> }) {
  const { t, formatDate, errorText, localizeText } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const message = (cause: unknown) => errorText(cause, 'errors.updateState');
  useEffect(() => {
    let current = true, received = false;
    const unsubscribe = bridge.onUpdateState(value => { received = true; if (current) { setState(value); setError(null); } });
    void bridge.getUpdateState().then(value => { if (current && !received) setState(value); }).catch(cause => { if (current && !received) setError(message(cause)); });
    return () => { current = false; unsubscribe(); };
  }, [bridge]);
  async function run(operation: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true; setWorking(true); setError(null);
    try { await operation(); } catch (cause) { setError(message(cause)); }
    finally { workingRef.current = false; setWorking(false); }
  }
  const preparing = state?.status === 'preparing' || state?.status === 'installing';
  const downloading = state?.status === 'downloading';
  const checking = state?.status === 'checking';
  const canCheck = !!state && ['idle', 'current', 'error'].includes(state.status);
  return <>
    <button className="secondary-button update-toggle" onClick={() => dialog.current?.showModal()}>{state?.status === 'downloaded' ? t('update.ready') : t('update.title')}</button>
    <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onCancel={event => { if (working || preparing) event.preventDefault(); }}>
      <div className="panel-heading"><h2 id="update-title">{t('update.title')}</h2><button className="secondary-button" disabled={working || preparing} onClick={() => dialog.current?.close()}>{t('common.close')}</button></div>
      <p className="update-version">{t('update.currentVersion', { version: state?.currentVersion ?? t('common.checking') })}</p>
      {state ? <p className="update-message" role="status">{localizeText(state.message)}</p> : <p role="status">{t('update.loading')}</p>}
      {(checking || downloading) && <progress aria-label={downloading ? t('update.downloading') : t('update.checking')} />}
      {state?.releaseName && <p className="small-copy">{t('update.receivedVersion', { version: state.releaseName })}</p>}
      {state?.releaseNotes && <details className="update-notes" open><summary>{t('update.notes')}</summary><p className="preserve-text">{state.releaseNotes}</p></details>}
      {state?.checkedAt && <p className="small-copy">{t('update.lastChecked', { date: formatDate(state.checkedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
      {error && <p className="inline-error" role="alert">{localizeText(error)}</p>}
      <div className="update-actions">
        {state?.status === 'downloaded' ? <button className="primary-button" disabled={working || blocked} onClick={() => void run(install)}>{t('update.install')}</button>
          : <button className="primary-button" disabled={!canCheck || working} onClick={() => void run(() => bridge.checkForUpdates())}>{checking ? t('common.checkingProgress') : downloading ? t('common.downloading') : state?.status === 'error' ? t('common.retry') : t('update.check')}</button>}
        {!state && error && <button className="secondary-button" disabled={working} onClick={() => void run(async () => { setState(await bridge.getUpdateState()); })}>{t('update.reload')}</button>}
      </div>
      {state?.status === 'downloaded' && blocked && <p className="small-copy">{t('update.blocked')}</p>}
      <p className="small-copy">{t('update.help')}</p>
    </dialog>
  </>;
}
