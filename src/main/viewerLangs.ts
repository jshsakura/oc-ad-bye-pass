// What "my language" means, in one place.
//
// Two features answer to it — the caption picker and the audio-track pin — and
// they have to agree. If one followed the browser and the other the extension's
// UI language, a video would come back dubbed in one language and subtitled in
// another, which is worse than either feature being off.
//
// It is the **browser** locale, not the extension's UI language: the UI speaks
// only ko and en, while what someone wants to listen to is whatever they
// actually browse in.

/** Primary subtags of the browser's language list, deduped and in order: ko-KR → ko. */
export function viewerLangs(): string[] {
  const raw = navigator.languages?.length ? [...navigator.languages] : [navigator.language || 'en']
  return [...new Set(raw.map((l) => l.split('-')[0].toLowerCase()).filter(Boolean))]
}
