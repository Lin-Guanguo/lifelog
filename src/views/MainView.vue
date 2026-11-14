<script setup lang="ts">
import { Clipboard } from '@capacitor/clipboard'
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { pushBackHandler } from '../back'
import { chooseTime, clearDraft, draft, importPhotos, isOld, offerPhotoTimes, showNotice } from '../compose'
import type { LogRecord } from '../data/records'
import { groupByDay, logTime, secondsOf, timeOf } from '../format'
import { t } from '../i18n'
import { composeContent, photosOf, takenAt, textOf, type PhotoRef } from '../media/content'
import type { PhotoSource } from '../media/photos'
import { db, locateRequest, logChanged, logVersion, openScreen, screens, sent } from '../store'
import { around, EDGE_PX, EMPTY, extendDown, extendUp, JUMP_PX, newest, refresh, type Window } from '../timeline'
import AppIcon from '../components/AppIcon.vue'
import ElapsedLine from '../components/ElapsedLine.vue'
import EntryMenu, { type EntryAction } from '../components/EntryMenu.vue'
import EntrySheet from '../components/EntrySheet.vue'
import MediaImage from '../components/MediaImage.vue'
import PhotoStrip from '../components/PhotoStrip.vue'
import PhotoViewer from '../components/PhotoViewer.vue'
import { sync } from '../sync/controller'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

const composer = ref<HTMLTextAreaElement>()
const list = ref<HTMLElement>()
const sheetRecord = ref<LogRecord>()
const selected = ref(new Set<number>())
const selecting = computed(() => selected.value.size > 0)
// The list holds a window of the log, read in pages (timeline.ts); scrolling near an edge reads the next page there.
const win = shallowRef<Window>(EMPTY)
const loaded = ref(false)
const drawn = computed(() => win.value.rows)
const days = computed(() => groupByDay(drawn.value))
const liveCount = ref(0) // for select all: counted when selecting starts, and on changes while selecting
const allSelected = computed(() => liveCount.value > 0 && selected.value.size === liveCount.value)
const syncChip = computed(() => {
  if (!sync.settings) return null
  if (sync.status === 'syncing') return { tone: '', label: t('sync.chipSyncing') }
  if (sync.status === 'error') return { tone: 'bad', label: t('sync.chipError') }
  if (sync.dirty || !sync.state.lastSyncAt) return { tone: 'pending', label: t('sync.chipPending') }
  return { tone: 'ok', label: t('sync.chipSynced', { time: timeOf(sync.state.lastSyncAt) }) }
})

let removeSelectionBack: (() => void) | undefined
watch(selecting, (on) => {
  if (on) removeSelectionBack = pushBackHandler(clearSelection)
  else removeSelectionBack?.()
})

function clearSelection() {
  selected.value = new Set()
}

function toggle(record: LogRecord) {
  const next = new Set(selected.value)
  if (next.has(record.entry_id)) next.delete(record.entry_id)
  else next.add(record.entry_id)
  selected.value = next
}

// Every entry in the log, drawn or not.
async function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(await db().liveEntryIds())
}

let pressTimer: number | undefined
let pressOrigin = { x: 0, y: 0 }
let longPressed = false
// A long press opens the entry's menu, next to the entry.
const menu = ref<{ record: LogRecord; x: number; top: number; bottom: number }>()

function onPointerDown(event: PointerEvent, record: LogRecord) {
  longPressed = false
  pressOrigin = { x: event.clientX, y: event.clientY }
  window.clearTimeout(pressTimer)
  if (selecting.value) return
  const entry = event.currentTarget as HTMLElement
  pressTimer = window.setTimeout(() => {
    longPressed = true
    const { top, bottom } = entry.getBoundingClientRect()
    menu.value = { record, x: pressOrigin.x, top, bottom }
    navigator.vibrate?.(15)
  }, LONG_PRESS_MS)
}

