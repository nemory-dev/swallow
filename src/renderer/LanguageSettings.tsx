import { useRef, useState } from 'react';
import type { AppLanguage, LanguagePreferences, LanguageResolution } from '../shared/i18n.js';
import type { SwallowBridge } from '../shared/types.js';
import { useLanguage } from './LanguageContext.js';

export function LanguageSettings({ bridge, resolution }: { bridge: SwallowBridge; resolution?: LanguageResolution }) {
  const { t, uiLocale, responseLanguage } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function save(field: keyof LanguagePreferences, value: AppLanguage) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setFailed(false);
    try { await bridge.setLanguagePreferences({ uiLocale, responseLanguage, [field]: value }); }
    catch { setFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <>
    <button className="secondary-button" onClick={() => dialog.current?.showModal()}>{t('language.settings')}</button>
    <dialog ref={dialog} className="update-dialog" aria-labelledby="language-title" onCancel={event => { if (saving) event.preventDefault(); }}>
    <div className="panel-heading"><h2 id="language-title">{t('language.settings')}</h2><button className="secondary-button" disabled={saving} onClick={() => dialog.current?.close()}>{t('common.close')}</button></div>
    <label className="field-label">{t('language.uiLabel')}
      <select aria-label={t('language.uiLabel')} value={uiLocale} disabled={saving} onChange={event => void save('uiLocale', event.target.value as AppLanguage)}>
        <option value="ko">{t('language.ko')}</option><option value="en">{t('language.en')}</option>
      </select>
    </label>
    <label className="field-label">{t('language.responseLabel')}
      <select aria-label={t('language.responseLabel')} value={responseLanguage} disabled={saving} onChange={event => void save('responseLanguage', event.target.value as AppLanguage)}>
        <option value="ko">{t('language.ko')}</option><option value="en">{t('language.en')}</option>
      </select>
    </label>
    <p className="small-copy">{t('language.nextPassageHelp')}</p>
    <p className="small-copy">{t('language.noRequestHelp')}</p>
    {saving && <p role="status" className="small-copy">{t('common.saving')}</p>}
    {resolution?.status === 'invalid' && <p role="alert" className="inline-error">{t('language.invalidSettings')}</p>}
    {failed && <p role="alert" className="inline-error">{t('language.saveFailed')}</p>}
  </dialog></>;
}
