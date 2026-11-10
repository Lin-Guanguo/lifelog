<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useBackHandler } from '../back'
import { showNotice } from '../compose'
import { dateOf, formatBytes, timeOf } from '../format'
import { t } from '../i18n'
import { takenAt, type PhotoRef } from '../media/content'
import { ensurePhoto, platform } from '../media/photos'
import AppIcon from './AppIcon.vue'
import MediaImage from './MediaImage.vue'

// Full screen: close and position on top; time, format and size below, then four actions: 原图 (the full-resolution
// original in place of the 1600 px display), 打开 (with another app), 保存 (a copy in the gallery's LifeLog album,
// once) and 分享. Open and share always use the original.
const props = defineProps<{ photos: PhotoRef[]; start: number }>()
const emit = defineEmits<{ close: [] }>()
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


watch(photo, async (p) => {
  if (!exported.has(p.file)) exported.set(p.file, await platform.isExported(p).catch(() => false))
}, { immediate: true }) // looked up when the viewer shows the photo, so a copy deleted from the gallery is noticed

onMounted(async () => {
  await nextTick()
  track.value?.scrollTo({ left: props.start * track.value.clientWidth })
})

function onScroll() {
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
    <div class="viewer" role="dialog" aria-modal="true" :aria-label="t('viewer.label')">
      <div class="bar">
        <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="emit('close')"><AppIcon name="close" /></button>
        <span class="counter">{{ photos.length > 1 ? t('viewer.counter', { i: index + 1, n: photos.length }) : '' }}</span>
      </div>
      <div ref="track" class="track" @scroll.passive="onScroll">
        <div v-for="(p, i) in photos" :key="`${i}:${p.file}`" class="slide">
          <img v-if="full.has(p.file)" class="original" :src="full.get(p.file)" :alt="t('photo.alt')" draggable="false"
            @load="loading = null" @error="loading = null">
          <MediaImage v-else :photo="p" fit="contain" />
        </div>
      </div>
      <div class="caption">
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
    </div>
  </Teleport>
</template>

<style scoped>
.viewer { position: fixed; inset: 0; z-index: 20; background: #000; color: #fff; display: flex; flex-direction: column;
  padding-top: var(--safe-area-inset-top, env(safe-area-inset-top)); padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom)); }
.bar { display: flex; align-items: center; padding: 8px; }
.bar .icon-btn { color: #fff; }
.counter { flex-grow: 1; text-align: center; font-size: 14px; margin-right: 44px; }
.track { flex-grow: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.track::-webkit-scrollbar { display: none; }
.slide { flex: 0 0 100%; scroll-snap-align: center; display: flex; align-items: center; justify-content: center; }
.slide .media { width: 100%; height: 100%; background: transparent; }
.slide .original { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.caption { display: flex; flex-direction: column; gap: 2px; padding: 10px 18px 6px; }
.caption b { font-size: 14px; font-weight: 600; }
.caption small { font-size: 12px; color: rgba(255, 255, 255, .65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; justify-content: space-around; padding: 4px 8px 14px; }
.action { flex: 1; height: 58px; border: 0; border-radius: 12px; background: transparent; color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; }
.action small { font-size: 11px; color: rgba(255, 255, 255, .8); }
.action:disabled { opacity: .45; cursor: default; }
</style>
