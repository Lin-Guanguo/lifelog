<script setup lang="ts">
import { computed } from 'vue'
import { groupLayout, singleAspect, type PhotoRef } from '../media/content'
import { t } from '../i18n'
import MediaImage from './MediaImage.vue'

// Photos in a row, laid out by how many there are (docs/spec.md → Photos).
const props = defineProps<{ photos: PhotoRef[] }>()
const emit = defineEmits<{ open: [index: number] }>()
const layout = computed(() => groupLayout(props.photos.length))
</script>

<template>
  <div class="photo-group" :class="layout">
    <button v-for="(photo, i) in photos" :key="`${i}:${photo.file}`" type="button" class="tile" :aria-label="t('photo.alt')"
      :style="layout === 'one' ? { aspectRatio: String(singleAspect(photo)), width: `${Math.round(160 * singleAspect(photo))}px` } : undefined"
      @click="emit('open', i)">
      <MediaImage :photo="photo" />
    </button>
  </div>
</template>

<style scoped>
.photo-group { display: grid; gap: 4px; }
.tile { padding: 0; border: 0; border-radius: 8px; overflow: hidden; aspect-ratio: 1; background: var(--chip); }
.tile .media { width: 100%; height: 100%; }
.one { display: block; }
.one .tile { display: block; max-width: 70%; }
.two { grid-template-columns: repeat(2, 1fr); max-width: 80%; }
.three, .grid { grid-template-columns: repeat(3, 1fr); }
.four { grid-template-columns: repeat(2, calc((100% - 8px) / 3)); }
</style>
