<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackHandler } from '../back'
import { timeLeft, type LogRecord } from '../data/records'
import { dateOf, formatRemaining, formatHours, timeOf } from '../format'
import { t } from '../i18n'
import { closeScreen, db, reloadLive, retentionHours } from '../store'
import AppIcon from '../components/AppIcon.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import HighlightText from '../components/HighlightText.vue'
import { photosOf, textOf } from '../media/content'

interface Group {
  entryId: number
  loggedAt: number
  current?: LogRecord
  rows: LogRecord[]
}

const query = ref('')
const trashed = ref<LogRecord[]>([])
const live = ref<LogRecord[]>([])
const selected = ref(new Set<number>())
const dialog = ref<'overwrite' | 'purge'>()
useBackHandler(closeScreen)

const groups = computed<Group[]>(() => {
  const current = new Map(live.value.map((r) => [r.entry_id, r]))
  const byEntry = new Map<number, Group>()
  for (const row of trashed.value) {
    let group = byEntry.get(row.entry_id)
    if (!group) {
      group = { entryId: row.entry_id, loggedAt: row.logged_at, current: current.get(row.entry_id), rows: [] }
      byEntry.set(row.entry_id, group)
    }
    group.rows.push(row)
  }
  return [...byEntry.values()]
})

const selectedRows = computed(() => trashed.value.filter((r) => selected.value.has(r.id)))
const oneRowPerEntry = computed(() => new Set(selectedRows.value.map((r) => r.entry_id)).size === selectedRows.value.length)
const overwrites = computed(() => selectedRows.value.filter((r) => live.value.some((l) => l.entry_id === r.entry_id)))
const allSelected = computed(() => trashed.value.length > 0 && trashed.value.every((r) => selected.value.has(r.id)))

async function load() {
  const result = await db().listTrash(query.value.trim())
  trashed.value = result.trashed
  live.value = result.live
  const visible = new Set(result.trashed.map((r) => r.id))
  selected.value = new Set([...selected.value].filter((id) => visible.has(id)))
}

let timer: number | undefined
watch(query, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(load, 150)
})

function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function groupState(group: Group): boolean {
  return group.rows.every((r) => selected.value.has(r.id))
}

function toggleGroup(group: Group) {
  const next = new Set(selected.value)
  const select = !groupState(group)
  for (const r of group.rows) {
    if (select) next.add(r.id)
    else next.delete(r.id)
  }
  selected.value = next
}

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(trashed.value.map((r) => r.id))
}

function rowLabel(row: LogRecord): string {
  return row.written_at === row.logged_at
    ? t('trash.original', { time: timeOf(row.written_at) })
    : t('trash.savedAt', { date: dateOf(row.written_at), time: timeOf(row.written_at) })
}

function rowTimeLeft(row: LogRecord): string | null {
  const ms = row.deleted_at === null ? null : timeLeft(row.deleted_at, retentionHours.value)
  return ms === null ? null : formatRemaining(ms)
}

function askRestore() {
  if (overwrites.value.length > 0) dialog.value = 'overwrite'
  else restore()
}

async function restore() {
  dialog.value = undefined
  await db().restore(selectedRows.value)
  selected.value = new Set()
  await Promise.all([load(), reloadLive()])
}

async function purge() {
  dialog.value = undefined
  await db().purge([...selected.value])
  selected.value = new Set()
  await load()
}

onMounted(load)
</script>

