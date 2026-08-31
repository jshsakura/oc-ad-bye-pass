// A locale written in the wrong script is a typo nobody catches by reading.
//
// Every one of these files was written in one sitting, and a stray Cyrillic
// character inside a Latin word renders identically — `obidено` for `obideno`
// passed the eye, the type checker and every other test. It is only visible to
// something that knows which alphabet the language uses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(import.meta.dirname, '..', 'src', 'shared', 'locales')

/** Ranges a locale must not contain, by the script it is actually written in. */
const FOREIGN: Record<string, RegExp> = {
  latin: /[Ѐ-ӿԀ-ԯͰ-Ͽ]/, // Cyrillic or Greek
  cyrillic: /[Ͱ-Ͽ]/, // Greek
  greek: /[Ѐ-ӿ]/, // Cyrillic
}

const SCRIPT: Record<string, keyof typeof FOREIGN> = {}
for (const lang of ['ca','cs','da','de','en','es','et','fi','fil','fr','hr','hu','id','it','lt','lv','ms','nl','no','pl','pt-BR','pt-PT','ro','sk','sl','sv','sw','tr','vi'])
  SCRIPT[lang] = 'latin'
for (const lang of ['bg','mk','ru','sr','uk']) SCRIPT[lang] = 'cyrillic'
SCRIPT.el = 'greek'

test('각 로케일은 자기 문자로만 쓰여 있다', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length > 40, `로케일 파일이 ${files.length}개뿐이다`)
  for (const file of files) {
    const lang = file.slice(0, -3)
    const script = SCRIPT[lang]
    if (!script) continue
    const text = readFileSync(join(DIR, file), 'utf8')
    for (const [i, line] of text.split('\n').entries()) {
      // The header comment names the language in its own script on purpose.
      if (line.trimStart().startsWith('//')) continue
      assert.ok(
        !FOREIGN[script].test(line),
        `${lang}:${i + 1} 에 ${script} 아닌 문자가 섞였다 — ${line.trim().slice(0, 60)}`,
      )
    }
  }
})