async function onMenu(action: EntryAction) {
  const record = menu.value!.record
  const text = textOf(record.content)
  if (action === 'select') toggle(record)
  else if (action === 'delete') {
    await db().trashEntries([record.entry_id])
    logChanged()
  } else if (action === 'copy') {
    await Clipboard.write({ string: text })
    showNotice(t('menu.copied'))
  } else {
    // After what is already typed, so nothing is lost; the cursor ends up after it.
    draft.text = draft.text ? `${draft.text}\n${text}` : text
    composer.value?.focus()
    await nextTick()
    resizeComposer()
  }
}

function onPointerMove(event: PointerEvent) {
  if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > MOVE_TOLERANCE_PX) {
    window.clearTimeout(pressTimer)
  }
}

function cancelPress() {
  window.clearTimeout(pressTimer)
}

function onClick(record: LogRecord) {
  if (longPressed) {
    longPressed = false
    return
  }
  if (selecting.value) toggle(record)
  else sheetRecord.value = record
}

// Tapping a thumbnail opens the viewer on it, over every photo in the window (oldest first), so swiping goes on into
// other entries. Tapping elsewhere on the entry opens its sheet; in select mode a thumbnail selects too.
const viewer = ref<number>()
// Every photo in the window, for the viewer, in one pass: each photo's entry, and where each entry's photos start.
const photoIndex = computed(() => {
  const photos: PhotoRef[] = []
  const entries: LogRecord[] = []
  const offsets = new Map<number, number>()
  for (const r of drawn.value) {
    offsets.set(r.entry_id, photos.length)
    for (const photo of photosOf(r.content)) {
      photos.push(photo)
      entries.push(r)
    }
  }
  return { photos, entries, offsets }
})

// The viewer's entry line opens that entry's sheet over the viewer. The viewer closes when an entry is edited (the
// editor opens) or the log changes under it (its photos would shift).
watch(() => screens.value.length, (n) => { if (n) viewer.value = undefined })
watch(logVersion, () => { viewer.value = undefined })

// ⌖ in a sheet (here, in search, over the viewer): everything on top closes, the entry is drawn and scrolled to the
// middle, and stays highlighted until another is located or it leaves the drawn range.
const located = ref<number>()
// `fresh`: the log just changed, so the window is read around the entry even if it was loaded.
async function locate(id: number, fresh = false) {
  viewer.value = undefined
  sheetRecord.value = undefined
  await change(async (w) => {
    if (!fresh && w.rows.some((r) => r.entry_id === id)) return w
    return (await around(db(), id)) ?? (fresh ? refresh(db(), w) : w) // gone meanwhile: the change is still read
  }, false)
  if (!drawn.value.some((r) => r.entry_id === id)) return
  located.value = id
  await nextTick()
  list.value?.querySelector(`[data-entry="${id}"]`)?.scrollIntoView({ block: 'center' })
}
watch(locateRequest, (request) => { if (request) void locate(request.entryId) })
watch(drawn, (rows) => {
  if (located.value !== undefined && !rows.some((r) => r.entry_id === located.value)) located.value = undefined
})

// Window changes run one at a time, in order (e.g. a page read while scrolling, then the read after a sync merged).
// Unless the caller scrolls itself, what is on screen stays put: the first entry in view is measured before and after.
let queue = Promise.resolve()
let changing = 0
function change(next: (w: Window) => Promise<Window | undefined>, keepView = true): Promise<void> {
  changing++
  const run = queue.then(async () => {
    const anchor = keepView ? firstInView() : undefined
    const w = await next(win.value)
    if (w && w !== win.value) {
      win.value = w
      await nextTick()
      if (anchor) {
        const el = list.value?.querySelector<HTMLElement>(`[data-entry="${anchor.id}"]`)
        if (el) list.value!.scrollTop += el.getBoundingClientRect().top - anchor.top
      }
    }
    updatePosition()
  }).finally(() => {
    changing--
    window.setTimeout(onListScroll) // the new window may itself end near the screen (a short log, a big change)
  })
  queue = run.catch(() => {})
  return run
}

