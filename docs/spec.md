# LifeLog v1 spec

A local-first Android app for logging short, timestamped lines (workouts, thoughts, anything).
Entries are stored raw; organizing them is left to CyberMnema later.

## Data

One SQLite table. Content is never modified in place.

```sql
CREATE TABLE records (
  id          TEXT PRIMARY KEY,   -- one row per saved text
  entry_id    TEXT NOT NULL,      -- shared by an entry and all its edits
  logged_at   INTEGER NOT NULL,   -- original time (ms), copied on edit
  content     TEXT NOT NULL,
  written_at  INTEGER NOT NULL,   -- when this row was saved
  deleted_at  INTEGER             -- NULL = live; set = in the trash
);
-- at most one live row per entry
CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL;
```

| Action | Effect |
|---|---|
| Send | insert a row |
| Edit | one transaction: soft-delete the live row, insert a new row with the same `entry_id` and `logged_at` |
| Delete (sheet, full view, multi-select) | soft-delete the entry's live row |
| Restore (trash) | clear `deleted_at`; if the entry has a live row, it is soft-deleted first after an overwrite prompt. One row per entry per restore |
| Delete forever (trash) | `DELETE` the selected trashed rows |
| Auto-clear | on start and resume, delete rows trashed longer than the retention (1 / 7 / 30 days / never; default 7) |
| Search | `LIKE '%q%'` on live rows; trash search on trashed rows. `%`, `_` and `!` are escaped |

Settings (retention, language) live in Capacitor Preferences, not in the table.

## Screens

- **Main**: chat-style stream, oldest at top, newest at the bottom above the composer; grouped by day; long text clamped to 3 lines.
  - Tap: half-screen sheet with the full text and three icons (full screen, edit, delete with confirmation).
  - Long-press: multi-select; tap more rows; delete moves them to the trash.
  - "LifeLog ›" opens Settings; the search icon opens Search.
- **Full screen view**: full text, edit and delete.
- **Edit**: explicit Save; leaving with changes (back arrow or Android back) asks Save / Discard / Keep editing. Unchanged text saves nothing.
- **Search**: highlighted matches grouped by day; tap opens the sheet.
- **Settings**: language (system / 中文 / English), sync placeholder, trash auto-clear period, trash entry at the bottom.
- **Trash**: search box; cards grouped by entry (current text shown for reference); rows show original/saved time and days left; select rows or whole entries; restore or delete forever.

## Internationalization

All UI text lives in `src/i18n/<locale>.ts`; `zh-CN` is the source catalog and other locales are type-checked against it.
Dates use `Intl.DateTimeFormat` with the active locale.

## Not in v1

- WebDAV sync (planned: one JSON file per day; the phone is the only writer, so each day file replaces the previous one).
- Swipe-down to close the sheet (tap outside or Android back instead).
- Context lines around search matches.
