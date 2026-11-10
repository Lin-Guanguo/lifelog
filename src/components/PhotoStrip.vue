<script setup lang="ts">
import type { PhotoRef } from '../media/content'
import MediaImage from './MediaImage.vue'

// An entry's photos in a list: up to four thumbnails, "+N" on the last for the rest.
defineProps<{ photos: PhotoRef[] }>()
const SHOWN = 4
</script>

<template>
  <div class="strip">
    <div v-for="(photo, i) in photos.slice(0, SHOWN)" :key="`${i}:${photo.file}`" class="thumb">
      <MediaImage :photo="photo" />
      <span v-if="i === SHOWN - 1 && photos.length > SHOWN" class="more">+{{ photos.length - SHOWN + 1 }}</span>
    </div>
  </div>
</template>

<style scoped>
.strip { display: flex; gap: 6px; margin-top: 6px; }
.thumb { position: relative; width: 64px; height: 64px; border-radius: 8px; overflow: hidden; flex-shrink: 0; }
.thumb .media { width: 100%; height: 100%; }
.more { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 600; font-size: 15px; }
</style>
