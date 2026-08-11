// Decides whether the extension is alive by asking "is it actually blocking
// ads?", not by looking for a fingerprint.
//
// This used to check a window.__ocAdByePassInstalled flag and a
// <style id="oc-ad-bye-pass"> element — name tags we had pinned on the
// extension purely to make testing easy. YouTube's page scripts can read
// exactly the same tags, which makes them a detection fingerprint. Since those
// are going away, the tests look at effects rather than traces.
//
// It is the better test anyway: however the implementation changes (style tag,
// insertCSS, adoptedStyleSheets, MAIN world registration or fallback
// injection), the only question asked is whether ads get blocked.

import type { Page } from '@playwright/test'

/**
 * Is layer 1 alive?
 * Parse a fresh JSON payload containing ad fields from the page and see whether
 * they come back stripped.
 */
export function layer1Active(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const parsed = JSON.parse('{"adPlacements":[{}],"videoDetails":{"videoId":"probe"}}') as Record<
      string,
      unknown
    >
    return parsed.adPlacements === undefined && parsed.videoDetails !== undefined
  })
}

/**
 * Is layer 2 alive?
 * Attach one ad renderer tag, check whether it gets hidden, and remove it again.
 *
 * Worth noting: this is precisely how YouTube detects ad blockers — render an
 * ad element and check whether its height is zero. Hiding with CSS cannot avoid
 * it, which is why layer 1 (never receiving the ad at all) has to be the
 * primary defence.
 */
export function layer2Active(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const probe = document.createElement('ytd-ad-slot-renderer')
    probe.textContent = 'probe'
    document.documentElement.appendChild(probe)
    const hidden = getComputedStyle(probe).display === 'none'
    probe.remove()
    return hidden
  })
}

/** Is the extension entirely uninvolved in this page — what we expect off YouTube. */
export async function extensionInactive(page: Page): Promise<boolean> {
  return !(await layer1Active(page)) && !(await layer2Active(page))
}
