<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { pushBackHandler, useBackHandler } from '../back'
import { showNotice } from '../compose'
import { dateOf, formatBytes, timeOf } from '../format'
import { t } from '../i18n'
import type { LogRecord } from '../data/records'
import { takenAt, textOf, type PhotoRef } from '../media/content'
import { photoDetails } from '../media/details'
import { ensurePhoto, platform } from '../media/photos'
import AppIcon from './AppIcon.vue'
import MediaImage from './MediaImage.vue'

// Full screen: close, position and ⓘ (the photo's details) on top; time, format and size below, then four actions:
// 原图 (the full-resolution original in place of the 1600 px display), 打开 (with another app), 保存 (a copy in the
// gallery's LifeLog album, once) and 分享. Open and share always use the original. Pinch or double-tap to zoom (zooming
// in loads the original); while zoomed, dragging moves within the photo instead of switching photos.
// `entries`, when given (the viewer opened from the list, over every photo), holds each photo's entry: its first line
// is shown under the time, and tapping it emits `entry` (the list then shows that entry).
const props = defineProps<{ photos: PhotoRef[]; start: number; entries?: LogRecord[] }>()
const emit = defineEmits<{ close: []; entry: [record: LogRecord] }>()
useBackHandler(() => emit('close'))

const track = ref<HTMLElement>()
const index = ref(props.start)
const photo = computed(() => props.photos[index.value])
const exported = reactive(new Map<string, boolean>())
const inGallery = computed(() => !!exported.get(photo.value.file))
const taken = computed(() => takenAt(photo.value))
const kind = computed(() => {
  const { format, bytes } = photo.value.meta ?? {}
  return format && bytes ? `${format.toUpperCase()} · ${formatBytes(Number(bytes))}` : ''
})

// 原图: when the original is larger than what is shown (the preview is 1600 px) and the WebView can show it.
const PREVIEW_SIDE = 1600
const full = reactive(new Map<string, string>()) // file → original's URL, once loaded
const loading = ref<string | null>(null)
const canShowOriginal = computed(() => {
  const p = photo.value
  return !full.has(p.file) && !!p.meta?.bytes && p.meta.format !== 'heic' && Math.max(p.width ?? 0, p.height ?? 0) > PREVIEW_SIDE
})

async function showOriginal() {
  const p = photo.value
  loading.value = p.file
  await act(async () => {
    const url = await platform.original(p.file)
    if (!url) throw new Error(t('viewer.unavailable'))
    full.set(p.file, url)
  })
  if (!full.has(p.file)) loading.value = null
}

// ⓘ: what the photo line records. Android back closes it first.
const details = ref(false)
const detailRows = computed(() => photoDetails(photo.value, t))
let closeDetailsBack: (() => void) | undefined
watch(details, (open) => {
  if (open) closeDetailsBack = pushBackHandler(() => { details.value = false })
  else closeDetailsBack?.()
})

// Zoom, on the photo being shown: transform = translate(x, y) scale(scale), origin at its top left.
const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
const zoom = reactive({ scale: 1, x: 0, y: 0, animate: false })
const zoomed = computed(() => zoom.scale > 1.01)
const pointers = new Map<number, { x: number; y: number }>()
let pinch: { distance: number; scale: number; x: number; y: number; cx: number; cy: number } | null = null
let pan: { px: number; py: number; x: number; y: number } | null = null
let tap: { at: number; x: number; y: number } | null = null
let moved = false

function resetZoom() {
  Object.assign(zoom, { scale: 1, x: 0, y: 0 })
}

// Keeps the zoomed photo covering the stage (no empty gaps beyond its edges).
function clamp(stage: DOMRect) {
  zoom.scale = Math.min(MAX_SCALE, Math.max(1, zoom.scale))
  zoom.x = Math.min(0, Math.max(stage.width * (1 - zoom.scale), zoom.x))
  zoom.y = Math.min(0, Math.max(stage.height * (1 - zoom.scale), zoom.y))
}

// Scales to `scale` keeping the point (cx, cy) of the stage where it is.
function zoomAt(scale: number, cx: number, cy: number, from: { scale: number; x: number; y: number }) {
  const s = Math.min(MAX_SCALE, Math.max(0.8, scale))
  zoom.x = cx - (cx - from.x) * (s / from.scale)
  zoom.y = cy - (cy - from.y) * (s / from.scale)
  zoom.scale = s
}

// Swipe down (not zoomed) to close: the photo follows the finger and the background fades; let go far enough to close.
const DISMISS_PX = 120
const dismiss = reactive({ y: 0, active: false, animate: false })
let dismissFrom: { x: number; y: number } | null = null

const entry = computed(() => props.entries?.[index.value])
const entryLine = computed(() => (entry.value ? textOf(entry.value.content).split('\n').find((l) => l.trim()) ?? '' : ''))

