import { useEffect, useRef, useState } from 'react';
import type { AppState, ResponseLanguage, SwallowBridge, TranslationScope } from '../shared/types.js';
import { useLanguage } from './LanguageContext.js';

export interface TranslationControls {
  pendingScope?: TranslationScope;
  start: SwallowBridge['translateDocument'];
}

interface TranslationActivity {
  scope: TranslationScope;
  startedAt: number;
  targetLanguage?: ResponseLanguage;
  progress?: NonNullable<AppState['busy']>['progress'];
}

export function TranslationStatus({ activity, saved, onCancel, onError }: {
  activity: TranslationActivity | null;
  saved: boolean;
  onCancel?: () => Promise<void>;
  onError: (cause: unknown) => void;
}) {
  const { t, formatNumber } = useLanguage();
  const [now, setNow] = useState(Date.now);
  const [cancelling, setCancelling] = useState(false);
  const cancelLock = useRef(false);
  const startedAt = activity?.startedAt;

  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  async function cancel() {
    if (!onCancel || cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    try { await onCancel(); }
    catch (cause) { onError(cause); }
    finally { cancelLock.current = false; setCancelling(false); }
  }

  if (!activity && !saved) return null;
  const seconds = activity ? Math.floor((now - activity.startedAt) / 1_000) : 0;
  const progress = activity?.scope === 'document' ? activity.progress : undefined;

  return <div className="translation-status">
    <p className="translation-status-message" role="status">
      {activity ? <><span className="loading-dot" aria-hidden="true" />
        <strong>{t(activity.scope === 'document' ? 'translation.processingDocument' : 'translation.processing')}</strong>
        {activity.targetLanguage && <span>{t(activity.targetLanguage === 'ko' ? 'language.ko' : 'language.en')}</span>}
        {progress && <span>{t('translation.progress', { count: progress.completed, total: progress.total })}</span>}
      </> : <strong>{t('translation.savedStatus')}</strong>}
    </p>
    {seconds >= 30 && <p className="translation-waiting">{t('translation.waiting', { seconds: formatNumber(seconds) })}</p>}
    {activity && <button className="text-button" disabled={!onCancel || cancelling} onClick={() => { void cancel(); }}>{t(cancelling ? 'translation.cancelling' : 'translation.cancel')}</button>}
  </div>;
}
