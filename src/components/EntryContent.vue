<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseContent, type PhotoRef } from '../media/content'
import PhotoGroup from './PhotoGroup.vue'
import PhotoViewer from './PhotoViewer.vue'

// An entry as written: paragraphs, and runs of photos laid out automatically. Tap a photo to view it.
const props = defineProps<{ content: string }>()

type Part = { type: 'text'; text: string } | { type: 'photos'; photos: PhotoRef[]; first: number }
const parts = computed(() => {
  const out: Part[] = []
  let index = 0
  for (const block of parseContent(props.content)) {
    const last = out[out.length - 1]
    if (block.type === 'text') out.push({ type: 'text', text: block.text })
    else if (last?.type === 'photos') last.photos.push(block.photo)
    else out.push({ type: 'photos', photos: [block.photo], first: index })
    if (block.type === 'photo') index++
  }
  return out
})
const photos = computed(() => parts.value.flatMap((p) => (p.type === 'photos' ? p.photos : [])))
const viewing = ref<number>()
</script>

<template>
  <div class="entry-content">
    <template v-for="(part, i) in parts" :key="i">
      <p v-if="part.type === 'text'" class="longtext">{{ part.text }}</p>
      <PhotoGroup v-else :photos="part.photos" @open="(n) => (viewing = part.first + n)" />
    </template>
  </div>
  <PhotoViewer v-if="viewing !== undefined" :photos="photos" :start="viewing" @close="viewing = undefined" />
</template>

<style scoped>
.entry-content { display: flex; flex-direction: column; gap: 10px; }
</style>
