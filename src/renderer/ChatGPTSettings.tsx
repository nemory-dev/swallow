import { useEffect, useRef, useState } from 'react';
import type { AppState, SwallowBridge } from '../shared/types.js';
import { CHATGPT_CONSENT_VERSION } from '../shared/chatgpt.js';
import { useLanguage } from './LanguageContext.js';
import chatgptLogo from './assets/chatgpt-logo-white.svg?inline';

interface Props { state: AppState; bridge: SwallowBridge; run(operation: () => Promise<void>): void; pending: boolean }
export function ChatGPTSettings({ state, bridge, run, pending }: Props) {
  const { t, errorText } = useLanguage();
  const [consent, setConsent] = useState(false);
  const [accountId, setAccountId] = useState(state.chatgpt?.activeAccountId ?? '');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const connection = state.chatgpt;
  useEffect(() => { setAccountId(connection?.activeAccountId ?? ''); }, [connection?.activeAccountId]);
  const connecting = connection?.status === 'checking';
  const busy = pending || connecting || !!state.busy;
  const active = connection?.accounts.find(account => account.id === connection.activeAccountId);
  return <section className="chatgpt-settings" aria-labelledby="chatgpt-settings-title">
    <h3 id="chatgpt-settings-title">{t('chatgpt.title')}</h3>
    <p>{t('chatgpt.intro')}</p>
    <details><summary>{t('chatgpt.beforeConnect')}</summary>
      <p>{t('chatgpt.data')}</p><p>{t('chatgpt.cost')}</p><p>{t('chatgpt.storage')}</p>
    </details>
    <p className="chatgpt-risk">{t('chatgpt.risk')}</p>
    <label className="chatgpt-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />{t('chatgpt.consent')}</label>
    <label className="field-label">{t('chatgpt.account')}
      <select value={accountId} disabled={busy} onChange={event => setAccountId(event.target.value)}>
        <option value="">{t('chatgpt.newAccount')}</option>
        {connection?.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select>
    </label>
    {active && <p className="small-copy">{t('chatgpt.active')}: {active.label}</p>}
    <p role="status">{connection?.locked && !connecting ? t('chatgpt.locked') : connecting ? t('chatgpt.connecting') : connection?.status === 'ready' ? t('chatgpt.connected')
      : connection?.status === 'needs-consent' ? t('chatgpt.needsConsent') : t('chatgpt.disconnected')}</p>
    {(connection?.error || cancelError) && <p role="alert">{connection?.error ? t(connection.error) : cancelError}</p>}
    {connection?.diagnostic && <details><summary>{t('chatgpt.errorDetails')}</summary><p className="small-copy">{[
      connection.diagnostic.phase, connection.diagnostic.status && `HTTP ${connection.diagnostic.status}`,
      connection.diagnostic.code, connection.diagnostic.param, connection.diagnostic.requestId,
      connection.diagnostic.contentType, connection.diagnostic.bodyFormat,
    ].filter(Boolean).join(' · ')}</p></details>}
    <div className="account-actions">
      <button className="chatgpt-sign-in" disabled={!consent || busy || connection?.locked} onClick={() => run(() => bridge.connectChatGPT(CHATGPT_CONSENT_VERSION, accountId || undefined))}><img src={chatgptLogo} width="21" height="21" alt="" />Continue with ChatGPT</button>
      {connection?.signingIn && <button className="text-button" onClick={() => { setCancelError(null); void bridge.cancelChatGPTSignIn().catch(error => setCancelError(errorText(error))); }}>{t('chatgpt.cancel')}</button>}
      <button className="text-button" disabled={busy || (!active?.connected && !connection?.locked)} onClick={() => run(() => bridge.refreshChatGPT())}>{t('chatgpt.refresh')}</button>
      <button className="text-button" disabled={busy || !active?.connected} onClick={() => run(() => bridge.disconnectChatGPT())}>{t('chatgpt.disconnect')}</button>
      <button className="text-button" disabled={pending} onClick={() => run(() => bridge.openChatGPTUsage())}>{t('chatgpt.usage')}</button>
    </div>
  </section>;
}
export function ChatGPTWelcome({ state, bridge, run, pending }: Props) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (state.chatgpt?.firstUsePending && !pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [state.chatgpt?.firstUsePending, pending]);
  return <dialog ref={dialog} className="document-dialog chatgpt-welcome" aria-labelledby="chatgpt-welcome-title" onCancel={event => { event.preventDefault(); run(() => bridge.acknowledgeChatGPT()); }}>
    <h2 id="chatgpt-welcome-title">{t('chatgpt.welcome')}</h2>
    <p>{t('chatgpt.welcomeHelp')}</p>
    <div className="account-actions">
      <button className="primary-button" onClick={() => run(() => bridge.acknowledgeChatGPT())}>{t('chatgpt.gotIt')}</button>
      <button className="text-button" onClick={() => run(() => bridge.openChatGPTUsage())}>{t('chatgpt.usage')}</button>
    </div>
  </dialog>;
}
export function ChatGPTUsage({ state, bridge, run }: Omit<Props, 'pending'>) {
  const { t } = useLanguage();
  if (!state.library.selectedModel?.startsWith('chatgpt:')) return null;
  return <p className="chatgpt-usage">{t(state.chatgpt?.status === 'ready' ? 'chatgpt.using' : 'chatgpt.selected')} · <button className={state.chatgpt?.error === 'public.chatgptLimit' ? 'primary-button' : 'text-button'} onClick={() => run(() => bridge.openChatGPTUsage())}>{t('chatgpt.usage')}</button></p>;
}
