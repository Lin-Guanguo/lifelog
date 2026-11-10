import type { LogRecord, Records } from '../data/records'
import { fromSqliteFile, toSqliteFile } from '../data/snapshot'
import { photosOf } from '../media/content'
import { contentType, type MediaFiles } from '../media/files'
import type { WebDav } from './webdav'

// The server keeps one standard SQLite snapshot of the log, and the photo copies in media/.
export const REMOTE_FILE = 'lifelog.sqlite'
export const MEDIA_FOLDER = 'media'
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
  // Nothing new here: adopt the remote version. Uploading anyway would make two devices
  // take turns re-uploading the same data.
  if (remote !== null && !dirty && !merged) {
    return { state: { remoteVersion: remote, lastSyncAt: now }, merged, uploaded: false }
  }

  if (remote === null) await dav.ensureDirectory()
  beforeUpload()
  const rows = await records.all()
  // Photos first, so a database on the server never references a photo that is not there.
  if (photos) await uploadPhotos(dav, rows, photos)
  // A plain PUT over the file. Uploading to a temporary name and moving it over the target is not
  // portable: Nutstore (坚果云) rejects MOVE onto an existing file with 409 even with Overwrite: T.
  await dav.put(url, await toSqliteFile(rows))
  // v0.2.0–0.2.2 uploaded via a temporary file that could be left behind; clean it up.
  await dav.remove(dav.fileUrl(LEGACY_TEMP_FILE)).catch(() => {})
  return { state: { remoteVersion: (await dav.version(url)) ?? undefined, lastSyncAt: now }, merged, uploaded: true }
}

// Uploads the copies this device has of photos that rows reference and the server lacks. A copy is
// never changed once written, so presence by name is enough.
async function uploadPhotos(dav: WebDav, rows: LogRecord[], photos: MediaFiles): Promise<void> {
  const inUse = new Set(rows.filter((r) => r.purged_at === null).flatMap((r) => photosOf(r.content).map((p) => p.file)))
  const here = (await photos.list()).filter((name) => inUse.has(name))
  if (here.length === 0) return
  let remote = await dav.list(dav.folderUrl(MEDIA_FOLDER))
  if (remote === null) {
    await dav.ensureFolder(MEDIA_FOLDER)
    remote = []
  }
  const there = new Set(remote.map((f) => f.name))
  for (const name of here) {
    if (!there.has(name)) await dav.put(dav.fileUrl(name, MEDIA_FOLDER), await photos.read(name), contentType(name))
  }
}

// A photo copy another device uploaded, fetched when it is first shown here.
export function downloadPhoto(dav: WebDav, name: string): Promise<Uint8Array> {
  return dav.get(dav.fileUrl(name, MEDIA_FOLDER))
}
