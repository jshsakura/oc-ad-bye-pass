// UI language. Chosen at runtime, stored in settings, one file per locale.
//
// Not chrome.i18n: that binds to the browser's UI language and cannot be
// switched from inside the extension, and being able to switch it is the whole
// point of the setting.
//
// **English is the base, not Korean.** `en.ts` defines every key and every other
// locale is a partial overlay over it. Korean was the first language here and
// the author's own, which is exactly why it should not be the fallback: a
// fallback is read by whoever the language did *not* serve, and Korean words in
// a Spanish UI help nobody.
//
// Adding a language is a file in ./locales and two lines below — its catalog
// need not be complete, and whatever it leaves out shows in English rather than
// breaking.

import { de } from './locales/de.ts'
import { en } from './locales/en.ts'
import { es } from './locales/es.ts'
import { fr } from './locales/fr.ts'
import { hi } from './locales/hi.ts'
import { ja } from './locales/ja.ts'
import { ko } from './locales/ko.ts'
import { ptBR } from './locales/pt-BR.ts'
import { ru } from './locales/ru.ts'
import { zhCN } from './locales/zh-CN.ts'

/** Every key, taken from the base locale. */
export type MessageKey = keyof typeof en

/** What a locale file may provide. Only `en` has to be whole. */
export type Catalog = Partial<Record<MessageKey, string>>

/**
 * The registry. One entry per shipped language.
 *
 * Order is the order of the picker, so English first and the rest by their own
 * names — not by how complete they are, which is not the reader's problem.
 */
const CATALOGS = {
  en,
  es,
  fr,
  de,
  'pt-BR': ptBR,
  ru,
  hi,
  ja,
  ko,
  'zh-CN': zhCN,
} satisfies Record<string, Catalog>

export type Lang = keyof typeof CATALOGS

/**
 * The registry itself, for the tests that check every locale against the base.
 * Not part of the API: `makeT` is how the rest of the code reads a string.
 */
export const CATALOGS_FOR_TESTS: Readonly<Record<Lang, Catalog>> = CATALOGS

export const LANGS = Object.keys(CATALOGS) as Lang[]

/** Where an untranslated string comes from, and where an unknown tag lands. */
export const BASE_LANG: Lang = 'en'

/**
 * Each language's name in that language. A reader looking for their own
 * language in a list is looking for the word they would write, not its English
 * exonym — which they may not recognise at all.
 */
export const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  hi: 'हिन्दी',
  ja: '日本語',
  ko: '한국어',
  'zh-CN': '简体中文',
}

type Vars = Record<string, string | number>

/**
 * Best match for a preference list, or null when nothing matches.
 *
 * Pure, so the cases can be enumerated without a browser. Each preference is
 * tried exactly first and then by primary subtag, in order, which is how a
 * reader whose list is `['pt-BR', 'en']` gets Portuguese if we ship any
 * Portuguese and English if we do not — rather than losing their first choice
 * to a loose match on their second.
 */
export function pickLang(
  preferred: readonly string[],
  supported: readonly string[],
): string | null {
  for (const raw of preferred) {
    if (!raw) continue
    const tag = raw.toLowerCase()
    const exact = supported.find((l) => l.toLowerCase() === tag)
    if (exact) return exact
    const primary = tag.split('-')[0]
    const loose = supported.find((l) => l.toLowerCase().split('-')[0] === primary)
    if (loose) return loose
  }
  return null
}

/** Every user-facing string, in one language. */
export type TFn = (key: MessageKey, vars?: Vars) => string

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

/**
 * A translator bound to one language, falling back to English for any gap.
 *
 * The catalog lookup tolerates a language that is no longer shipped: a setting
 * written by an older version outlives the version that wrote it, and a UI that
 * throws because a locale was retired is worse than one that speaks English.
 */
export function makeT(lang: Lang): TFn {
  const catalog: Catalog = CATALOGS[lang] ?? en
  return (key, vars) => interpolate(catalog[key] ?? en[key] ?? key, vars)
}

/**
 * The language to start in, from the browser, for the very first run only.
 *
 * `navigator.languages` rather than `navigator.language`: the list is the
 * reader's actual order of preference, and someone who reads three languages
 * has said so there.
 */
export function detectLang(): Lang {
  try {
    const nav =
      typeof navigator === 'undefined'
        ? []
        : navigator.languages?.length
          ? navigator.languages
          : [navigator.language]
    return (pickLang(nav, LANGS) as Lang | null) ?? BASE_LANG
  } catch {
    return BASE_LANG
  }
}