function firstInView(): { id: number; top: number } | undefined {
  const el = list.value
  if (!el) return undefined
  const entries = el.querySelectorAll<HTMLElement>('.entry')
  const top = el.getBoundingClientRect().top
  let lo = 0
  let hi = entries.length // entries are in time order, top to bottom
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].getBoundingClientRect().bottom <= top) lo = mid + 1
    else hi = mid
  }
  const first = entries[lo]
  return first ? { id: Number(first.dataset.entry), top: first.getBoundingClientRect().top } : undefined
}

// The log changed: one read of the window, as `show` says (see store.ts). By default the same entries are read again;
// the first entries (e.g. a fresh install's first sync) show from the newest, at the bottom.
watch(logVersion, async ({ show }) => {
  if (show === 'latest') await toLatest()
  else if (show) await locate(show.locate, true)
  else {
    const wasEmpty = drawn.value.length === 0
    await change((w) => refresh(db(), w), !wasEmpty)
    if (wasEmpty) await scrollToBottom()
  }
  if (selecting.value) liveCount.value = await db().countLive()
})
watch(selecting, async (on) => { if (on) liveCount.value = await db().countLive() })

// The jump-to-latest button shows while the newest entries are not in the window, or more than JUMP_PX is below.
const farFromLatest = ref(false)
// At its bottom, the list stays there when its height changes (the keyboard or the system bars' insets coming and
// going, the composer growing): otherwise the composer would cover the last lines.
let atBottom = true
function updatePosition() {
  const el = list.value
  if (!el) return
  const below = el.scrollHeight - el.scrollTop - el.clientHeight
  farFromLatest.value = win.value.newer || below > JUMP_PX
  atBottom = below < 2
}
const listResized = new ResizeObserver(() => {
  if (atBottom) list.value?.scrollTo({ top: list.value.scrollHeight })
  updatePosition() // a list that grew may have reached its bottom: the keyboard closing resizes it twice
})
onMounted(() => listResized.observe(list.value!))
onUnmounted(() => listResized.disconnect())
function onListScroll() {
  const el = list.value
  if (!el) return
  updatePosition()
  if (changing) return
  const below = el.scrollHeight - el.scrollTop - el.clientHeight
  if (el.scrollTop < EDGE_PX && win.value.older) void change((w) => extendUp(db(), w))
  else if (below < EDGE_PX && win.value.newer) void change((w) => extendDown(db(), w))
}

// Bottom-left button when far from the newest entries: back to them (a located entry out of range loses its highlight).
async function toLatest() {
  await change(() => newest(db()), false)
  await scrollToBottom()
  updatePosition()
}

function onPhoto(record: LogRecord, index: number) {
  if (longPressed || selecting.value) {
    onClick(record)
    return
  }
  viewer.value = (photoIndex.value.offsets.get(record.entry_id) ?? 0) + index
}

async function deleteSelected() {
  await db().trashEntries([...selected.value])
  clearSelection()
  logChanged()
}