function onDown(event: PointerEvent) {
  const stage = (event.currentTarget as HTMLElement).getBoundingClientRect()
  pointers.set(event.pointerId, { x: event.clientX - stage.left, y: event.clientY - stage.top })
  zoom.animate = false
  moved = false
  dismissFrom = pointers.size === 1 && !zoomed.value ? { x: event.clientX, y: event.clientY } : null
  dismiss.animate = false
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: zoom.scale, x: zoom.x, y: zoom.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
    pan = null
  } else if (pointers.size === 1 && zoomed.value) {
    const p = pointers.get(event.pointerId)!
    pan = { px: p.x, py: p.y, x: zoom.x, y: zoom.y }
  }
}

function onMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId)
  if (!previous) return
  const stage = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const p = { x: event.clientX - stage.left, y: event.clientY - stage.top }
  if (Math.hypot(p.x - previous.x, p.y - previous.y) > 3) moved = true
  pointers.set(event.pointerId, p)
  if (dismissFrom && pointers.size === 1) {
    const dx = event.clientX - dismissFrom.x
    const dy = event.clientY - dismissFrom.y
    if (!dismiss.active && dy > 12 && dy > Math.abs(dx) * 1.5) dismiss.active = true
    if (dismiss.active) {
      dismiss.y = Math.max(0, dy)
      return
    }
  }
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    zoomAt(pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, pinch.cx, pinch.cy, pinch)
    // Moving both fingers also moves the photo.
    zoom.x += (a.x + b.x) / 2 - pinch.cx
    zoom.y += (a.y + b.y) / 2 - pinch.cy
  } else if (pan) {
    zoom.x = pan.x + p.x - pan.px
    zoom.y = pan.y + p.y - pan.py
  }
}

function onUp(event: PointerEvent) {
  const p = pointers.get(event.pointerId)
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size > 0) return
  pan = null
  dismissFrom = null
  if (dismiss.active) {
    dismiss.active = false
    if (event.type === 'pointerup' && dismiss.y > DISMISS_PX) {
      emit('close')
      return
    }
    dismiss.animate = true
    dismiss.y = 0
    return
  }
  const stage = (event.currentTarget as HTMLElement).getBoundingClientRect()
  zoom.animate = true
  if (event.type === 'pointerup' && p && !moved) {
    // Double tap: zoom in there, or back to fit.
    const now = Date.now()
    if (tap && now - tap.at < 300 && Math.hypot(p.x - tap.x, p.y - tap.y) < 30) {
      tap = null
      if (zoomed.value) resetZoom()
      else zoomAt(DOUBLE_TAP_SCALE, p.x, p.y, { scale: 1, x: 0, y: 0 })
      clamp(stage)
      return
    }
    tap = { at: now, x: p.x, y: p.y }
  }
  if (zoom.scale < 1.05) resetZoom()
  else clamp(stage)
}

// Zooming in on a photo whose original is larger than the display loads the original.
watch(zoomed, (on) => {
  if (on && canShowOriginal.value && loading.value !== photo.value.file) void showOriginal()
})

watch(photo, async (p) => {
  if (!exported.has(p.file)) exported.set(p.file, await platform.isExported(p).catch(() => false))
}, { immediate: true }) // looked up when the viewer shows the photo, so a copy deleted from the gallery is noticed

onMounted(async () => {
  await nextTick()
  track.value?.scrollTo({ left: props.start * track.value.clientWidth })
})

function onScroll() {
  resetZoom()
  const el = track.value!
  index.value = Math.min(props.photos.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)))
}

// The file must be on this device first (another device may have added the photo).
async function act(action: (p: PhotoRef) => Promise<void>) {
  const p = photo.value
  try {
    if (!(await ensurePhoto(p.file))) throw new Error(t('viewer.unavailable'))
    await action(p)
  } catch (error) {
    showNotice(t('viewer.failed', { error: error instanceof Error ? error.message : String(error) }))
  }
}

const open = () => act((p) => platform.open(p))
const share = () => act((p) => platform.share(p))
const save = () => act(async (p) => {
  const result = await platform.export(p)
  exported.set(p.file, true)
  showNotice(t(result === 'existed' ? 'viewer.alreadySaved' : 'viewer.savedNotice'))
})
</script>

