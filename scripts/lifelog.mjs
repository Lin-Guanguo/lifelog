// LifeLog data access from a computer: mirror the app's WebDAV folder (database and photos) and query it.
// Run `pnpm --silent lifelog help` for usage. Never writes to the server; queries never modify the database file.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import initSqlJs from 'sql.js'

const USAGE = `usage: pnpm --silent lifelog <command> [options]

commands
  sync                   mirror <LIFELOG_WEBDAV_DIRECTORY>/ into --dir in the same layout: lifelog.sqlite and
                         media/<key>.<ext> (photos already there are not downloaded again; nothing is deleted)
  info                   schema version, counts, first and last entry, photo files
  list [<text>]          entries in time order (default: the latest 50), only those containing <text> if given
                         (case-insensitive for ASCII)
  sql "<query>"          run SQL against the database; changes are never saved
  photos                 photo files against the photos entries reference: missing files, files no entry
                         references, and files whose size differs from the bytes their photo line records

Every command except sync and help syncs first; if that fails, it uses the local copy.

options
  --dir <path>           local mirror of the WebDAV folder (default data); a photo line's media/<key>.<ext>
                         is <dir>/media/<key>.<ext>
  --offline              do not sync first
  --env <path>           settings file (default .env; see .env.example)
  --from <date>          list: from this local date/time, e.g. 2026-11-01, "2026-11-01 08:00", today, yesterday
  --to <date>            list: up to the end of this local date (or exactly this time if one is given)
  --limit <n>            list: at most n entries (the latest ones)
  --trash                list: trashed rows only
  --all                  list: live and trashed rows (never purged ones: their text is erased)
  --json                 machine-readable output

table: records(id, entry_id, logged_at, content, written_at, deleted_at, purged_at); times are epoch ms;
ids are integers (schema v2+; text UUIDs in older files).
An entry is all rows sharing entry_id; deleted_at IS NULL marks its current text.
purged_at set = permanently deleted: content is '' and the row is only kept for sync.`

const { values: opt, positionals: [command, arg] } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: 'data' },
    offline: { type: 'boolean', default: false },
    env: { type: 'string', default: '.env' },
    from: { type: 'string' },
    to: { type: 'string' },
    limit: { type: 'string' },
    trash: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})

const DB = join(opt.dir, 'lifelog.sqlite')
const MEDIA = join(opt.dir, 'media')

// Photo lines in entry text: ![](media/<key>.<ext> "…") (docs/spec.md → Photos).
const EXT = 'jpg|png|webp|heic|avif|gif'
const PHOTO_LINE = new RegExp(`^!\\[[^\\]]*\\]\\(media\\/([0-9a-f]{32}\\.(?:${EXT}))(?: "(?:[^"\\\\]|\\\\.)*")?\\)$`, 'gm')
const PHOTO_FILE = new RegExp(`^[0-9a-f]{32}\\.(?:${EXT})$`)

// --- WebDAV (read-only) ---

