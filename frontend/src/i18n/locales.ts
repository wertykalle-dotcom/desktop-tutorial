export type LocaleKey = 'en' | 'fi' | 'ar' | 'he';

export const RTL_LOCALES: LocaleKey[] = ['ar', 'he'];

export const SUPPORTED_LOCALES: LocaleKey[] = ['en', 'fi', 'ar', 'he'];

export const FALLBACK_LOCALE: LocaleKey = 'en';

export const LOCALE_STORAGE_KEY = 'app_locale';

export const localeLabels: Record<LocaleKey, string> = {
  en: 'English',
  fi: 'Suomi',
  ar: 'العربية',
  he: 'עברית',
};

export const localeFileNames: Record<LocaleKey, string> = {
  en: 'en.json',
  fi: 'fi.json',
  ar: 'ar.json',
  he: 'he.json',
};

export const localeAliases: Record<string, LocaleKey> = {
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  fi: 'fi',
  'fi-fi': 'fi',
  ar: 'ar',
  'ar-sa': 'ar',
  'ar-ae': 'ar',
  he: 'he',
  'he-il': 'he',
  iw: 'he',
  'iw-il': 'he',
};
