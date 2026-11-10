<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useBackHandler } from '../back'
import { showNotice } from '../compose'
import { dateOf, timeOf } from '../format'
import { t } from '../i18n'
import { takenAt, type PhotoRef } from '../media/content'
import { findOriginal, platform } from '../media/photos'
import AppIcon from './AppIcon.vue'
import MediaImage from './MediaImage.vue'

// Full screen, the synced copy. The original is used when it is still on this device:
// open it with another app (Android's "open with" list), share it, and no need to save the copy.
const props = defineProps<{ photos: PhotoRef[]; start: number }>()
const emit = defineEmits<{ close: [] }>()
useBackHandler(() => emit('close'))

const track = ref<HTMLElement>()
const index = ref(props.start)
const photo = computed(() => props.photos[index.value])
const originals = reactive(new Map<string, string | null>())
const saved = reactive(new Set<string>())
const original = computed(() => originals.get(photo.value.file) ?? null)
const taken = computed(() => takenAt(photo.value))
const originalName = computed(() => photo.value.path?.split('/').pop())

watch(photo, async (p) => {
  if (!originals.has(p.file)) originals.set(p.file, await findOriginal(p.file))
}, { immediate: true })

onMounted(async () => {
  await nextTick()
  track.value?.scrollTo({ left: props.start * track.value.clientWidth })
})

function onScroll() {
  const el = track.value!
  index.value = Math.min(props.photos.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)))
}

async function act(action: () => Promise<void>) {
  try {
    await action()
  } catch (error) {
    showNotice(t('viewer.failed', { error: error instanceof Error ? error.message : String(error) }))
  }
}

const openOriginal = () => act(() => platform.openOriginal(original.value!))
const share = () => act(() => platform.share(photo.value.file, original.value ?? undefined))
const save = () => act(async () => {
  const p = photo.value
  await platform.saveCopy(p)
  saved.add(p.file)
  showNotice(t('viewer.savedNotice'))
})
</script>

<template>
  <Teleport to="body">
    <div class="viewer" role="dialog" aria-modal="true" :aria-label="t('viewer.label')">
      <div class="bar">
        <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="emit('close')"><AppIcon name="close" /></button>
        <span v-if="photos.length > 1">{{ t('viewer.counter', { i: index + 1, n: photos.length }) }}</span>
      </div>
      <div ref="track" class="track" @scroll.passive="onScroll">
        <div v-for="(p, i) in photos" :key="`${i}:${p.file}`" class="slide"><MediaImage :photo="p" fit="contain" /></div>
      </div>
      <div class="foot">
        <div class="caption">
          <b v-if="taken !== null">{{ dateOf(taken) }} {{ timeOf(taken) }}</b>
          <small>{{ original ? (originalName ? t('viewer.original', { name: originalName }) : t('viewer.originalNoName')) : t('viewer.copy') }}</small>
        </div>
        <button v-if="original" class="action" type="button" :aria-label="t('viewer.openWith')" @click="openOriginal">
          <AppIcon name="open" /><small>{{ t('viewer.open') }}</small>
        </button>
        <button class="action" type="button" :aria-label="t('viewer.saveLabel')" :disabled="!!original || saved.has(photo.file)" @click="save">
          <AppIcon :name="original || saved.has(photo.file) ? 'check' : 'download'" />
          <small>{{ original ? t('viewer.inGallery') : saved.has(photo.file) ? t('viewer.saved') : t('viewer.save') }}</small>
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
.bar span { flex-grow: 1; text-align: center; font-size: 14px; margin-right: 44px; }
.track { flex-grow: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.track::-webkit-scrollbar { display: none; }
.slide { flex: 0 0 100%; scroll-snap-align: center; display: flex; }
.slide .media { width: 100%; height: 100%; background: transparent; }
.foot { display: flex; align-items: center; gap: 4px; padding: 8px 10px 16px 16px; }
.caption { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.caption b { font-size: 14px; font-weight: 600; }
.caption small { font-size: 12px; color: rgba(255, 255, 255, .65); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.action { width: 58px; height: 54px; border: 0; border-radius: 12px; background: transparent; color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 3px; flex-shrink: 0; }
.action small { font-size: 11px; color: rgba(255, 255, 255, .8); }
</style>
