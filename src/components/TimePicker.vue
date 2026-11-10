<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import { dateOf, dayKey, timeOf } from '../format'
import { t } from '../i18n'

// Custom entry time: a day (the last week as chips, older via the system date picker) and hour/minute
// wheels. Never later than now. Emits the chosen time, or null for "use now".
const props = defineProps<{ initial: number | null }>()
const emit = defineEmits<{ done: [time: number | null]; cancel: [] }>()
useBackHandler(() => emit('cancel'))

const ROW = 40 // px per wheel row
const start = new Date(props.initial ?? Date.now())
const day = ref(new Date(start.getFullYear(), start.getMonth(), start.getDate()))
const hour = ref(start.getHours())
const minute = ref(start.getMinutes())
const hours = ref<HTMLElement>()
const minutes = ref<HTMLElement>()
const earlier = ref<HTMLInputElement>()

const today = new Date()
const recent = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - i))
const days = computed(() => {
  const older = !recent.some((d) => dayKey(d.getTime()) === dayKey(day.value.getTime()))
  return older ? [...recent, day.value] : recent
})
const chosen = computed(() => new Date(day.value.getFullYear(), day.value.getMonth(), day.value.getDate(), hour.value, minute.value).getTime())
const future = computed(() => chosen.value > Date.now())
const pad = (n: number) => String(n).padStart(2, '0')

function dayName(d: Date): string {
  const i = recent.findIndex((r) => r.getTime() === d.getTime())
  return i === 0 ? t('time.today') : i === 1 ? t('time.yesterday') : `${d.getMonth() + 1}/${d.getDate()}`
}

function sub(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)
}

let timers: Record<string, number> = {}
function onWheel(which: 'h' | 'm') {
  const el = which === 'h' ? hours.value! : minutes.value!
  window.clearTimeout(timers[which])
  timers[which] = window.setTimeout(() => {
    const i = Math.round(el.scrollTop / ROW)
    if (which === 'h') hour.value = Math.min(23, i)
    else minute.value = Math.min(59, i)
  }, 60)
}

function scrollTo(which: 'h' | 'm', i: number) {
  const el = which === 'h' ? hours.value! : minutes.value!
  el.scrollTo({ top: i * ROW, behavior: 'smooth' })
  if (which === 'h') hour.value = i
  else minute.value = i
}

function pickEarlier() {
  const input = earlier.value!
  input.max = dayKey(Date.now())
  if (typeof input.showPicker === 'function') input.showPicker()
  else input.click()
}

function onEarlier() {
  const [y, m, d] = earlier.value!.value.split('-').map(Number)
  if (y) day.value = new Date(y, m - 1, d)
}

onMounted(async () => {
  timers = {}
  await nextTick()
  hours.value!.scrollTop = hour.value * ROW
  minutes.value!.scrollTop = minute.value * ROW
})
</script>

<template>
  <Teleport to="body">
    <div class="scrim picker-scrim" @click="emit('cancel')"></div>
    <div class="sheet picker" role="dialog" aria-modal="true" :aria-label="t('picker.title')">
      <span class="grabber"></span>
      <div class="head">
        <b>{{ t('picker.title') }}</b>
        <button class="text-btn" type="button" @click="emit('done', null)">{{ t('picker.useNow') }}</button>
      </div>
      <div class="days" role="group" :aria-label="t('picker.pickDate')">
        <button v-for="d in days" :key="d.getTime()" class="day" type="button" :aria-pressed="d.getTime() === day.getTime()" @click="day = d">
          <b>{{ dayName(d) }}</b><small>{{ sub(d) }}</small>
        </button>
        <button class="day" type="button" @click="pickEarlier"><b>{{ t('picker.earlier') }}</b><small>{{ t('picker.pickDate') }}</small></button>
        <input ref="earlier" class="earlier" type="date" tabindex="-1" aria-hidden="true" @change="onEarlier">
      </div>
      <div class="wheels">
        <span class="band"></span>
        <div ref="hours" class="wheel" role="listbox" :aria-label="t('picker.hour')" @scroll.passive="onWheel('h')">
          <div v-for="h in 24" :key="h" role="option" :aria-selected="h - 1 === hour" :class="{ on: h - 1 === hour }" @click="scrollTo('h', h - 1)">{{ pad(h - 1) }}</div>
        </div>
        <span class="colon">:</span>
        <div ref="minutes" class="wheel" role="listbox" :aria-label="t('picker.minute')" @scroll.passive="onWheel('m')">
          <div v-for="m in 60" :key="m" role="option" :aria-selected="m - 1 === minute" :class="{ on: m - 1 === minute }" @click="scrollTo('m', m - 1)">{{ pad(m - 1) }}</div>
        </div>
      </div>
      <p class="preview" :class="{ bad: future }">
        {{ future ? t('picker.future') : t('picker.preview', { date: dateOf(chosen), time: timeOf(chosen) }) }}
      </p>
      <div class="actions">
        <button class="secondary" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="primary" type="button" :disabled="future" @click="emit('done', chosen)">{{ t('picker.confirm') }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.picker-scrim { z-index: 30; }
.picker { z-index: 31; gap: 14px; max-height: none; }
.head { display: flex; align-items: center; }
.head b { flex-grow: 1; font-size: 17px; }
.days { display: flex; gap: 8px; overflow-x: auto; margin: 0 -20px; padding: 0 20px; scrollbar-width: none; position: relative; }
.days::-webkit-scrollbar { display: none; }
.day { flex-shrink: 0; min-width: 64px; height: 54px; border: 1.5px solid var(--line); border-radius: 12px; background: var(--surface);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 0 8px; }
.day b { font-size: 15px; font-weight: 600; }
.day small { font-size: 11px; color: var(--muted); }
.day[aria-pressed=true] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.earlier { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.wheels { position: relative; display: flex; justify-content: center; align-items: center; gap: 4px; height: 200px; }
.band { position: absolute; left: 0; right: 0; top: 80px; height: 40px; border-radius: 12px; background: var(--chip); }
.wheel { position: relative; width: 84px; height: 200px; overflow-y: auto; scroll-snap-type: y mandatory; scrollbar-width: none; padding: 80px 0;
  mask-image: linear-gradient(transparent, #000 30%, #000 70%, transparent); }
.wheel::-webkit-scrollbar { display: none; }
.wheel div { height: 40px; scroll-snap-align: center; display: flex; align-items: center; justify-content: center; font-size: 22px;
  color: var(--muted); font-variant-numeric: tabular-nums; cursor: pointer; }
.wheel div.on { color: var(--ink); font-weight: 600; }
.colon { position: relative; font-size: 22px; font-weight: 600; }
.preview { margin: 0; text-align: center; font-size: 14px; color: var(--muted); }
.preview.bad { color: var(--danger); }
.actions { display: flex; gap: 8px; }
.actions button { flex: 1; height: 48px; }
</style>
