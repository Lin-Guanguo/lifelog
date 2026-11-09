import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { ID_EPOCH } from './ids'
import { createRecords } from './records'
import { migrate, NewerSchemaError, schemaVersion, SCHEMA_VERSION } from './schema'
import { fromSqliteFile, toSqliteFile } from './snapshot'
import { configureSqlJs, sqlJsExecutor } from './sqljs'

let SQL: SqlJsStatic
const T = Date.UTC(2026, 10, 9, 8)

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
    expect((await createRecords(db).all())[0].purged_at).toBeNull()
  })

  it('v2 converts text ids to integers deterministically and keeps every row', async () => {
    const v1 = () => {
      const raw = new SQL.Database()
      raw.exec(`CREATE TABLE records (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, logged_at INTEGER NOT NULL,
        content TEXT NOT NULL, written_at INTEGER NOT NULL, deleted_at INTEGER);
        CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL;
        PRAGMA user_version = 1;
        INSERT INTO records VALUES ('a1', 'ea', ${T}, 'first', ${T}, ${T + 5});
        INSERT INTO records VALUES ('a2', 'ea', ${T}, 'first, edited', ${T + 5}, NULL);
        INSERT INTO records VALUES ('b1', 'eb', ${T + 1}, 'deleted', ${T + 1}, ${T + 9});
        INSERT INTO records VALUES ('c2', 'ec', ${T + 2}, 'first row already purged', ${T + 7}, NULL);`)
      return raw
    }
    const migrated = async (raw: InstanceType<SqlJsStatic['Database']>) => {
      const db = sqlJsExecutor(raw)
      await migrate(db)
      expect(await schemaVersion(db)).toBe(2)
      return createRecords(db).all()
    }
    const rows = await migrated(v1())
    expect(rows.map((r) => [r.content, r.logged_at, r.written_at, r.deleted_at, r.purged_at])).toEqual([
      ['first', T, T, T + 5, null], ['first, edited', T, T + 5, null, null],
      ['deleted', T + 1, T + 1, T + 9, null], ['first row already purged', T + 2, T + 7, null, null],
    ])
    for (const r of rows) expect(Number.isSafeInteger(r.id) && Number.isSafeInteger(r.entry_id)).toBe(true)
    // an entry's id is its first row's id; edits share it
    expect(rows[0].entry_id).toBe(rows[0].id)
    expect(rows[1].entry_id).toBe(rows[0].id)
    expect(rows[2].entry_id).toBe(rows[2].id)
    // ids carry the row's time: ordered like the rows were written
    expect(Math.floor(rows[1].id / 4096)).toBe(T + 5 - ID_EPOCH)
    // the same old data converts to the same ids anywhere (phone, old backup on the server)
    expect(await migrated(v1())).toEqual(rows)
    // so merging a converted old backup into a converted phone adds nothing
    const phone = sqlJsExecutor(v1())
    await migrate(phone)
    expect(await createRecords(phone).merge(await fromSqliteFile(v1().export()))).toBe(false)
  })

  it('v2 starts over cleanly after an interrupted run', async () => {
    const raw = new SQL.Database()
    raw.exec(`CREATE TABLE records (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, logged_at INTEGER NOT NULL,
      content TEXT NOT NULL, written_at INTEGER NOT NULL, deleted_at INTEGER);
      PRAGMA user_version = 1;
      INSERT INTO records VALUES ('a1', 'ea', ${T}, 'kept', ${T}, NULL);
      CREATE TABLE records_v2 (id INTEGER PRIMARY KEY, junk TEXT);
      INSERT INTO records_v2 VALUES (1, 'left over');`)
    const db = sqlJsExecutor(raw)
    await migrate(db)
    expect((await createRecords(db).listLive()).map((r) => r.content)).toEqual(['kept'])
    expect(raw.exec("SELECT name FROM sqlite_master WHERE name = 'records_v2'")).toEqual([])
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

  it('merge adds missing rows, lets deletions win and keeps the later-written of two live texts', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    const records = createRecords(db, () => 100)
    await records.add('local')
    await records.add('deleted elsewhere')
    const [local, other] = await records.listLive()
    expect(await records.merge([
      { ...local, content: 'remote copy of the same id' },
      { ...other, deleted_at: 50 },
      { id: 900001, entry_id: 900001, logged_at: 5, content: 'remote only', written_at: 5, deleted_at: null, purged_at: null },
      // edited elsewhere before the local text was written: the local text stays live
      { id: 900002, entry_id: local.entry_id, logged_at: 1, content: 'edited elsewhere', written_at: 9, deleted_at: null, purged_at: null },
    ])).toBe(true)
    expect((await records.listLive()).map((r) => r.content).sort()).toEqual(['local', 'remote only'])
    const { trashed } = await records.listTrash()
    expect(trashed.map((r) => [r.content, r.deleted_at]).sort()).toEqual([['deleted elsewhere', 50], ['edited elsewhere', 100]])
    // a later-written remote text replaces the local one
    expect(await records.merge([
      { id: 900003, entry_id: local.entry_id, logged_at: 1, content: 'edited later', written_at: 200, deleted_at: null, purged_at: null },
    ])).toBe(true)
    expect((await records.listLive()).map((r) => r.content).sort()).toEqual(['edited later', 'remote only'])
    expect((await records.all()).find((r) => r.id === local.id)?.deleted_at).toBe(200)
    // nothing new: no change
    expect(await records.merge(await records.all())).toBe(false)
  })

  it('merge never moves a row backwards and erases text purged elsewhere', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    const records = createRecords(db, () => 100)
    await records.add('secret')
    await records.add('kept deleted')
    const [secret, kept] = await records.listLive()
    await records.trashEntries([kept.entry_id])
    const keptTrashed = (await records.all()).find((r) => r.id === kept.id)!
    await records.merge([
      { ...secret, deleted_at: 60, purged_at: 70, content: '' }, // purged on the other device
      { ...keptTrashed, deleted_at: null }, // an older live copy does not undelete it
    ])
    const all = await records.all()
    expect(all.find((r) => r.id === secret.id)).toMatchObject({ content: '', deleted_at: 60, purged_at: 70 })
    expect(all.find((r) => r.id === kept.id)).toMatchObject({ content: 'kept deleted', deleted_at: 100 })
    // and a tombstone here is not revived by a copy that still has the text
    await records.merge([{ ...secret, deleted_at: 60, purged_at: null }])
    expect((await records.all()).find((r) => r.id === secret.id)).toMatchObject({ content: '', purged_at: 70 })
    expect(new TextDecoder('latin1').decode(await toSqliteFile(await records.all()))).not.toContain('secret')
    // a malformed tombstone (purged but not deleted) never shows up as a live, empty entry
    await records.merge([{ id: 900001, entry_id: 900001, logged_at: 1, content: 'x', written_at: 1, deleted_at: null, purged_at: 5 }])
    expect((await records.listLive()).map((r) => r.content)).not.toContain('')
  })

  it('new ids continue above rows merged from another device', async () => {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    const records = createRecords(db, () => T, () => 0)
    await records.add('here')
    const [here] = await records.listLive()
    // another device made a row in the same millisecond with higher random bits
    await records.merge([{ id: here.id + 1, entry_id: here.id + 1, logged_at: T, content: 'there', written_at: T, deleted_at: null, purged_at: null }])
    await records.add('here again')
    expect((await records.listLive()).map((r) => r.content).sort()).toEqual(['here', 'here again', 'there'])
  })
})
