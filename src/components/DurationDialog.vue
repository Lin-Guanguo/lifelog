<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'

type Unit = 'minutes' | 'hours' | 'days'
const MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 24 * 60 }
const LABELS: Record<Unit, () => string> = {
  minutes: () => t('settings.unitMinutes'),
  hours: () => t('settings.unitHours'),
  days: () => t('settings.unitDays'),
}

// A duration picker in minutes; 0 means "off" (never / manual only), labelled by offLabel.
const props = defineProps<{ title: string; minutes: number; units: Unit[]; offLabel: string; fallbackMinutes: number }>()
const emit = defineEmits<{ save: [minutes: number]; cancel: [] }>()

// Start from the largest unit that divides the current value evenly.
function split(minutes: number): { amount: number; unit: Unit } {
  const unit = [...props.units].reverse().find((u) => minutes % MINUTES[u] === 0) ?? props.units[0]
  return { amount: Math.max(1, Math.round(minutes / MINUTES[unit])), unit }
}

const initial = split(props.minutes > 0 ? props.minutes : props.fallbackMinutes)
const amount = ref(initial.amount)
const unit = ref<Unit>(initial.unit)
const off = ref(props.minutes === 0)
const valid = computed(() => off.value || (Number.isInteger(amount.value) && amount.value > 0 && amount.value <= 9999))

function save() {
  if (valid.value) emit('save', off.value ? 0 : amount.value * MINUTES[unit.value])
}
</script>

<template>
  <ConfirmDialog :title="title" @cancel="emit('cancel')">
    <div class="row" :class="{ off }">
      <label for="duration-amount">{{ t('settings.customAmount') }}</label>
      <input id="duration-amount" v-model.number="amount" type="number" inputmode="numeric" min="1" max="9999" step="1" :disabled="off">
      <div class="seg" role="group" :aria-label="t('settings.customUnit')" style="flex-grow: 1">
        <button v-for="u in units" :key="u" type="button" :aria-pressed="unit === u" :disabled="off" @click="unit = u">{{ LABELS[u]() }}</button>
      </div>
    </div>
    <label class="off-toggle">
      <input v-model="off" type="checkbox">
      <span>{{ offLabel }}</span>
    </label>
    <template #actions>
      <button class="secondary" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="primary" type="button" :disabled="!valid" @click="save">{{ t('common.save') }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.row.off { opacity: .5; }
.row input { width: 88px; height: 44px; border: 1px solid var(--field); border-radius: 10px; padding: 0 12px; font-size: 16px; background: var(--ground); }
.off-toggle { display: flex; gap: 10px; align-items: center; min-height: 44px; font-size: 15px; }
</style>
