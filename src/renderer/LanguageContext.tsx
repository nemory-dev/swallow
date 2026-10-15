import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  createTranslator, formatDate, formatNumber, normalizeLocale,
  type LanguagePreferences, type Translator,
  type MessageKey,
} from '../shared/i18n.js';
import { errorText, localizeText } from '../shared/public-errors.js';

export interface LanguageContextValue extends LanguagePreferences {
  readonly t: Translator;
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  readonly errorText: (error: unknown, fallback?: MessageKey) => string;
  readonly localizeText: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/** Controlled by confirmed preferences from the caller. No storage, bridge, or AI side effects.
 * Mount once above App; never key the Provider or its children by locale.
 * manageDocument should be enabled only on the single app-level Provider.
 */
export function LanguageProvider({ preferences, children, manageDocument = true }: {
  preferences: LanguagePreferences;
  children?: ReactNode;
  manageDocument?: boolean;
}) {
  const uiLocale = normalizeLocale(preferences.uiLocale);
  const responseLanguage = normalizeLocale(preferences.responseLanguage);
  const value = useMemo<LanguageContextValue>(() => ({
    uiLocale, responseLanguage,
    t: createTranslator(uiLocale),
    formatNumber: (number, options) => formatNumber(uiLocale, number, options),
    formatDate: (date, options) => formatDate(uiLocale, date, options),
    errorText: (error, fallback) => errorText(error, uiLocale, fallback),
    localizeText: text => localizeText(text, uiLocale),
  }), [uiLocale, responseLanguage]);

  useEffect(() => {
    if (!manageDocument || typeof document === 'undefined') return;
    const root = document.documentElement;
    const previousLanguage = root.getAttribute('lang');
    const previousTitle = document.title;
    const title = createTranslator(uiLocale)('app.title');
    root.lang = uiLocale;
    document.title = title;
    return () => {
      // Avoid undoing metadata changed by another owner while this Provider was mounted.
      if (root.getAttribute('lang') === uiLocale) {
        if (previousLanguage === null) root.removeAttribute('lang');
        else root.setAttribute('lang', previousLanguage);
      }
      if (document.title === title) document.title = previousTitle;
    };
  }, [uiLocale, manageDocument]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage requires LanguageProvider.');
  return context;
}
