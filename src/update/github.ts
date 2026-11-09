import type { HttpTransport } from '../sync/http'

export const REPO = 'Lin-Guanguo/lifelog'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`

export interface Release {
  version: string
  notes: string
  pageUrl: string
  apkUrl: string
}

// -1, 0 or 1 for dotted numeric versions ("0.2.10" > "0.2.9").
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  return 0
}

interface GitHubRelease {
  tag_name: string
  body: string | null
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: { name: string; browser_download_url: string }[]
}

export function parseRelease(json: GitHubRelease): Release | null {
  const version = json.tag_name.replace(/^v/, '')
  const asset = json.assets.find((a) => a.name === `lifelog-${version}.apk`)
  if (json.draft || json.prerelease || !/^\d+\.\d+\.\d+$/.test(version) || !asset) return null
  return {
    version,
    notes: (json.body ?? '').trim(),
    pageUrl: json.html_url,
    apkUrl: asset.browser_download_url,
  }
}

// The latest published release, or null when there is none (or it has no APK).
export async function fetchLatestRelease(transport: HttpTransport): Promise<Release | null> {
  const res = await transport({ method: 'GET', url: LATEST_URL, headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 404) return null
  if (res.status !== 200) throw new Error(`GitHub: HTTP ${res.status}`)
  return parseRelease(JSON.parse(new TextDecoder().decode(res.body)) as GitHubRelease)
}

export const isNewer = (release: Release | null, current: string): release is Release =>
  release !== null && compareVersions(release.version, current) > 0
