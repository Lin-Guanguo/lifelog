<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBackHandler } from '../back'
import { dayKey, timeOf } from '../format'
import { t } from '../i18n'
import { takenAt, type PhotoRef } from '../media/content'
import AppIcon from './AppIcon.vue'
import MediaImage from './MediaImage.vue'
import TimePicker from './TimePicker.vue'

// After older photos are added: when did the entry happen? Each photo's capture time, now, or custom.
// Emits the chosen time (null = now).
const props = defineProps<{ photos: PhotoRef[]; current: number | null }>()
const emit = defineEmits<{ done: [time: number | null]; cancel: [] }>()
useBackHandler(() => emit('cancel'))

const timed = computed(() => props.photos
  .map((photo) => ({ photo, at: takenAt(photo) }))
  .filter((p): p is { photo: PhotoRef; at: number } => p.at !== null)
  .sort((a, b) => a.at - b.at))
// Older photos usually mean filling in the day: start on the first photo's time.
const chosen = ref<number | null>(props.current ?? timed.value[0]?.at ?? null)
const custom = ref<number | null>(props.current !== null && !timed.value.some((p) => p.at === props.current) ? props.current : null)
const picking = ref(false)

const isCustom = computed(() => chosen.value !== null && chosen.value === custom.value && !timed.value.some((p) => p.at === chosen.value))

function shortDay(ms: number): string {
  if (dayKey(ms) === dayKey(Date.now())) return t('time.today')
  if (dayKey(ms) === dayKey(Date.now() - 86_400_000)) return t('time.yesterday')
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
const label = (ms: number) => `${shortDay(ms)} ${timeOf(ms)}`
const ordinal = (i: number) => (i === 0 ? t('step.first') : i === timed.value.length - 1 ? t('step.last') : t('step.nth', { n: i + 1 }))

function onCustom(time: number | null) {
  picking.value = false
  custom.value = time
  chosen.value = time
}
</script>

<template>
  <Teleport to="body">
    <div class="screen step" role="dialog" aria-modal="true" :aria-label="t('step.title')">
      <header class="topbar">
        <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="emit('cancel')"><AppIcon name="close" /></button>
        <h1>{{ t('step.title') }}</h1>
      </header>
      <main class="scroll">
        <p class="question">{{ t('step.question') }}<small>{{ t('step.hint') }}</small></p>
        <button v-for="(p, i) in timed" :key="`${i}:${p.photo.file}`" class="option" type="button" :aria-pressed="chosen === p.at" @click="chosen = p.at">
          <MediaImage :photo="p.photo" class="thumb" />
          <span class="when"><b>{{ timeOf(p.at) }}</b><small>{{ shortDay(p.at) }} · {{ ordinal(i) }}</small></span>
          <span class="radio"></span>
        </button>
      </main>
      <footer class="foot">
        <div class="pair">
          <button class="pill" type="button" :aria-pressed="chosen === null" @click="chosen = null">{{ t('time.now') }}</button>
          <button class="pill" type="button" :aria-pressed="isCustom" @click="picking = true">
            <AppIcon name="clock" :size="18" />{{ isCustom ? label(chosen!) : t('step.custom') }}
          </button>
        </div>
        <button class="primary confirm" type="button" @click="emit('done', chosen)">
          {{ t('time.logAt', { time: chosen === null ? t('time.now') : label(chosen) }) }}
        </button>
      </footer>
    </div>
    <TimePicker v-if="picking" :initial="custom ?? chosen" @done="onCustom" @cancel="picking = false" />
  </Teleport>
</template>

<style scoped>
.step { z-index: 25; }
.question { margin: 4px 2px 12px; font-size: 15px; line-height: 1.5; }
.question small { display: block; color: var(--muted); font-size: 13px; }
.option { display: flex; align-items: center; gap: 14px; width: 100%; padding: 10px; margin-bottom: 8px; border: 1.5px solid var(--line);
  border-radius: 16px; background: var(--surface); text-align: left; }
.option[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); }
.thumb { width: 76px; height: 76px; border-radius: 10px; flex-shrink: 0; }
.when { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.when b { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.when small { font-size: 13px; color: var(--muted); }
.radio { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--field); flex-shrink: 0; }
.option[aria-pressed=true] .radio { border: 7px solid var(--accent); }
.foot { padding: 10px 16px 14px; background: var(--surface); border-top: 1px solid var(--line); flex-shrink: 0; }
.pair { display: flex; gap: 8px; margin-bottom: 10px; }
.pill { flex: 1; min-width: 0; height: 44px; border: 1.5px solid var(--line); border-radius: 12px; background: var(--surface); display: flex;
  align-items: center; justify-content: center; gap: 6px; font-size: 15px; white-space: nowrap; }
.pill[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.confirm { width: 100%; height: 48px; }
</style>