<template>
  <Teleport to="body">
    <div class="viewer" role="dialog" aria-modal="true" :aria-label="t('viewer.label')"
      :style="dismiss.y ? { background: `rgba(0, 0, 0, ${Math.max(0.2, 1 - dismiss.y / 400)})` } : undefined">
      <div class="bar">
        <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="emit('close')"><AppIcon name="close" /></button>
        <span class="counter">{{ photos.length > 1 ? t('viewer.counter', { i: index + 1, n: photos.length }) : '' }}</span>
        <button class="icon-btn" type="button" :aria-label="t('viewer.details')" :aria-expanded="details" @click="details = true"><AppIcon name="info" /></button>
      </div>
      <div ref="track" class="track" :class="{ locked: zoomed || dismiss.active, animate: dismiss.animate }"
        :style="dismiss.y ? { transform: `translateY(${dismiss.y}px)` } : undefined" @scroll.passive="onScroll">
        <div v-for="(p, i) in photos" :key="`${i}:${p.file}`" class="slide">
          <div class="stage" :class="{ zoomed: i === index && zoomed }"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
            <div class="zoom" :class="{ animate: zoom.animate }"
              :style="i === index ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` } : undefined">
              <img v-if="full.has(p.file)" class="original" :src="full.get(p.file)" :alt="t('photo.alt')" draggable="false"
                @load="loading = null" @error="loading = null">
              <MediaImage v-else :photo="p" fit="contain" />
            </div>
          </div>
        </div>
      </div>
      <div class="caption" :style="dismiss.y ? { opacity: Math.max(0, 1 - dismiss.y / 150) } : undefined">
        <button v-if="entry && entryLine" class="entry-line" type="button" :aria-label="t('viewer.toEntry')" @click="emit('entry', entry)">
          <span>{{ entryLine }}</span><AppIcon name="chevron" :size="14" />
        </button>
        <b v-if="taken !== null">{{ dateOf(taken) }} {{ timeOf(taken) }}</b>
        <small>{{ [kind, inGallery ? t('viewer.inGalleryNote') : ''].filter(Boolean).join(' · ') }}</small>
      </div>
      <div class="actions">
        <button class="action" type="button" :aria-label="t('viewer.showOriginal')" :disabled="!canShowOriginal || loading === photo.file"
          @click="showOriginal">
          <AppIcon name="expand" />
          <small>{{ loading === photo.file ? t('viewer.loadingOriginal') : canShowOriginal ? t('viewer.original') : t('viewer.originalShown') }}</small>
        </button>
        <button class="action" type="button" :aria-label="t('viewer.openWith')" @click="open">
          <AppIcon name="open" /><small>{{ t('viewer.open') }}</small>
        </button>
        <button class="action" type="button" :aria-label="t('viewer.saveLabel')" :disabled="inGallery" @click="save">
          <AppIcon :name="inGallery ? 'check' : 'download'" /><small>{{ inGallery ? t('viewer.inGallery') : t('viewer.save') }}</small>
        </button>
        <button class="action" type="button" :aria-label="t('viewer.share')" @click="share">
          <AppIcon name="share" /><small>{{ t('viewer.share') }}</small>
        </button>
      </div>
      <template v-if="details">
        <div class="details-scrim" @click="details = false"></div>
        <div class="details" role="dialog" :aria-label="t('details.title')">
          <span class="grabber"></span>
          <b class="details-title">{{ t('details.title') }}</b>
          <dl v-if="detailRows.length">
            <template v-for="row in detailRows" :key="row.label">
              <dt>{{ t(row.label) }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>
          <p v-else class="details-none">{{ t('details.none') }}</p>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; z-index: 20; background: #000; color: #fff; display: flex; flex-direction: column;
  padding-top: var(--safe-area-inset-top, env(safe-area-inset-top)); padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom)); }
.bar { display: flex; align-items: center; padding: 8px; }
.bar .icon-btn { color: #fff; }
.counter { flex-grow: 1; text-align: center; font-size: 14px; }
.track { flex-grow: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.track::-webkit-scrollbar { display: none; }
.track.locked { overflow-x: hidden; }
.track.animate { transition: transform .2s var(--ease); }
.slide { flex: 0 0 100%; scroll-snap-align: center; display: flex; overflow: hidden; }
/* Not zoomed: horizontal swipes go to the track (next photo); pinches and taps come here. Zoomed: everything here. */
.stage { flex: 1; position: relative; touch-action: pan-x; overflow: hidden; }
.stage.zoomed { touch-action: none; }
.zoom { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform-origin: 0 0; will-change: transform; }
.zoom.animate { transition: transform .2s var(--ease); }
.zoom .media { width: 100%; height: 100%; background: transparent; }
.zoom .original { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.caption { display: flex; flex-direction: column; gap: 2px; padding: 10px 18px 6px; }
.caption b { font-size: 14px; font-weight: 600; }
.entry-line { align-self: flex-start; max-width: 100%; display: flex; align-items: center; gap: 2px; margin: 0 0 4px; padding: 0;
  border: 0; background: transparent; color: #fff; font-size: 15px; text-align: left; }
.entry-line span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caption small { font-size: 12px; color: rgba(255, 255, 255, .65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; justify-content: space-around; padding: 4px 8px 14px; }
.action { flex: 1; height: 58px; border: 0; border-radius: 12px; background: transparent; color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; }
.action small { font-size: 11px; color: rgba(255, 255, 255, .8); }
.action:disabled { opacity: .45; cursor: default; }
.details-scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); }
.details { position: absolute; left: 0; right: 0; bottom: 0; max-height: 70%; overflow-y: auto; background: #1c1f1d; border-radius: 18px 18px 0 0;
  padding: 10px 20px calc(20px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom))); display: flex; flex-direction: column; gap: 12px; }
.details .grabber { align-self: center; background: rgba(255, 255, 255, .25); }
.details-title { font-size: 16px; }
.details dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; font-size: 14px; }
.details dt { color: rgba(255, 255, 255, .55); white-space: nowrap; }
.details dd { margin: 0; overflow-wrap: anywhere; line-height: 1.45; }
.details-none { margin: 0; color: rgba(255, 255, 255, .6); font-size: 14px; }
</style>
