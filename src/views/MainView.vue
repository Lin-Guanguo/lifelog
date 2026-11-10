<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { pushBackHandler } from '../back'
import { chooseTime, clearDraft, draft, importPhotos, isOld, offerPhotoTimes } from '../compose'
import type { LogRecord } from '../data/records'
import { groupByDay, logTime, timeOf } from '../format'
import { t } from '../i18n'
import { composeContent, photosOf, takenAt, textOf } from '../media/content'
import type { PhotoSource } from '../media/photos'
import { db, liveRecords, openScreen, reloadLive } from '../store'
import AppIcon from '../components/AppIcon.vue'
import EntrySheet from '../components/EntrySheet.vue'
import MediaImage from '../components/MediaImage.vue'
import PhotoStrip from '../components/PhotoStrip.vue'
import { sync } from '../sync/controller'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

const composer = ref<HTMLTextAreaElement>()
const list = ref<HTMLElement>()
const sheetRecord = ref<LogRecord>()
const selected = ref(new Set<number>())
const selecting = computed(() => selected.value.size > 0)
const days = computed(() => groupByDay(liveRecords.value))
const allSelected = computed(() => selected.value.size === liveRecords.value.length)
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

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(liveRecords.value.map((r) => r.entry_id))
}

let pressTimer: number | undefined
let pressOrigin = { x: 0, y: 0 }
let longPressed = false

function onPointerDown(event: PointerEvent, record: LogRecord) {
  longPressed = false
  pressOrigin = { x: event.clientX, y: event.clientY }
  window.clearTimeout(pressTimer)
  if (selecting.value) return
  pressTimer = window.setTimeout(() => {
    longPressed = true
    toggle(record)
    navigator.vibrate?.(15)
  }, LONG_PRESS_MS)
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

async function deleteSelected() {
  await db().trashEntries([...selected.value])
  clearSelection()
  await reloadLive()
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
  await db().add(composeContent(draft.text.trim(), draft.photos), draft.time ?? undefined)
  const earlier = draft.time !== null
  clearDraft()
  await nextTick()
  resizeComposer()
  await reloadLive()
  if (!earlier) await scrollToBottom()
}

async function addPhotos(source: PhotoSource) {
  const photos = await importPhotos(source)
  draft.photos.push(...photos)
  if (source !== 'capture') offerPhotoTimes(draft.photos)
}

function openLayout() {
  openScreen({ name: 'compose' })
}

onMounted(scrollToBottom)
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

    <main ref="list" class="scroll stream">
      <p v-if="liveRecords.length === 0" class="empty">{{ t('main.empty') }}</p>
      <section v-for="day in days" :key="day.key">
        <div class="daypill">{{ day.label }}</div>
        <div v-for="record in day.rows" :key="record.id" class="entry" :class="{ selected: selected.has(record.entry_id) }"
          role="button" tabindex="0"
          @pointerdown="onPointerDown($event, record)" @pointermove="onPointerMove" @pointerup="cancelPress"
          @pointercancel="cancelPress" @pointerleave="cancelPress" @contextmenu.prevent
          @click="onClick(record)" @keydown.enter="onClick(record)">
          <input v-if="selecting" type="checkbox" tabindex="-1" :checked="selected.has(record.entry_id)" aria-hidden="true">
          <time>{{ timeOf(record.logged_at) }}</time>
          <div class="body">
            <p v-if="textOf(record.content)" class="text">{{ textOf(record.content) }}</p>
            <PhotoStrip v-if="photosOf(record.content).length" :photos="photosOf(record.content)" />
          </div>
        </div>
      </section>
    </main>

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

    <EntrySheet v-if="sheetRecord" :record="sheetRecord" @close="sheetRecord = undefined" />
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
.stream > :first-child { margin-top: auto; }
</style>
