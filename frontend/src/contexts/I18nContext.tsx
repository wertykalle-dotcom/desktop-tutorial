import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { I18nManager, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { I18n } from 'i18n-js';
import { apiUrl } from '../utils/api/http';
import {
  FALLBACK_LOCALE,
  LOCALE_STORAGE_KEY,
  LocaleKey,
  localeAliases,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
} from '../i18n/locales';

type LocaleMessages = Record<LocaleKey, Record<string, string>>;

const loadLocaleMessages = (): LocaleMessages => ({
  en: require('../i18n/en.json'),
  fi: require('../i18n/fi.json'),
  ar: require('../i18n/ar.json'),
  he: require('../i18n/he.json'),
});

const localeMessages = loadLocaleMessages();
const i18n = new I18n(localeMessages);
i18n.enableFallback = true;
i18n.defaultLocale = FALLBACK_LOCALE;

type I18nContextType = {
  locale: LocaleKey;
  isRTL: boolean;
  setLocale: (locale: LocaleKey) => Promise<void>;
  t: (key: string) => string;
  isReady: boolean;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const normalizeLocale = (raw?: string | null): LocaleKey => {
  const normalized = (raw || '').trim().toLowerCase().replace('_', '-');
  if (!normalized) return FALLBACK_LOCALE;
  if (localeAliases[normalized]) return localeAliases[normalized];
  const prefix = normalized.split('-')[0];
  if (localeAliases[prefix]) return localeAliases[prefix];
  return SUPPORTED_LOCALES.includes(prefix as LocaleKey) ? (prefix as LocaleKey) : FALLBACK_LOCALE;
};

const getBrowserLocale = (): string | null => {
  if (typeof navigator === 'undefined') return null;
  return navigator.languages?.[0] || navigator.language || null;
};

const getStoredLocale = async (): Promise<LocaleKey | null> => {
  try {
    if (Platform.OS === 'web') {
      return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
    }
    const stored = await SecureStore.getItemAsync(LOCALE_STORAGE_KEY);
    return normalizeLocale(stored);
  } catch {
    return null;
  }
};

const persistLocale = async (locale: LocaleKey): Promise<void> => {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } else {
      await SecureStore.setItemAsync(LOCALE_STORAGE_KEY, locale);
    }
  } catch (error) {
    console.warn('Could not persist locale:', error);
  }
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<LocaleKey>(FALLBACK_LOCALE);
  const [isReady, setIsReady] = useState(false);

  const initializeLocale = async (cancelledRef: { current: boolean }): Promise<void> => {
    const storedLocale = await getStoredLocale();
    if (cancelledRef.current) return;

    if (storedLocale) {
      setLocaleState(storedLocale);
      setIsReady(true);
      return;
    }

    try {
      const response = await fetch(apiUrl('/i18n/detect-locale'), {
        headers: {
          'Accept-Language': getBrowserLocale() || 'en',
        },
      });
      if (!cancelledRef.current && response.ok) {
        const payload = await response.json();
        const detectedLocale = normalizeLocale(payload?.locale);
        setLocaleState(detectedLocale);
        setIsReady(true);
        return;
      }
    } catch (error) {
      console.warn('Could not detect locale from provider:', error);
    }

    const browserLocale = normalizeLocale(getBrowserLocale());
    const resolvedLocale = browserLocale || FALLBACK_LOCALE;
    setLocaleState(resolvedLocale);
    setIsReady(true);
  };

  useEffect(() => {
    const cancelledRef = { current: false };
    void initializeLocale(cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    i18n.locale = locale;
  }, [locale]);

  useEffect(() => {
    const shouldRTL = RTL_LOCALES.includes(locale);
    if (I18nManager.isRTL !== shouldRTL) {
      I18nManager.allowRTL(shouldRTL);
      I18nManager.forceRTL(shouldRTL);
    }
  }, [locale]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = async (nextLocale: LocaleKey) => {
    setLocaleState(nextLocale);
    await persistLocale(nextLocale);
  };

  const value = useMemo<I18nContextType>(
    () => ({
      locale,
      isRTL: RTL_LOCALES.includes(locale),
      setLocale,
      t: (key: string) => String(i18n.t(key)),
      isReady,
    }),
    [locale, isReady]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};
