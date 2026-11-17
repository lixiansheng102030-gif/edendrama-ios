import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, type Lang } from './translations';
import { settingsApi } from '../api';

type LoginMethodsEnabled = {
  account: boolean;
  google: boolean;
  twitter: boolean;
  apple: boolean;
  telegram: boolean;
  guest: boolean;
};

type I18nContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  languageSwitchEnabled: boolean;
  vipScreenEnabled: boolean;
  /** 各平台登录入口开关（后台配置）；缺键一律为 true */
  loginMethodsEnabled: LoginMethodsEnabled;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

// 取不到配置时的安全默认：全部入口可见（与 vipScreenEnabled 的约定一致）
const DEFAULT_LOGIN_METHODS: LoginMethodsEnabled = {
  account: true,
  google: true,
  twitter: true,
  apple: true,
  telegram: true,
  guest: true,
};

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  languageSwitchEnabled: true,
  vipScreenEnabled: true,
  loginMethodsEnabled: DEFAULT_LOGIN_METHODS,
  t: (key) => key,
});

const STORAGE_KEY = 'app_lang';
let memoryFallback: Lang = 'en';

// 合法的语言值（与 Web 端对齐：en / zh / ru / es）
const SUPPORTED_LANGS: Lang[] = ['en', 'zh', 'ru', 'es'];
function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as string[]).includes(value);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [languageSwitchEnabled, setLanguageSwitchEnabled] = useState<boolean>(true);
  const [vipScreenEnabled, setVipScreenEnabled] = useState<boolean>(true);
  const [loginMethodsEnabled, setLoginMethodsEnabled] =
    useState<LoginMethodsEnabled>(DEFAULT_LOGIN_METHODS);

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      // Try to read previously persisted language first, for fast first paint.
      const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
      const fallbackLang: Lang = isLang(stored) ? stored : 'en';

      try {
        const settings: any = await settingsApi.get();
        if (!mounted) return;

        const defaultLang: Lang = isLang(settings?.defaultLanguage)
          ? (settings.defaultLanguage as Lang)
          : 'en';
        const switchEnabled =
          settings?.languageSwitchEnabled === undefined
            ? true
            : Boolean(settings.languageSwitchEnabled);
        const vipEnabled =
          settings?.vipScreenEnabled === undefined
            ? true
            : Boolean(settings.vipScreenEnabled);

        setLanguageSwitchEnabled(switchEnabled);
        setVipScreenEnabled(vipEnabled);

        // 各平台登录入口开关：缺键→true（老后台/未配置时保持全显示）
        const lm: any = settings?.loginMethodsEnabled;
        setLoginMethodsEnabled({
          account: lm?.account === undefined ? true : lm.account === true,
          google: lm?.google === undefined ? true : lm.google === true,
          twitter: lm?.twitter === undefined ? true : lm.twitter === true,
          apple: lm?.apple === undefined ? true : lm.apple === true,
          telegram: lm?.telegram === undefined ? true : lm.telegram === true,
          // 游客是保底出口，永远显示（后端也强制 true）
          guest: true,
        });

        if (!switchEnabled) {
          // Switching disabled -> always force the configured default language.
          setLangState(defaultLang);
          memoryFallback = defaultLang;
          await AsyncStorage.setItem(STORAGE_KEY, defaultLang).catch(() => {});
        } else {
          // Switching enabled -> honor user's persisted choice if it exists,
          // otherwise use the configured default language.
          const initial: Lang = stored ? fallbackLang : defaultLang;
          setLangState(initial);
          memoryFallback = initial;
          await AsyncStorage.setItem(STORAGE_KEY, initial).catch(() => {});
        }
      } catch {
        // Network/permissions failure -> fall back to stored or 'en'.
        if (!mounted) return;
        setLangState(fallbackLang);
        memoryFallback = fallbackLang;
        // 配置读取失败时登录入口一律显示，避免把用户挡在门外
        setLoginMethodsEnabled(DEFAULT_LOGIN_METHODS);
      }
    }

    loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const setLang = (next: Lang) => {
    if (!languageSwitchEnabled) {
      // Switching disabled by server settings; ignore user attempts.
      return;
    }
    memoryFallback = next;
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let value: string =
      (translations[lang] as Record<string, string>)[key] ??
      (translations.en as Record<string, string>)[key] ??
      key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return value;
  };

  return (
    <I18nContext.Provider
      value={{ lang, setLang, languageSwitchEnabled, vipScreenEnabled, loginMethodsEnabled, t }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

/**
 * 同步读取当前语言。
 * 供「非组件」的纯函数使用（如数字单位格式化：中文用 万/亿，其它语言用 K/M/B）。
 * memoryFallback 会在切语言与初始化时同步更新，故渲染期调用即是最新值。
 */
export function getCurrentLang(): Lang {
  return memoryFallback;
}

/** 把集号数组描述成「第 3 集」/「第 3-5 集」/「共 4 集」 */
function describeEpisodes(
  t: (key: string, vars?: Record<string, string | number>) => string,
  nos: number[],
): string {
  const nums = Array.from(new Set(nos.filter((n) => Number.isFinite(n)))).sort((a, b) => a - b);
  if (nums.length === 0) return '';
  if (nums.length === 1) return t('coinReason.epSingle', { n: nums[0] });
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (contiguous) return t('coinReason.epRange', { from: nums[0], to: nums[nums.length - 1] });
  return t('coinReason.epCount', { n: nums.length });
}

/**
 * 金币流水的展示文案。
 * 购买类流水（unlock_episode / unlock_drama）会带上「买了什么剧、哪几集」，
 * 而不是只显示 unlock_episode 这种内部标识。
 */
export function localizeCoinTxReason(
  t: (key: string, vars?: Record<string, string | number>) => string,
  tx: any,
): string {
  const reason: string = tx?.reason ?? '';
  const meta: any = tx?.metadata ?? {};
  const title = typeof meta?.dramaTitle === 'string' ? meta.dramaTitle : '';

  if (reason === 'unlock_episode' || reason === 'unlock_drama') {
    const isFull = reason === 'unlock_drama';
    const nos: number[] = Array.isArray(meta?.episodeNos)
      ? meta.episodeNos.map((n: any) => Number(n))
      : [];
    let epText = describeEpisodes(t, nos);
    if (!epText && Array.isArray(meta?.episodeIds) && meta.episodeIds.length > 0) {
      epText = t('coinReason.epCount', { n: meta.episodeIds.length });
    }
    if (title && epText) return t('coinReason.buyWithEp', { title, ep: epText });
    if (title) {
      return isFull ? t('coinReason.buyFull', { title }) : t('coinReason.buyTitleOnly', { title });
    }
    return isFull ? t('coinReason.buyFullNoTitle') : t('coinReason.buyNoTitle');
  }

  // 管理员调整的 reason 形如 admin_adjust:备注
  if (reason.startsWith('admin_adjust')) {
    const note = reason.includes(':') ? reason.slice(reason.indexOf(':') + 1).trim() : '';
    const base = t('coinReason.admin_adjust');
    return note ? `${base} · ${note}` : base;
  }

  const i18nKey = `coinReason.${reason}`;
  const translated = t(i18nKey);
  return translated && translated !== i18nKey ? translated : reason;
}

/**
 * 分类名本地化（移植自网页端 localizeCategory）。
 * 分类是后台配置的数据，name 存的是英文（Romance / Mystery / CEO & Power…），
 * 直接显示就会在中文界面里冒出英文 —— 这正是"语言混乱"的主要来源。
 * 优先按 slug 查 category.<slug> 的译文，查不到再退回数据库里的 name。
 */
export function localizeCategory(
  t: (key: string, vars?: Record<string, string | number>) => string,
  category: { slug?: string; name?: string } | null | undefined,
): string {
  if (!category) return '';
  const slug = category.slug;
  if (slug) {
    const key = `category.${slug}`;
    const translated = t(key);
    if (translated && translated !== key) return translated;
  }
  return category.name || category.slug || '';
}
