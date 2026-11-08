<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import AppIcon from '../components/AppIcon.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SyncSettings from '../components/SyncSettings.vue'
import { RETENTION_PRESETS, setLocalePreference, setRetentionHours } from '../data/preferences'
import { formatHours } from '../format'
import { localeName, localePreference, LOCALES, t, type LocalePreference } from '../i18n'
import { closeScreen, db, openScreen, retentionHours } from '../store'

const trashCount = ref(0)
const isCustom = computed(() => !RETENTION_PRESETS.includes(retentionHours.value))
useBackHandler(closeScreen)

// Custom retention dialog: an amount in hours or days, or never.
const custom = ref<{ amount: number; unit: 'hours' | 'days'; never: boolean }>()
const customValid = computed(() => custom.value && (custom.value.never
  || (Number.isInteger(custom.value.amount) && custom.value.amount > 0 && custom.value.amount <= 9999)))

function openCustom() {
  const hours = retentionHours.value
  custom.value = hours === 0
    ? { amount: 7, unit: 'days', never: true }
    : hours % 24 === 0 ? { amount: hours / 24, unit: 'days', never: false } : { amount: hours, unit: 'hours', never: false }
}

async function applyCustom() {
  const c = custom.value
  if (!c || !customValid.value) return
  custom.value = undefined
  await chooseRetention(c.never ? 0 : c.unit === 'days' ? c.amount * 24 : c.amount)
}

async function chooseRetention(hours: number) {
  retentionHours.value = hours
  await setRetentionHours(hours)
  await db().purgeExpired(hours)
  trashCount.value = await db().countTrash()
}

async function chooseLocale(preference: LocalePreference) {
  localePreference.value = preference
  await setLocalePreference(preference)
}

onMounted(async () => {
  trashCount.value = await db().countTrash()
})
</script>

<template>
  <div class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="closeScreen"><AppIcon name="back" /></button>
      <h1>{{ t('settings.title') }}</h1>
    </header>
    <main class="scroll">
      <h2 class="section-title">{{ t('settings.language') }}</h2>
      <div class="seg" role="group" :aria-label="t('settings.language')">
        <button type="button" :aria-pressed="localePreference === 'system'" @click="chooseLocale('system')">{{ t('settings.languageSystem') }}</button>
        <button v-for="code in LOCALES" :key="code" type="button" :aria-pressed="localePreference === code" @click="chooseLocale(code)">
          {{ localeName(code) }}
        </button>
      </div>

      <h2 class="section-title">{{ t('settings.trashSection') }}</h2>
      <div class="card" style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px">
        <span style="font-size: 15px">{{ t('settings.retention') }}</span>
        <div class="seg" role="group" :aria-label="t('settings.retentionLabel')">
          <button v-for="hours in RETENTION_PRESETS" :key="hours" type="button" :aria-pressed="retentionHours === hours" @click="chooseRetention(hours)">
            {{ formatHours(hours) }}
          </button>
          <button type="button" :aria-pressed="isCustom" @click="openCustom">{{ t('settings.custom') }}</button>
        </div>
        <span v-if="isCustom" class="hint" style="margin: 0">
          {{ t('settings.current', { value: retentionHours > 0 ? formatHours(retentionHours) : t('settings.never') }) }}
        </span>
      </div>
      <button class="row-link" type="button" style="margin-top: 12px" @click="openScreen({ name: 'trash' })">
        <AppIcon name="trash" :size="20" />
        <span>{{ t('settings.openTrash') }}</span>
        <span style="color: var(--muted)">{{ t('settings.trashCount', { n: trashCount }) }}</span>
        <AppIcon name="chevron" :size="16" />
      </button>

      <h2 class="section-title">{{ t('sync.title') }}</h2>
      <SyncSettings />
    </main>

    <ConfirmDialog v-if="custom" :title="t('settings.customTitle')" @cancel="custom = undefined">
      <div class="custom-row" :class="{ off: custom.never }">
        <label for="custom-amount">{{ t('settings.customAmount') }}</label>
        <input id="custom-amount" v-model.number="custom.amount" type="number" inputmode="numeric" min="1" max="9999" step="1" :disabled="custom.never">
        <div class="seg" role="group" :aria-label="t('settings.customUnit')" style="flex-grow: 1">
          <button type="button" :aria-pressed="custom.unit === 'hours'" :disabled="custom.never" @click="custom.unit = 'hours'">{{ t('settings.unitHours') }}</button>
          <button type="button" :aria-pressed="custom.unit === 'days'" :disabled="custom.never" @click="custom.unit = 'days'">{{ t('settings.unitDays') }}</button>
        </div>
      </div>
      <label class="never">
        <input v-model="custom.never" type="checkbox">
        <span>{{ t('settings.neverClear') }}</span>
      </label>
      <template #actions>
        <button class="secondary" type="button" @click="custom = undefined">{{ t('common.cancel') }}</button>
        <button class="primary" type="button" :disabled="!customValid" @click="applyCustom">{{ t('common.save') }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.custom-row { display: flex; gap: 10px; align-items: center; }
.custom-row.off { opacity: .5; }
.custom-row input { width: 96px; height: 44px; border: 1px solid var(--field); border-radius: 10px; padding: 0 12px; font-size: 16px; background: var(--ground); }
.never { display: flex; gap: 10px; align-items: center; min-height: 44px; font-size: 15px; }
</style>
