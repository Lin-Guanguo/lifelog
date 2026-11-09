<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import AboutDialog from '../components/AboutDialog.vue'
import AppIcon from '../components/AppIcon.vue'
import DurationDialog from '../components/DurationDialog.vue'
import SyncSettings from '../components/SyncSettings.vue'
import { RETENTION_PRESETS, setLocalePreference, setRetentionHours } from '../data/preferences'
import { formatHours } from '../format'
import { localeName, localePreference, LOCALES, t, type LocalePreference } from '../i18n'
import { closeScreen, db, openScreen, retentionHours } from '../store'
import UpdateDialog from '../components/UpdateDialog.vue'
import { checkForUpdate, update } from '../update/controller'

const trashCount = ref(0)
const isCustom = computed(() => !RETENTION_PRESETS.includes(retentionHours.value))
useBackHandler(closeScreen)

const customOpen = ref(false)
const aboutOpen = ref(false)

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
          <button type="button" :aria-pressed="isCustom" @click="customOpen = true">{{ t('settings.custom') }}</button>
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

      <h2 class="section-title">{{ t('update.section') }}</h2>
      <button class="row-link" type="button" @click="checkForUpdate">
        <span>{{ t('update.check') }}</span>
        <AppIcon name="chevron" :size="16" />
      </button>
      <button class="row-link" type="button" style="margin: 12px 0 24px" @click="aboutOpen = true">
        <span>{{ t('about.title') }}</span>
        <AppIcon name="chevron" :size="16" />
      </button>
    </main>

    <DurationDialog v-if="customOpen" :title="t('settings.customTitle')" :minutes="retentionHours * 60" :units="['hours', 'days']"
      :off-label="t('settings.neverClear')" :fallback-minutes="7 * 24 * 60"
      @cancel="customOpen = false" @save="(minutes) => { customOpen = false; chooseRetention(minutes / 60) }" />
    <AboutDialog v-if="aboutOpen" @close="aboutOpen = false" />
    <UpdateDialog v-if="update.open" />
  </div>
</template>
