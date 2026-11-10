<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { PhotoRef } from '../media/content'
import { photoUrl } from '../media/photos'
import { t } from '../i18n'
import AppIcon from './AppIcon.vue'

// A photo copy, loaded (and downloaded from the server if needed) once it scrolls into view.
const props = defineProps<{ photo: PhotoRef; fit?: 'cover' | 'contain' }>()
const el = ref<HTMLElement>()
const src = ref<string | null>(null)
const state = ref<'idle' | 'loading' | 'ready' | 'missing'>('idle')

async function load() {
  if (state.value !== 'idle') return
  state.value = 'loading'
  try {
    src.value = await photoUrl(props.photo.file)
    state.value = src.value ? 'ready' : 'missing'
  } catch {
    state.value = 'missing'
  }
}

// Reused for another photo (lists re-render in place): start over.
watch(() => props.photo.file, () => {
  const wasLoaded = state.value !== 'idle'
  src.value = null
  state.value = 'idle'
  if (wasLoaded) void load()
})

let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer?.disconnect()
      void load()
    }
  }, { rootMargin: '200px' })
  observer.observe(el.value!)
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div ref="el" class="media" :class="state" :title="state === 'missing' ? t('photo.unavailable') : undefined">
    <img v-if="src" :src="src" :alt="t('photo.alt')" :style="{ objectFit: fit ?? 'cover' }" draggable="false">
    <AppIcon v-else-if="state === 'missing'" name="image" :size="20" />
  </div>
</template>

<style scoped>
.media { position: relative; overflow: hidden; background: var(--chip); display: flex; align-items: center; justify-content: center; color: var(--muted); }
.media img { width: 100%; height: 100%; display: block; }
.media.loading::after { content: ''; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--field); border-top-color: var(--muted);
  animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
