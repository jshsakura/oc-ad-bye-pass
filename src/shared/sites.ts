// Which site are we on, and are we allowed to act here?
//
// Once the extension injects everywhere, two questions have to be answered on
// every page, cheaply and in the same way from the content script, the popup and
// the background:
//
//   1. Is this YouTube? YouTube gets the full three layers; everywhere else gets
//      generic cosmetic rules only. There is no reason to hook JSON.parse on a
//      bank's website.
//   2. Has the user switched us off here? Injecting everywhere means we can
//      break anything, so a per-site escape hatch is not a nicety — it is the
//      thing that makes global injection defensible. If someone hits a broken
//      page and their only recourse is disabling the extension outright, they
//      will disable it outright.

const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i

export type SiteKind = 'youtube' | 'generic'

/** Strip the leading `www.` so the allowlist does not need both forms. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

export function siteKindFor(hostname: string): SiteKind {
  return YOUTUBE_HOSTS.test(hostname.toLowerCase()) ? 'youtube' : 'generic'
}

export function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const { protocol, hostname } = new URL(url)
    // chrome://, about:, file:// and friends have nothing for us to block
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return normalizeHost(hostname)
  } catch {
    return null
  }
}

/**
 * Is this host switched off?
 *
 * An entry covers its subdomains as well: allowlisting `example.com` also
 * covers `shop.example.com`. That matches what people mean by "turn it off for
 * this site", and it avoids a list that fills up with one entry per subdomain.
 */
export function isAllowlisted(hostname: string, allowlist: readonly string[]): boolean {
  const host = normalizeHost(hostname)
  return allowlist.some((entry) => {
    const allowed = normalizeHost(entry)
    return host === allowed || host.endsWith(`.${allowed}`)
  })
}

export function addToAllowlist(hostname: string, allowlist: readonly string[]): string[] {
  const host = normalizeHost(hostname)
  if (isAllowlisted(host, allowlist)) return [...allowlist]
  return [...allowlist, host].sort()
}

/**
 * Remove a host from the allowlist.
 *
 * Also drops any parent entry that was covering it — otherwise "turn it back on"
 * appears to do nothing, because a broader entry still matches. Removing
 * `shop.example.com` when only `example.com` is listed therefore also removes
 * `example.com`, which is the only reading that makes the button honest.
 */
export function removeFromAllowlist(hostname: string, allowlist: readonly string[]): string[] {
  const host = normalizeHost(hostname)
  return allowlist.filter((entry) => {
    const allowed = normalizeHost(entry)
    return !(host === allowed || host.endsWith(`.${allowed}`))
  })
}
