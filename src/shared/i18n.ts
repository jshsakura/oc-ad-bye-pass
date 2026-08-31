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

import { am } from './locales/am.ts'
import { ar } from './locales/ar.ts'
import { bg } from './locales/bg.ts'
import { bn } from './locales/bn.ts'
import { ca } from './locales/ca.ts'
import { cs } from './locales/cs.ts'
import { da } from './locales/da.ts'
import { de } from './locales/de.ts'
import { el } from './locales/el.ts'
import { en } from './locales/en.ts'
import { es } from './locales/es.ts'
import { et } from './locales/et.ts'
import { fa } from './locales/fa.ts'
import { fi } from './locales/fi.ts'
import { fil } from './locales/fil.ts'
import { fr } from './locales/fr.ts'
import { gu } from './locales/gu.ts'
import { he } from './locales/he.ts'
import { hi } from './locales/hi.ts'
import { hr } from './locales/hr.ts'
import { hu } from './locales/hu.ts'
import { id } from './locales/id.ts'
import { it } from './locales/it.ts'
import { ja } from './locales/ja.ts'
import { kn } from './locales/kn.ts'
import { ko } from './locales/ko.ts'
import { lt } from './locales/lt.ts'
import { lv } from './locales/lv.ts'
import { ml } from './locales/ml.ts'
import { mr } from './locales/mr.ts'
import { ms } from './locales/ms.ts'
import { nl } from './locales/nl.ts'
import { no } from './locales/no.ts'
import { pl } from './locales/pl.ts'
import { ptBR } from './locales/pt-BR.ts'
import { ptPT } from './locales/pt-PT.ts'
import { ro } from './locales/ro.ts'
import { ru } from './locales/ru.ts'
import { sk } from './locales/sk.ts'
import { sl } from './locales/sl.ts'
import { sr } from './locales/sr.ts'
import { sv } from './locales/sv.ts'
import { sw } from './locales/sw.ts'
import { ta } from './locales/ta.ts'
import { te } from './locales/te.ts'
import { th } from './locales/th.ts'
import { tr } from './locales/tr.ts'
import { uk } from './locales/uk.ts'
import { ur } from './locales/ur.ts'
import { vi } from './locales/vi.ts'
import { zhCN } from './locales/zh-CN.ts'
import { zhTW } from './locales/zh-TW.ts'

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
  en: en,
  es: es,
  'pt-BR': ptBR,
  'pt-PT': ptPT,
  fr: fr,
  it: it,
  ca: ca,
  ro: ro,
  de: de,
  nl: nl,
  da: da,
  no: no,
  sv: sv,
  fi: fi,
  et: et,
  lv: lv,
  lt: lt,
  pl: pl,
  cs: cs,
  sk: sk,
  sl: sl,
  hr: hr,
  sr: sr,
  bg: bg,
  uk: uk,
  ru: ru,
  el: el,
  tr: tr,
  he: he,
  ar: ar,
  fa: fa,
  ur: ur,
  am: am,
  sw: sw,
  hi: hi,
  mr: mr,
  gu: gu,
  bn: bn,
  ta: ta,
  te: te,
  kn: kn,
  ml: ml,
  th: th,
  vi: vi,
  id: id,
  ms: ms,
  fil: fil,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja: ja,
  ko: ko,
  hu: hu,
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
  'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)',
  fr: 'Français',
  it: 'Italiano',
  ca: 'Català',
  ro: 'Română',
  de: 'Deutsch',
  nl: 'Nederlands',
  da: 'Dansk',
  no: 'Norsk',
  sv: 'Svenska',
  fi: 'Suomi',
  et: 'Eesti',
  lv: 'Latviešu',
  lt: 'Lietuvių',
  pl: 'Polski',
  cs: 'Čeština',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  hr: 'Hrvatski',
  sr: 'Српски',
  bg: 'Български',
  uk: 'Українська',
  ru: 'Русский',
  el: 'Ελληνικά',
  tr: 'Türkçe',
  he: 'עברית',
  ar: 'العربية',
  fa: 'فارسی',
  ur: 'اردو',
  am: 'አማርኛ',
  sw: 'Kiswahili',
  hi: 'हिन्दी',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  bn: 'বাংলা',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  fil: 'Filipino',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  hu: 'Magyar',
}

/**
 * Languages written right to left.
 *
 * Listing them is not optional once they ship: without `dir="rtl"` an Arabic UI
 * is laid out left to right, which puts every label, every switch and every
 * punctuation mark on the wrong side. It is not a nicety that can follow later —
 * it is the difference between shipping the language and shipping a mess with
 * the right words in it.
 *
 * A set rather than a per-language field, because it is a property of the script
 * and only five of these scripts have it.
 */
const RTL: ReadonlySet<string> = new Set(['ar', 'fa', 'he', 'ur', 'yi'])

/** 'rtl' or 'ltr' for a tag, by its primary subtag. */
export function langDir(lang: string): 'rtl' | 'ltr' {
  return RTL.has(lang.toLowerCase().split('-')[0]) ? 'rtl' : 'ltr'
}

/**
 * Put the language on <html>, where the engine reads it.
 *
 * `lang` drives hyphenation, quotation marks and the font the platform picks;
 * `dir` drives the whole layout. Both belong to the document rather than to any
 * component, which is why this is a call and not a prop.
 */
export function applyLangToDocument(lang: Lang): void {
  try {
    const root = document.documentElement
    root.setAttribute('lang', lang)
    root.setAttribute('dir', langDir(lang))
  } catch {
    // A UI that throws over a layout attribute is worse than one laid out wrong.
  }
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
