<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import { localeName, localePreference, LOCALES, t, type LocalePreference } from '../i18n'
import { RETENTION_OPTIONS, setLocalePreference, setRetentionDays } from '../data/preferences'
import { closeScreen, db, openScreen, retentionDays } from '../store'
import AppIcon from '../components/AppIcon.vue'

const trashCount = ref(0)
useBackHandler(closeScreen)

async function chooseRetention(days: number) {
  retentionDays.value = days
  await setRetentionDays(days)
  await db().purgeExpired(days)
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

      <h2 class="section-title">{{ t('settings.sync') }}</h2>
      <p class="hint">{{ t('settings.syncLater') }}</p>

      <h2 class="section-title">{{ t('settings.trashSection') }}</h2>
      <div class="card" style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px">
        <span style="font-size: 15px">{{ t('settings.retention') }}</span>
        <div class="seg" role="group" :aria-label="t('settings.retentionLabel')">
          <button v-for="days in RETENTION_OPTIONS" :key="days" type="button" :aria-pressed="retentionDays === days" @click="chooseRetention(days)">
            {{ days > 0 ? t('settings.days', { n: days }) : t('settings.never') }}
          </button>
        </div>
      </div>
      <button class="row-link" type="button" style="margin-top: 12px" @click="openScreen({ name: 'trash' })">
        <AppIcon name="trash" :size="20" />
        <span>{{ t('settings.openTrash') }}</span>
        <span style="color: var(--muted)">{{ t('settings.trashCount', { n: trashCount }) }}</span>
        <AppIcon name="chevron" :size="16" />
      </button>
    </main>
  </div>
</template>
