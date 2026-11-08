// The web build's SQLite (jeep-sqlite) loads sql-wasm.wasm from /assets at runtime.
// sql.js is a transitive dependency, so resolve it from jeep-sqlite's location.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const fromApp = createRequire(import.meta.url)
const fromJeep = createRequire(fromApp.resolve('jeep-sqlite/package.json'))
mkdirSync('public/assets', { recursive: true })
copyFileSync(fromJeep.resolve('sql.js/dist/sql-wasm.wasm'), 'public/assets/sql-wasm.wasm')
