<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ text: string; query: string }>()

// Case-insensitive like SQLite's LIKE, so every match the search returns is visibly marked.
const parts = computed(() => {
  const q = props.query.toLowerCase()
  if (!q) return [{ text: props.text, hit: false }]
  const lower = props.text.toLowerCase()
  const out: { text: string; hit: boolean }[] = []
  let from = 0
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, from)) {
    if (i > from) out.push({ text: props.text.slice(from, i), hit: false })
    out.push({ text: props.text.slice(i, i + q.length), hit: true })
    from = i + q.length
  }
  if (from < props.text.length) out.push({ text: props.text.slice(from), hit: false })
  return out
})
</script>

<template>
  <template v-for="(part, i) in parts" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
</template>