<template>
  <div class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="closeScreen"><AppIcon name="back" /></button>
      <h1>{{ t('trash.title') }}</h1>
      <button v-if="trashed.length" class="text-btn" type="button" @click="toggleAll">
        {{ allSelected ? t('common.deselectAll') : t('common.selectAll') }}
      </button>
    </header>
    <main class="scroll">
      <div class="search-field">
        <input v-model="query" type="search" enterkeyhint="search" :aria-label="t('trash.searchLabel')" :placeholder="t('trash.searchPlaceholder')">
      </div>
      <p class="hint">{{ retentionHours > 0 ? t('trash.retentionHint', { duration: formatHours(retentionHours) }) : t('trash.noCleanupHint') }}</p>
      <p v-if="trashed.length === 0" class="empty">{{ query.trim() ? t('trash.noMatch') : t('trash.empty') }}</p>

      <section v-for="group in groups" :key="group.entryId" class="card group">
        <label class="group-head">
          <input type="checkbox" :checked="groupState(group)" :aria-label="t('trash.selectEntry')" @change="toggleGroup(group)">
          <b>{{ t('trash.entryTitle', { date: dateOf(group.loggedAt), time: timeOf(group.loggedAt) }) }}</b>
          <span class="tag" :class="{ gone: !group.current }">{{ group.current ? t('trash.hasCurrent') : t('trash.wholeDeleted') }}</span>
        </label>
        <div v-if="group.current" class="current">
          <span class="current-label">{{ t('trash.current') }}</span> {{ textOf(group.current.content) }}
        </div>
        <label v-for="row in group.rows" :key="row.id" class="trow" :class="{ selected: selected.has(row.id) }">
          <input type="checkbox" :checked="selected.has(row.id)" @change="toggle(row.id)">
          <span class="trow-body">
            <span class="trow-meta">
              <span>{{ rowLabel(row) }}</span>
              <span v-if="rowTimeLeft(row) !== null" class="left">{{ t('trash.left', { duration: rowTimeLeft(row)! }) }}</span>
            </span>
            <span class="trow-text"><HighlightText :text="textOf(row.content)" :query="query.trim()" /></span>
            <span v-if="photosOf(row.content).length" class="trow-photos">{{ t('photo.count', { n: photosOf(row.content).length }) }}</span>
          </span>
        </label>
      </section>
    </main>

    <footer v-if="selected.size" class="footer-bar" style="flex-direction: column">
      <p v-if="!oneRowPerEntry" class="hint" style="margin: 0">{{ t('trash.oneRowPerEntry') }}</p>
      <div style="display: flex; gap: 8px">
        <button class="secondary" type="button" style="flex: 1; height: 48px" :disabled="!oneRowPerEntry" @click="askRestore">
          {{ t('trash.restoreN', { n: selected.size }) }}
        </button>
        <button class="danger" type="button" style="flex: 1; height: 48px" @click="dialog = 'purge'">
          {{ t('trash.purgeN', { n: selected.size }) }}
        </button>
      </div>
    </footer>

    <ConfirmDialog v-if="dialog === 'overwrite'" :title="t('trash.overwriteTitle')"
      :message="selectedRows.length === 1
        ? t('trash.overwriteOne', { date: dateOf(selectedRows[0].logged_at), time: timeOf(selectedRows[0].logged_at) })
        : t('trash.overwriteMany', { n: overwrites.length })"
      @cancel="dialog = undefined">
      <div v-if="selectedRows.length === 1" class="compare">
        <small>{{ t('trash.current') }}</small>
        <div>{{ textOf(live.find((l) => l.entry_id === selectedRows[0].entry_id)?.content ?? '') }}</div>
        <small>{{ t('trash.restoreAs') }}</small>
        <div>{{ textOf(selectedRows[0].content) }}</div>
      </div>
      <template #actions>
        <button class="secondary" type="button" @click="dialog = undefined">{{ t('common.cancel') }}</button>
        <button class="primary" type="button" @click="restore">{{ t('trash.overwrite') }}</button>
      </template>
    </ConfirmDialog>
    <ConfirmDialog v-if="dialog === 'purge'" :title="t('trash.purgeTitle', { n: selected.size })" :message="t('trash.purgeMessage')"
      @cancel="dialog = undefined">
      <template #actions>
        <button class="secondary" type="button" @click="dialog = undefined">{{ t('common.cancel') }}</button>
        <button class="danger" type="button" @click="purge">{{ t('trash.purgeN', { n: selected.size }) }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.group { margin-top: 12px; }
.group-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.group-head b { flex-grow: 1; font-size: 14px; min-width: 0; }
.tag { font-size: 11px; color: var(--muted); background: var(--chip); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.tag.gone { color: var(--danger); }
.current { padding: 8px 14px 8px 44px; background: var(--ground); font-size: 13px; color: var(--muted); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.current-label { font-size: 11px; font-weight: 600; color: var(--ok); }
.trow { display: flex; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); align-items: flex-start; }
.trow:last-child { border-bottom: 0; }
.trow.selected { background: var(--accent-soft); }
.trow-body { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.trow-meta { display: flex; gap: 8px; font-size: 12px; color: var(--muted); }
.trow-meta .left { margin-left: auto; color: var(--warn); flex-shrink: 0; }
.trow-photos { font-size: 12px; color: var(--muted); }
.trow-text { font-size: 15px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