function connect() {
  if (existsSync(opt.env)) process.loadEnvFile(opt.env)
  const env = (key, fallback) => {
    const value = process.env[key] ?? fallback
    if (!value) throw new Error(`${key} is not set (copy .env.example to .env)`)
    return value
  }
  const folder = env('LIFELOG_WEBDAV_URL').replace(/\/*$/, '/')
    + env('LIFELOG_WEBDAV_DIRECTORY', 'lifelog').split('/').filter(Boolean).map((s) => `${encodeURIComponent(s)}/`).join('')
  const auth = `Basic ${Buffer.from(`${env('LIFELOG_WEBDAV_USERNAME')}:${env('LIFELOG_WEBDAV_PASSWORD')}`).toString('base64')}`

  async function request(path, init = {}) {
    const res = await fetch(folder + path, { ...init, headers: { Authorization: auth, ...init.headers } })
    if (res.status === 401 || res.status === 403) throw new Error(`authentication failed (HTTP ${res.status})`)
    return res
  }
  const tag = (xml, name) => new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`, 'i').exec(xml)?.[1]

  return {
    folder,
    // Files directly in a subfolder ('' = the sync folder): name → { size, modified (ms, NaN if unknown) }.
    async list(path) {
      const res = await request(path, { method: 'PROPFIND', headers: { Depth: '1' } })
      if (res.status === 404) return new Map()
      if (res.status !== 207) throw new Error(`PROPFIND ${folder + path} → HTTP ${res.status}`)
      const files = new Map()
      for (const [xml] of (await res.text()).matchAll(/<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/gi)) {
        if (/<(?:[\w-]+:)?collection\b/i.test(xml)) continue
        const name = decodeURIComponent((tag(xml, 'href') ?? '').split('/').pop())
        files.set(name, { size: Number(tag(xml, 'getcontentlength') ?? NaN), modified: Date.parse(tag(xml, 'getlastmodified') ?? '') })
      }
      return files
    },
    // Downloads next to the target and renames, so an interrupted or rejected download never replaces the local file.
    // The local file takes the server's modification time, which marks it as that version.
    async download(path, to, modified, check = () => {}) {
      const res = await request(path)
      if (!res.ok) throw new Error(`GET ${folder + path} → HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      check(bytes)
      writeFileSync(`${to}.part`, bytes)
      if (Number.isFinite(modified)) utimesSync(`${to}.part`, new Date(), new Date(modified))
      renameSync(`${to}.part`, to)
      return bytes
    },
  }
}

// Mirrors the sync folder into --dir. The server never deletes photo files, so local ones are never deleted either.
async function sync() {
  const dav = connect()
  mkdirSync(MEDIA, { recursive: true })

  const remote = (await dav.list('')).get('lifelog.sqlite')
  if (!remote) throw new Error(`not found: ${dav.folder}lifelog.sqlite`)
  const local = existsSync(DB) && statSync(DB)
  const unchanged = local && local.size === remote.size && local.mtimeMs === remote.modified
  if (!unchanged) {
    await dav.download('lifelog.sqlite', DB, remote.modified, (bytes) => {
      if (bytes.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('the remote file is not a SQLite database')
    })
  }

  // Photo files never change once uploaded: a file of the same size (or any size, if the server gives none) is the same.
  const photos = [...await dav.list('media/')].filter(([name]) => PHOTO_FILE.test(name))
  const have = localPhotos()
  const missing = photos.filter(([name, { size }]) => !have.has(name) || (have.get(name) !== size && !Number.isNaN(size)))
  let bytes = 0
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async ([name, { modified }]) => {
      bytes += (await dav.download(`media/${encodeURIComponent(name)}`, join(MEDIA, name), modified)).length
    }))
  }
  return { from: dav.folder, to: opt.dir, database: unchanged ? 'unchanged' : 'updated', uploaded: uploaded(),
    photos: photos.length, photosDownloaded: missing.length, bytesDownloaded: bytes }
}

const syncText = (r) => `${r.from} → ${r.to}\ndatabase ${r.database} (uploaded ${r.uploaded}); ${r.photos} photos, `
  + `${r.photosDownloaded} downloaded (${(r.bytesDownloaded / 1e6).toFixed(1)} MB)`

// Before a query: sync unless --offline; if that fails, carry on with an existing local copy.
async function refresh() {
  if (opt.offline) return
  try {
    const r = await sync()
    if (r.database === 'updated' || r.photosDownloaded) console.error(syncText(r))
  } catch (error) {
    if (!existsSync(DB)) throw error
    console.error(`sync failed (${error.message}); using the local copy uploaded ${uploaded()}`)
  }
}

// --- local mirror ---

// The database file keeps the server's modification time: when the app last uploaded it.
const uploaded = () => localTime(statSync(DB).mtimeMs)

// name → size in bytes of the mirrored photo files
function localPhotos() {
  if (!existsSync(MEDIA)) return new Map()
  return new Map(readdirSync(MEDIA).filter((name) => PHOTO_FILE.test(name)).map((name) => [name, statSync(join(MEDIA, name)).size]))
}

let SQL
async function open() {
  if (!existsSync(DB)) throw new Error(`${DB} not found: run "pnpm --silent lifelog sync" first`)
  SQL ??= await initSqlJs()
  const db = new SQL.Database(readFileSync(DB))
  // Older files (schema v1) have no purged_at column.
  const purged = query(db, 'PRAGMA table_info(records)').some((c) => c.name === 'purged_at') ? 'purged_at' : 'NULL'
  return { db, notPurged: `${purged} IS NULL` }
}

function query(db, sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function print(data, text) {
  console.log(opt.json ? JSON.stringify(data, null, 2) : text())
}

const pad = (n) => String(n).padStart(2, '0')
function localTime(ms) {
  const d = new Date(Number(ms))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Local date or date-time → epoch ms. `end` moves a bare date to the end of that day.
function parseTime(text, end = false) {
  const now = new Date()
  const day = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const named = { today: day(0), yesterday: day(-1) }[text]
  const match = named ? null : /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text)
  if (!named && !match) throw new Error(`cannot read the time "${text}" (use YYYY-MM-DD, "YYYY-MM-DD HH:MM", today or yesterday)`)
  const start = named ?? new Date(+match[1], +match[2] - 1, +match[3], +(match[4] ?? 0), +(match[5] ?? 0))
  const timed = match?.[4] !== undefined
  return end && !timed ? start.getTime() + 86_400_000 - 1 : start.getTime()
}

// --- commands ---

async function info() {
  const { db, notPurged } = await open()
  const [counts] = query(db, `SELECT
    (SELECT COUNT(*) FROM records WHERE deleted_at IS NULL) AS live,
    (SELECT COUNT(*) FROM records WHERE deleted_at IS NOT NULL AND ${notPurged}) AS trashed,
    (SELECT COUNT(*) FROM records WHERE NOT (${notPurged})) AS purged,
    (SELECT MIN(logged_at) FROM records WHERE deleted_at IS NULL) AS first,
    (SELECT MAX(logged_at) FROM records WHERE deleted_at IS NULL) AS last`)
  const r = { file: DB, uploaded: uploaded(), schemaVersion: query(db, 'PRAGMA user_version')[0].user_version,
    ...counts, first: counts.first && localTime(counts.first), last: counts.last && localTime(counts.last),
    photoFiles: localPhotos().size }
  print(r, () => `${r.file} (uploaded ${r.uploaded}), schema v${r.schemaVersion}\n`
    + `${r.live} live entries, ${r.trashed} in the trash, ${r.purged} purged${r.first ? `, ${r.first} … ${r.last}` : ''}\n`
    + `${r.photoFiles} photo files in ${MEDIA}`)
}

async function list(text) {
  const { db, notPurged } = await open()
  const where = [notPurged, opt.all ? '1' : opt.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
  const params = []
  if (text !== undefined) {
    where.push("content LIKE ? ESCAPE '!'")
    params.push(`%${text.replace(/[!%_]/g, (c) => `!${c}`)}%`)
  }
  if (opt.from) { where.push('logged_at >= ?'); params.push(parseTime(opt.from)) }
  if (opt.to) { where.push('logged_at <= ?'); params.push(parseTime(opt.to, true)) }
  // Without a range or explicit limit, show the latest 50.
  const limit = opt.limit ? Number(opt.limit) : opt.from || opt.to ? -1 : 50
  const rows = query(db, `SELECT * FROM (SELECT * FROM records WHERE ${where.join(' AND ')}
    ORDER BY logged_at DESC, id DESC LIMIT ?) ORDER BY logged_at, id`, [...params, limit])
  print(rows.map((r) => ({ ...r, logged: localTime(r.logged_at), trashed: r.deleted_at !== null })),
    () => rows.map((r) => `${localTime(r.logged_at)}${r.deleted_at !== null ? ' [trash]' : ''}  `
      + String(r.content).replace(/\n/g, '\n                  ')).join('\n') || '(no entries)')
}

async function sql(text) {
  if (!text) throw new Error('sql needs a query: pnpm --silent lifelog sql "SELECT COUNT(*) FROM records"')
  const rows = query((await open()).db, text)
  print(rows, () => rows.map((r) => Object.values(r).join('\t')).join('\n') || '(no rows)')
}

async function photos() {
  const { db, notPurged } = await open()
  const live = new Set()
  const trash = new Set()
  // file → bytes its photo line records, when the line describes the stored file itself (0.4.4+ originals). 0.4.3 lines
  // describe the original while the stored file is a .webp copy: their format does not match the file type.
  const recorded = new Map()
  for (const r of query(db, `SELECT content, deleted_at FROM records WHERE ${notPurged} AND content LIKE '%](media/%'`)) {
    for (const [line, file] of String(r.content).matchAll(PHOTO_LINE)) {
      ;(r.deleted_at === null ? live : trash).add(file)
      const bytes = / bytes=(\d+)/.exec(line)?.[1]
      const format = / format=(\w+)/.exec(line)?.[1]
      const ext = file.split('.').pop()
      if (bytes && format && (format === ext || (format === 'jpeg' && ext === 'jpg'))) recorded.set(file, Number(bytes))
    }
  }

  const sizes = localPhotos()
  const referenced = new Set([...live, ...trash])
  const r = {
    folder: MEDIA,
    files: sizes.size,
    referencedByEntries: live.size,
    referencedOnlyByTrash: [...trash].filter((f) => !live.has(f)).length,
    missing: [...referenced].filter((f) => !sizes.has(f)),
    notReferenced: [...sizes.keys()].filter((f) => !referenced.has(f)),
    sizeDiffers: [...recorded].filter(([f, n]) => sizes.has(f) && sizes.get(f) !== n)
      .map(([f, n]) => ({ file: f, recorded: n, size: sizes.get(f) })),
    sizes: Object.fromEntries(sizes),
  }
  const section = (title, items) => `\n${title}: ${items.length}${items.map((item) => `\n  ${item}`).join('')}`
  print(r, () => `${r.folder}: ${r.files} files; entries reference ${r.referencedByEntries}`
    + ` (+${r.referencedOnlyByTrash} only from the trash)`
    + section('missing', r.missing)
    + section('not referenced', r.notReferenced)
    + section('size differs from the photo line', r.sizeDiffers.map((d) => `${d.file}: line ${d.recorded}, file ${d.size}`)))
}

const COMMANDS = { info, list, sql, photos }

async function main() {
  if (command === 'sync') {
    const r = await sync()
    return print(r, () => syncText(r))
  }
  if (!COMMANDS[command]) {
    console.log(USAGE)
    if (command && command !== 'help') throw new Error(`unknown command "${command}"`)
    return
  }
  await refresh()
  return COMMANDS[command](arg)
}

main().catch((error) => {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
})
