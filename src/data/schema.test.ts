import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createRecords } from './records'
import { migrate, NewerSchemaError, schemaVersion, SCHEMA_VERSION } from './schema'
import { fromSqliteFile, toSqliteFile } from './snapshot'
import { configureSqlJs, sqlJsExecutor } from './sqljs'

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs()
  configureSqlJs(async () => SQL)
})

describe('migrate', () => {
  it('creates the current schema on an empty database and records its version', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    expect(await schemaVersion(db)).toBe(SCHEMA_VERSION)
    const tables = await db.query("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['records', 'records_one_live', 'records_timeline']))
  })

  it('is a no-op when already current', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    await createRecords(db).add('kept')
    await migrate(db)
    expect((await createRecords(db).listLive()).map((r) => r.content)).toEqual(['kept'])
  })

  it('upgrades a database created before versioning without touching its rows', async () => {
    const raw = new SQL.Database()
    // v0.1.0 created the table and indexes directly and left user_version at 0.
    raw.exec(`CREATE TABLE records (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, logged_at INTEGER NOT NULL,
      content TEXT NOT NULL, written_at INTEGER NOT NULL, deleted_at INTEGER);
      CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL;
      INSERT INTO records VALUES ('r1', 'e1', 1, '旧数据', 1, NULL);`)
    const db = sqlJsExecutor(raw)
    expect(await schemaVersion(db)).toBe(0)
    await migrate(db)
    expect(await schemaVersion(db)).toBe(SCHEMA_VERSION)
    expect((await createRecords(db).listLive()).map((r) => r.content)).toEqual(['旧数据'])
  })

  it('refuses a database from a newer app version', async () => {
    const raw = new SQL.Database()
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    await expect(migrate(sqlJsExecutor(raw))).rejects.toBeInstanceOf(NewerSchemaError)
  })
})

describe('snapshot', () => {
  it('round-trips live and trashed rows through a standard SQLite file', async () => {
    const source = sqlJsExecutor(new SQL.Database())
    await migrate(source)
    const records = createRecords(source)
    await records.add('a')
    await records.add('b')
    const [a] = await records.listLive()
    await records.edit(a, 'a2')

    const bytes = await toSqliteFile(await records.all())
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3')

    // Readable by plain SQLite, with the schema version set.
    const plain = new SQL.Database(bytes)
    expect(plain.exec('PRAGMA user_version')[0].values[0][0]).toBe(SCHEMA_VERSION)
    plain.close()

    const rows = await fromSqliteFile(bytes)
    expect(rows).toEqual(await records.all())
  })

  it('rejects a snapshot written by a newer app version', async () => {
    const raw = new SQL.Database()
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    await expect(fromSqliteFile(raw.export())).rejects.toBeInstanceOf(NewerSchemaError)
  })

  it('merge adds missing rows, lets deletions win and moves competing live texts to the trash', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    const records = createRecords(db, () => 100)
    await records.add('local')
    await records.add('deleted elsewhere')
    const [local, other] = await records.listLive()
    await records.merge([
      { ...local, content: 'remote copy of the same id' },
      { ...other, deleted_at: 50 },
      { id: 'x', entry_id: 'ex', logged_at: 5, content: 'remote only', written_at: 5, deleted_at: null },
      // edited on the other device: a second live text for the local entry
      { id: 'y', entry_id: local.entry_id, logged_at: 1, content: 'edited elsewhere', written_at: 9, deleted_at: null },
    ])
    expect((await records.listLive()).map((r) => r.content).sort()).toEqual(['local', 'remote only'])
    const { trashed } = await records.listTrash()
    expect(trashed.map((r) => [r.content, r.deleted_at]).sort()).toEqual([['deleted elsewhere', 50], ['edited elsewhere', 100]])
  })
})
