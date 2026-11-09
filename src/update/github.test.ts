import { describe, expect, it } from 'vitest'
import type { HttpTransport } from '../sync/http'
import { compareVersions, fetchLatestRelease, isNewer, parseRelease } from './github'

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.7', body: '- New thing\n', html_url: 'https://github.com/Lin-Guanguo/lifelog/releases/tag/v0.2.7',
  draft: false, prerelease: false,
  assets: [{ name: 'lifelog-0.2.7.apk', browser_download_url: 'https://example/lifelog-0.2.7.apk' }],
  ...over,
})
const respond = (status: number, json?: unknown): HttpTransport => async () =>
  ({ status, headers: {}, body: new TextEncoder().encode(json === undefined ? '' : JSON.stringify(json)) })

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBe(1)
    expect(compareVersions('0.2.6', '0.2.6')).toBe(0)
    expect(compareVersions('0.2.6', '1.0.0')).toBe(-1)
  })

  it('reads the version, notes and APK asset of a release', () => {
    expect(parseRelease(release())).toEqual({
      version: '0.2.7', notes: '- New thing', pageUrl: 'https://github.com/Lin-Guanguo/lifelog/releases/tag/v0.2.7',
      apkUrl: 'https://example/lifelog-0.2.7.apk',
    })
    expect(parseRelease(release({ assets: [] }))).toBeNull()
    expect(parseRelease(release({ prerelease: true }))).toBeNull()
    expect(parseRelease(release({ tag_name: 'nightly' }))).toBeNull()
    expect(parseRelease(release({ assets: [{ name: 'lifelog-0.2.6.apk', browser_download_url: 'u' }] }))).toBeNull()
  })

  it('treats a missing release as none and other failures as errors', async () => {
    expect(await fetchLatestRelease(respond(404))).toBeNull()
    expect((await fetchLatestRelease(respond(200, release())))?.version).toBe('0.2.7')
    await expect(fetchLatestRelease(respond(403))).rejects.toThrow('HTTP 403')
  })

  it('offers only newer releases', () => {
    const r = parseRelease(release())
    expect(isNewer(r, '0.2.6')).toBe(true)
    expect(isNewer(r, '0.2.7')).toBe(false)
    expect(isNewer(r, '0.3.0')).toBe(false)
    expect(isNewer(null, '0.2.6')).toBe(false)
  })
})
