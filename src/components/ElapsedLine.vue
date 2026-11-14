<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { t } from '../i18n'

// Time since the newest entry (e.g. the rest between two sets). A component of its own, so its tick every second
// draws this line only, not the list.
const props = defineProps<{ since: number }>()
const now = ref(Date.now())
let clock: number | undefined
onMounted(() => { clock = window.setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => window.clearInterval(clock))

const label = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - props.since) / 1000))
  const m = Math.floor(seconds / 60)
  return m ? t('main.elapsedMinutes', { m, s: seconds % 60 }) : t('main.elapsedSeconds', { s: seconds })
})
</script>

<template>
  <p class="elapsed">{{ label }}</p>
</template>

<style scoped>
/* Starts where the entries' text does: their padding, time column and gap. */
.elapsed { margin: 0 0 4px; padding-left: 58px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