function resizeComposer() {
  const el = composer.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

async function scrollToBottom() {
  await nextTick()
  list.value?.scrollTo({ top: list.value.scrollHeight })
}

const canSend = computed(() => draft.text.trim() !== '' || draft.photos.length > 0)

// The text first, then the photos as one group; at the chosen time if one was set.
async function send() {
  if (!canSend.value) return
  const earlier = draft.time !== null
  const id = await db().add(composeContent(draft.text.trim(), draft.photos), draft.time ?? undefined)
  clearDraft()
  await nextTick()
  resizeComposer()
  sent(id, earlier)
}

async function addPhotos(source: PhotoSource) {
  const photos = await importPhotos(source)
  draft.photos.push(...photos)
  if (source !== 'capture') offerPhotoTimes(draft.photos)
}

function openLayout() {
  openScreen({ name: 'compose' })
}

// Entries from the last hour also show seconds, and the newest of them the time since (ElapsedLine); re-checked every
// half minute so they drop off on time.
const RECENT_MS = 3_600_000
const now = ref(Date.now())
const recent = (ms: number) => now.value - ms < RECENT_MS
let clock: number | undefined
onMounted(() => { clock = window.setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => window.clearInterval(clock))
watch(logVersion, () => { now.value = Date.now() })
const latest = computed(() => (win.value.newer ? undefined : drawn.value[drawn.value.length - 1]))

onMounted(async () => {
  await change(() => newest(db()), false)
  loaded.value = true
  await scrollToBottom()
})
</script>

<template>
  <div class="screen">
    <header v-if="selecting" class="topbar selecting">
      <button class="icon-btn" type="button" :aria-label="t('main.exitSelect')" @click="clearSelection">
        <AppIcon name="close" />
      </button>
      <h1>{{ t('main.selected', { n: selected.size }) }}</h1>
      <button class="text-btn" type="button" @click="toggleAll">
        {{ allSelected ? t('common.deselectAll') : t('common.selectAll') }}
      </button>
    </header>
    <header v-else class="topbar" style="padding-left: 16px">
      <button class="brand" type="button" :aria-label="t('app.openSettings')" @click="openScreen({ name: 'settings' })">
        {{ t('app.name') }}<AppIcon name="chevron" :size="16" />
      </button>
      <button v-if="syncChip" class="sync-chip" :class="syncChip.tone" type="button" @click="openScreen({ name: 'settings' })">
        {{ syncChip.label }}
      </button>
      <button class="icon-btn" type="button" :aria-label="t('main.search')" @click="openScreen({ name: 'search' })">
        <AppIcon name="search" />
      </button>
    </header>

    <div class="list-wrap">
      <main ref="list" class="scroll stream" @scroll.passive="onListScroll">
        <p v-if="loaded && drawn.length === 0" class="empty">{{ t('main.empty') }}</p>
        <section v-for="day in days" :key="day.key">
          <div class="daypill">{{ day.label }}</div>
          <div v-for="record in day.rows" :key="record.id" class="entry" :data-entry="record.entry_id"
            :class="{ selected: selected.has(record.entry_id) || menu?.record.entry_id === record.entry_id, located: located === record.entry_id }"
            role="button" tabindex="0"
            @pointerdown="onPointerDown($event, record)" @pointermove="onPointerMove" @pointerup="cancelPress"
            @pointercancel="cancelPress" @pointerleave="cancelPress" @contextmenu.prevent
            @click="onClick(record)" @keydown.enter="onClick(record)">
            <input v-if="selecting" type="checkbox" tabindex="-1" :checked="selected.has(record.entry_id)" aria-hidden="true">
            <time>{{ timeOf(record.logged_at) }}<small v-if="recent(record.logged_at)" class="sec">:{{ secondsOf(record.logged_at) }}</small></time>
            <div class="body">
              <p v-if="textOf(record.content)" class="text">{{ textOf(record.content) }}</p>
              <PhotoStrip v-if="photosOf(record.content).length" :photos="photosOf(record.content)" @open="(i) => onPhoto(record, i)" />
            </div>
          </div>
        </section>
        <ElapsedLine v-if="latest && recent(latest.logged_at)" :since="latest.logged_at" />
      </main>
      <button v-if="farFromLatest && !selecting" class="to-latest" type="button" :aria-label="t('main.toLatest')" @click="toLatest">
        <AppIcon name="down" :size="20" />
      </button>
    </div>

    <footer v-if="selecting" class="footer-bar">
      <button class="danger" type="button" @click="deleteSelected">{{ t('main.deleteSelected', { n: selected.size }) }}</button>
    </footer>
    <div v-else class="composer-wrap">
      <div v-if="draft.time !== null" class="timechip">
        <AppIcon name="clock" :size="18" />
        <button type="button" class="chip-text" @click="chooseTime(draft.photos)">{{ t('time.logAt', { time: logTime(draft.time) }) }}</button>
        <button type="button" class="chip-x" :aria-label="t('time.backToNow')" @click="draft.time = null"><AppIcon name="close" :size="16" /></button>
      </div>
      <div v-if="draft.photos.length" class="tray">
        <div v-for="(photo, i) in draft.photos" :key="`${i}:${photo.file}`" class="tray-photo">
          <MediaImage :photo="photo" />
          <span v-if="isOld(photo)" class="badge">{{ timeOf(takenAt(photo)!) }}</span>
          <button class="x" type="button" :aria-label="t('photo.remove')" @click="draft.photos.splice(i, 1)"><AppIcon name="close" :size="12" /></button>
        </div>
      </div>
      <form class="composer" @submit.prevent="send">
        <textarea ref="composer" v-model="draft.text" rows="1" :aria-label="t('main.composerLabel')" :placeholder="t('main.placeholder')"
          @input="resizeComposer"></textarea>
        <!-- mousedown.prevent keeps the keyboard open between entries -->
        <button class="primary" type="submit" :disabled="!canSend" @mousedown.prevent>{{ t('main.send') }}</button>
      </form>
      <div class="tools">
        <button class="icon-btn tool" type="button" :aria-label="t('photo.camera')" @mousedown.prevent @click="addPhotos('capture')"><AppIcon name="camera" /></button>
        <button class="icon-btn tool" type="button" :aria-label="t('photo.gallery')" @mousedown.prevent @click="addPhotos('pick')"><AppIcon name="image" /></button>
        <button class="icon-btn tool" :class="{ set: draft.time !== null }" type="button" :aria-label="t('photo.time')" @mousedown.prevent
          @click="chooseTime(draft.photos)"><AppIcon name="clock" /></button>
        <button class="layout" type="button" @mousedown.prevent @click="openLayout"><AppIcon name="layout" :size="20" />{{ t('photo.layout') }}</button>
      </div>
    </div>

    <EntryMenu v-if="menu" :x="menu.x" :top="menu.top" :bottom="menu.bottom" :has-text="textOf(menu.record.content) !== ''"
      @pick="onMenu" @close="menu = undefined" />
    <EntrySheet v-if="sheetRecord" :record="sheetRecord" @close="sheetRecord = undefined" />
    <PhotoViewer v-if="viewer !== undefined" :photos="photoIndex.photos" :entries="photoIndex.entries" :start="viewer"
      @close="viewer = undefined" @entry="(record) => (sheetRecord = record)" />
  </div>
</template>

<style scoped>
.brand { flex-grow: 1; display: flex; align-items: center; gap: 4px; height: 44px; border: 0; background: transparent; padding: 0;
  font-size: 22px; font-weight: 600; text-align: left; }
.brand :deep(svg) { color: var(--muted); }
.sync-chip { flex-shrink: 0; height: 30px; border: 0; border-radius: 999px; padding: 0 10px; font-size: 12px;
  background: var(--chip); color: var(--muted); }
.sync-chip.ok { color: var(--ok); }
.sync-chip.pending { color: var(--warn); background: var(--warn-soft); }
.sync-chip.bad { color: var(--danger); }
.stream { display: flex; flex-direction: column; }
.entry .body { flex-grow: 1; min-width: 0; }
/* A located entry stays marked while its context is browsed. */
.entry.located { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.stream { overflow-anchor: none; } /* the window keeps the view steady itself */
.list-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
.list-wrap > .stream { flex: 1; }
.to-latest { position: absolute; left: 14px; bottom: 12px; width: 42px; height: 42px; border-radius: 50%;
  border: 1px solid var(--field); background: var(--surface); color: var(--ink); display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .15); z-index: 2; }
.stream > :first-child { margin-top: auto; }
</style>
