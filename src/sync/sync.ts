import type { Records } from '../data/records'
import { fromSqliteFile, toSqliteFile } from '../data/snapshot'
import type { WebDav } from './webdav'

// The server keeps one standard SQLite snapshot of the log.
export const REMOTE_FILE = 'lifelog.sqlite'
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
  beforeUpload: () => void = () => {}, now = Date.now()): Promise<SyncResult> {
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
  // A plain PUT over the file. Uploading to a temporary name and moving it over the target is not
  // portable: Nutstore (坚果云) rejects MOVE onto an existing file with 409 even with Overwrite: T.
  await dav.put(url, await toSqliteFile(await records.all()))
  // v0.2.0–0.2.2 uploaded via a temporary file that could be left behind; clean it up.
  await dav.remove(dav.fileUrl(LEGACY_TEMP_FILE)).catch(() => {})
  return { state: { remoteVersion: (await dav.version(url)) ?? undefined, lastSyncAt: now }, merged, uploaded: true }
}
