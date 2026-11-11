// LifeLog data access from a computer: fetch the app's SQLite file from WebDAV and query it.
// Run `pnpm --silent lifelog help` for usage. Never writes to the server; queries never modify local files.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import initSqlJs from 'sql.js'

const USAGE = `usage: pnpm --silent lifelog <command> [options]

commands
  pull                   download the WebDAV file to a local SQLite file
  info                   schema version, counts, first and last entry
  list                   entries in time order (default: the latest 50)
  search <text>          entries containing <text> (case-insensitive for ASCII)
  sql "<query>"          run SQL against the local file; changes are never saved
  photos                 photo files on the server (<directory>/media/) against the photos entries reference
                         in the local file (pull first): referenced, missing on the server, not referenced, and
                         files whose size differs from the bytes their photo line records

options
  --db <path>            local SQLite file to read, or to write with pull (default .data/lifelog.sqlite)
  --out <path>           pull: save to this path instead of --db
  --remote <path>        pull: remote file relative to LIFELOG_WEBDAV_URL
                         (default <LIFELOG_WEBDAV_DIRECTORY>/lifelog.sqlite)
  --env <path>           settings file (default .env; see .env.example)
  --from <date>          list/search: from this local date/time, e.g. 2026-11-01, "2026-11-01 08:00", today, yesterday
  --to <date>            list/search: up to the end of this local date (or exactly this time if one is given)
  --limit <n>            list/search: at most n entries (the latest ones)
  --trash                list/search: trashed rows only
  --all                  list/search: live and trashed rows (never purged ones: their text is erased)
  --json                 machine-readable output

table: records(id, entry_id, logged_at, content, written_at, deleted_at, purged_at); times are epoch ms;
ids are integers (schema v2; text UUIDs in older files).
An entry is all rows sharing entry_id; deleted_at IS NULL marks its current text.
purged_at set = permanently deleted: content is '' and the row is only kept for sync.`

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: 'string', default: '.data/lifelog.sqlite' },
    out: { type: 'string' },
    remote: { type: 'string' },
    env: { type: 'string', default: '.env' },
    from: { type: 'string' },
    to: { type: 'string' },
    limit: { type: 'string' },
    trash: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
})
const [command, ...args] = positionals

