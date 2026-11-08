// Fetch and read the app's WebDAV backup on this machine.
//   node scripts/backup.mjs pull        download <folder>/lifelog.sqlite to .data/lifelog.sqlite
//   node scripts/backup.mjs show [N]    print a summary and the latest N live entries (default 20)
// Settings come from .env (see .env.example). The download is read-only on the server.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import initSqlJs from 'sql.js'

const LOCAL = '.data/lifelog.sqlite'

function config() {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const env = (key, fallback) => {
    const value = process.env[key] ?? fallback
    if (!value) throw new Error(`${key} is not set (copy .env.example to .env)`)
    return value
  }
  return {
    url: env('LIFELOG_WEBDAV_URL').replace(/\/*$/, '/'),
    username: env('LIFELOG_WEBDAV_USERNAME'),
    password: env('LIFELOG_WEBDAV_PASSWORD'),
    directory: env('LIFELOG_WEBDAV_DIRECTORY', 'lifelog').split('/').filter(Boolean),
  }
}

async function pull() {
  const { url, username, password, directory } = config()
  const remote = url + [...directory, 'lifelog.sqlite'].map(encodeURIComponent).join('/')
  const res = await fetch(remote, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  })
  if (res.status === 401 || res.status === 403) throw new Error(`authentication failed (HTTP ${res.status})`)
  if (res.status === 404) throw new Error(`no backup at ${remote} yet: sync from the app first`)
  if (!res.ok) throw new Error(`GET ${remote} → HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('the remote file is not a SQLite database')

  // Replace the local copy only once the download is complete.
  mkdirSync('.data', { recursive: true })
  writeFileSync(`${LOCAL}.part`, bytes)
  renameSync(`${LOCAL}.part`, LOCAL)
  console.log(`${remote}\n→ ${LOCAL} (${bytes.length} bytes, modified ${res.headers.get('last-modified') ?? 'unknown'})`)
}

async function show(limit) {
  if (!existsSync(LOCAL)) throw new Error(`${LOCAL} not found: run "pnpm backup:pull" first`)
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(LOCAL))
  const one = (sql) => db.exec(sql)[0]?.values[0][0]
  const time = (ms) => new Date(Number(ms)).toLocaleString('sv-SE').slice(0, 16)
  console.log(`schema v${one('PRAGMA user_version')}: ${one('SELECT COUNT(*) FROM records WHERE deleted_at IS NULL')} live entries, `
    + `${one('SELECT COUNT(*) FROM records WHERE deleted_at IS NOT NULL')} in the trash`)
  const rows = db.exec(`SELECT logged_at, content FROM records WHERE deleted_at IS NULL ORDER BY logged_at DESC LIMIT ${limit}`)[0]?.values ?? []
  for (const [loggedAt, content] of rows.reverse()) console.log(`${time(loggedAt)}  ${String(content).replace(/\n/g, '\n                  ')}`)
  db.close()
}

const [command, arg] = process.argv.slice(2)
try {
  if (command === 'pull') await pull()
  else if (command === 'show') await show(Math.max(1, Number(arg) || 20))
  else console.log('usage: node scripts/backup.mjs pull | show [N]')
} catch (error) {
  console.error(`error: ${error.message}`)
  process.exitCode = 1
}
