import type { Records } from '../data/records'
import { fromSqliteFile, toSqliteFile } from '../data/snapshot'
import { photosOf } from '../media/content'
import { contentType, type MediaFiles } from '../media/files'
import { WebDavError, type WebDav } from './webdav'

// The server keeps one standard SQLite snapshot of the log, and the photo copies in media/.
export const REMOTE_FILE = 'lifelog.sqlite'
export const MEDIA_FOLDER = 'media'
// Local photo copies that no row references are deleted at sync time, unless written this recently (a photo in
// the composer's tray or an unsaved edit is not referenced yet).
export const PHOTO_GRACE_MS = 24 * 3_600_000
const LEGACY_TEMP_FILE = `${REMOTE_FILE}.uploading`

export interface SyncState {
  // Version of the remote file as this device last wrote or merged it. A different version on the
  // server means another device (or an earlier install) wrote it since.
  remoteVersion?: string
  lastSyncAt?: number
}

export interface SyncResult {
  state: SyncState
  merged: boolean // remote data changed the local log
  uploaded: boolean
}

// One sync step: merge the remote snapshot if it changed since our last sync, then upload only
// when the server lacks something (local changes, merged-in data, or no snapshot yet).
// `beforeUpload` marks the moment the snapshot is taken, so later local writes stay pending.
export async function sync(dav: WebDav, records: Records, state: SyncState, dirty: boolean,
  beforeUpload: () => void = () => {}, now = Date.now(), photos?: MediaFiles): Promise<SyncResult> {
  const url = dav.fileUrl(REMOTE_FILE)
  const remote = await dav.version(url)
  const remoteChanged = remote !== null && remote !== state.remoteVersion
  const merged = remoteChanged && await records.merge(await fromSqliteFile(await dav.get(url)))
  // Nothing new here: adopt the remote version, without reading the log. Uploading anyway would make
  // two devices take turns re-uploading the same data.
  if (remote !== null && !dirty && !merged) {
    return { state: { remoteVersion: remote, lastSyncAt: now }, merged, uploaded: false }
  }

  // One snapshot for cleaning up photos and for the upload.
  beforeUpload()
  const rows = await records.all()
  const inUse = new Set(rows.filter((r) => r.purged_at === null).flatMap((r) => photosOf(r.content).map((p) => p.file)))
  const here = photos ? await removeUnusedPhotos(photos, inUse, now) : []
  if (remote === null) await dav.ensureDirectory()
  // Photos first, so a database on the server never references a photo that is not there.
  if (photos) await uploadPhotos(dav, here, photos)
  // A plain PUT over the file. Uploading to a temporary name and moving it over the target is not
  // portable: Nutstore (坚果云) rejects MOVE onto an existing file with 409 even with Overwrite: T.
  await dav.put(url, await toSqliteFile(rows))
  // v0.2.0–0.2.2 uploaded via a temporary file that could be left behind; clean it up.
  await dav.remove(dav.fileUrl(LEGACY_TEMP_FILE)).catch(() => {})
  return { state: { remoteVersion: (await dav.version(url)) ?? undefined, lastSyncAt: now }, merged, uploaded: true }
}

// Deletes local copies no row references (trash included, so restoring works) and resolves to the copies in use.
// The server's copies are left alone.
async function removeUnusedPhotos(photos: MediaFiles, inUse: Set<string>, now: number): Promise<string[]> {
  const here: string[] = []
  for (const file of await photos.list()) {
    if (inUse.has(file.name)) here.push(file.name)
    // The file's date is checked again when removing: the photo may have been added again meanwhile.
    else if (now - file.modified > PHOTO_GRACE_MS) await photos.remove(file.name, now - PHOTO_GRACE_MS)
  }
  return here
}

// Uploads the copies this device has of photos that rows reference and the server lacks. A copy is
// never changed once written, so presence by name is enough.
async function uploadPhotos(dav: WebDav, here: string[], photos: MediaFiles): Promise<void> {
  if (here.length === 0) return
  let remote = await dav.list(dav.folderUrl(MEDIA_FOLDER))
  if (remote === null) {
    await dav.ensureFolder(MEDIA_FOLDER)
    remote = []
  }
  const there = new Set(remote.map((f) => f.name))
  for (const name of here) {
    if (there.has(name)) continue
    const url = dav.fileUrl(name, MEDIA_FOLDER)
    if (!photos.upload) {
      await dav.put(url, await photos.read(name), contentType(name))
      continue
    }
    const status = await photos.upload(name, url, { ...dav.headers(), 'Content-Type': contentType(name) })
    if (status === 401 || status === 403) throw new WebDavError(status, 'authentication failed')
    if (status < 200 || status >= 300) throw new WebDavError(status, `PUT ${url} → HTTP ${status}`)
  }
}

// A photo another device uploaded, fetched into `photos` when it is first shown here; false when the server lacks it.
export async function downloadPhoto(dav: WebDav, photos: MediaFiles, name: string): Promise<boolean> {
  const url = dav.fileUrl(name, MEDIA_FOLDER)
  if (!photos.download) {
    const bytes = await dav.get(url).catch((error: unknown) => {
      if (error instanceof WebDavError && error.status === 404) return null
      throw error
    })
    if (bytes) await photos.write(name, bytes)
    return !!bytes
  }
  const status = await photos.download(name, url, dav.headers())
  if (status === 404) return false
  if (status === 401 || status === 403) throw new WebDavError(status, 'authentication failed')
  if (status !== 200) throw new WebDavError(status, `GET ${url} → HTTP ${status}`)
  return true
}