function webdav() {
  if (existsSync(opt.env)) process.loadEnvFile(opt.env)
  const env = (key, fallback) => {
    const value = process.env[key] ?? fallback
    if (!value) throw new Error(`${key} is not set (copy .env.example to .env)`)
    return value
  }
  return {
    url: env('LIFELOG_WEBDAV_URL').replace(/\/*$/, '/'),
    auth: `Basic ${Buffer.from(`${env('LIFELOG_WEBDAV_USERNAME')}:${env('LIFELOG_WEBDAV_PASSWORD')}`).toString('base64')}`,
    directory: env('LIFELOG_WEBDAV_DIRECTORY', 'lifelog'),
  }
}

// Photo lines in entry text: ![](media/<key>.<ext> "…") (docs/spec.md → Photos).
const EXT = 'jpg|png|webp|heic|avif|gif'
const PHOTO = new RegExp(`^!\\[[^\\]]*\\]\\(media\\/([0-9a-f]{32}\\.(?:${EXT}))(?: "(?:[^"\\\\]|\\\\.)*")?\\)$`, 'gm')

async function photos() {
  const db = await open()
  const hasPurged = query(db, 'PRAGMA table_info(records)').some((c) => c.name === 'purged_at')
  const rows = query(db, `SELECT content, deleted_at FROM records WHERE ${hasPurged ? 'purged_at IS NULL' : '1'} AND content LIKE '%](media/%'`)
  const live = new Set()
  const trash = new Set()
  // file → bytes its photo line records, when the line describes the stored file itself (0.4.4+ originals). 0.4.3 lines
  // describe the original while the stored file is a .webp copy: their format does not match the file type.
  const recorded = new Map()
  for (const r of rows) {
    for (const [line, file] of String(r.content).matchAll(PHOTO)) {
      ;(r.deleted_at === null ? live : trash).add(file)
      const bytes = / bytes=(\d+)/.exec(line)?.[1]
      const format = / format=(\w+)/.exec(line)?.[1]
      const ext = file.split('.').pop()
      if (bytes && format && (format === ext || (format === 'jpeg' && ext === 'jpg'))) recorded.set(file, Number(bytes))
    }
  }

  const { url, auth, directory } = webdav()
  const folder = url + [...directory.split('/').filter(Boolean), 'media'].map(encodeURIComponent).join('/') + '/'
  const res = await fetch(folder, { method: 'PROPFIND', headers: { Authorization: auth, Depth: '1' } })
  if (res.status === 401 || res.status === 403) throw new Error(`authentication failed (HTTP ${res.status})`)
  if (res.status !== 207 && res.status !== 404) throw new Error(`PROPFIND ${folder} → HTTP ${res.status}`)
  // name → size in bytes, from each <response> of the listing
  const sizes = new Map()
  if (res.status !== 404) {
    for (const [response] of (await res.text()).matchAll(/<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/gi)) {
      const href = /<(?:[\w-]+:)?href>([^<]*)</i.exec(response)?.[1] ?? ''
      const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').pop() ?? '')
      if (new RegExp(`^[0-9a-f]{32}\\.(${EXT})$`).test(name)) {
        sizes.set(name, Number(/<(?:[\w-]+:)?getcontentlength>(\d+)</i.exec(response)?.[1] ?? NaN))
      }
    }
  }
  const onServer = new Set(sizes.keys())
  const referenced = new Set([...live, ...trash])
  const result = {
    folder,
    onServer: onServer.size,
    referencedByEntries: live.size,
    referencedOnlyByTrash: [...trash].filter((f) => !live.has(f)).length,
    missingOnServer: [...referenced].filter((f) => !onServer.has(f)),
    notReferenced: [...onServer].filter((f) => !referenced.has(f)),
    sizeDiffers: [...recorded].filter(([f, n]) => sizes.has(f) && sizes.get(f) !== n).map(([f, n]) => ({ file: f, recorded: n, onServer: sizes.get(f) })),
    sizes: Object.fromEntries(sizes),
  }
  print(result, () => `${folder}\n${result.onServer} on the server; entries reference ${result.referencedByEntries}`
    + ` (+${result.referencedOnlyByTrash} only from the trash)\nmissing on the server: ${result.missingOnServer.length}`
    + `${result.missingOnServer.map((f) => `\n  ${f}`).join('')}\nnot referenced: ${result.notReferenced.length}`
    + `${result.notReferenced.map((f) => `\n  ${f}`).join('')}`
    + `\nsize differs from the photo line: ${result.sizeDiffers.length}`
    + `${result.sizeDiffers.map((d) => `\n  ${d.file}: line ${d.recorded}, server ${d.onServer}`).join('')}`
    + [...sizes].map(([f, n]) => `\n  ${f}  ${n} bytes`).join(''))
}

async function pull() {
  const { url, auth, directory } = webdav()
  const remotePath = opt.remote ?? `${directory}/lifelog.sqlite`
  const remote = url + remotePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  const res = await fetch(remote, { headers: { Authorization: auth } })
  if (res.status === 401 || res.status === 403) throw new Error(`authentication failed (HTTP ${res.status})`)
  if (res.status === 404) throw new Error(`not found: ${remote}`)
  if (!res.ok) throw new Error(`GET ${remote} → HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('the remote file is not a SQLite database')

  // Replace the local copy only once the download is complete.
  const out = opt.out ?? opt.db
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(`${out}.part`, bytes)
  renameSync(`${out}.part`, out)
  print({ remote, local: out, bytes: bytes.length, lastModified: res.headers.get('last-modified') },
    () => `${remote}\n→ ${out} (${bytes.length} bytes)`)
}

let SQL
async function open() {
  if (!existsSync(opt.db)) throw new Error(`${opt.db} not found: run "pnpm --silent lifelog pull" first`)
  SQL ??= await initSqlJs()
  return new SQL.Database(readFileSync(opt.db))
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

function entries(db, contains) {
  // Older files (schema v1) have no purged_at column.
  const hasPurged = query(db, 'PRAGMA table_info(records)').some((c) => c.name === 'purged_at')
  const notPurged = hasPurged ? 'purged_at IS NULL' : '1'
  const where = [notPurged, opt.all ? '1' : opt.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
  const params = []
  if (contains !== undefined) {
    where.push("content LIKE ? ESCAPE '!'")
    params.push(`%${contains.replace(/[!%_]/g, (c) => `!${c}`)}%`)
  }
  if (opt.from) { where.push('logged_at >= ?'); params.push(parseTime(opt.from)) }
  if (opt.to) { where.push('logged_at <= ?'); params.push(parseTime(opt.to, true)) }
  // Without a range or explicit limit, show the latest 50.
  const limit = opt.limit ? Number(opt.limit) : opt.from || opt.to ? -1 : 50
  const rows = query(db, `SELECT * FROM (SELECT * FROM records WHERE ${where.join(' AND ')}
    ORDER BY logged_at DESC, id DESC LIMIT ?) ORDER BY logged_at, id`, [...params, limit])
  print(rows.map((r) => ({ ...r, logged: localTime(r.logged_at), trashed: r.deleted_at !== null })),
    () => rows.map((r) => `${localTime(r.logged_at)}${r.deleted_at !== null ? ' [trash]' : ''}  ${String(r.content).replace(/\n/g, '\n                  ')}`).join('\n')
      || '(no entries)')
}

async function main() {
  switch (command) {
    case 'pull':
      return pull()
    case 'info': {
      const db = await open()
      const purged = query(db, 'PRAGMA table_info(records)').some((c) => c.name === 'purged_at') ? 'purged_at' : 'NULL'
      const [r] = query(db, `SELECT
        (SELECT COUNT(*) FROM records WHERE deleted_at IS NULL) AS live,
        (SELECT COUNT(*) FROM records WHERE deleted_at IS NOT NULL AND ${purged} IS NULL) AS trashed,
        (SELECT COUNT(*) FROM records WHERE ${purged} IS NOT NULL) AS purged,
        (SELECT MIN(logged_at) FROM records WHERE deleted_at IS NULL) AS first,
        (SELECT MAX(logged_at) FROM records WHERE deleted_at IS NULL) AS last`)
      const info = { file: opt.db, fetched: statSync(opt.db).mtime.toISOString(), schemaVersion: query(db, 'PRAGMA user_version')[0].user_version,
        ...r, first: r.first && localTime(r.first), last: r.last && localTime(r.last) }
      return print(info, () => `${info.file} (fetched ${localTime(Date.parse(info.fetched))}), schema v${info.schemaVersion}\n`
        + `${info.live} live entries, ${info.trashed} in the trash, ${info.purged} purged${info.first ? `, ${info.first} … ${info.last}` : ''}`)
    }
    case 'list':
      return entries(await open())
    case 'search':
      if (!args[0]) throw new Error('search needs text: pnpm --silent lifelog search 卧推')
      return entries(await open(), args[0])
    case 'photos':
      return photos()
    case 'sql': {
      if (!args[0]) throw new Error('sql needs a query')
      const rows = query(await open(), args[0])
      return print(rows, () => rows.map((r) => Object.values(r).join('\t')).join('\n') || '(no rows)')
    }
    default:
      console.log(USAGE)
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
})
