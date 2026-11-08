<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { dateOf, formatMinutes, timeOf } from '../format'
import DurationDialog from './DurationDialog.vue'
import { t } from '../i18n'
import { INTERVAL_PRESETS, remotePath, removeSettings, saveSettings, setSyncInterval, sync, syncNow } from '../sync/controller'

const form = reactive({
  url: sync.settings?.url ?? '',
  username: sync.settings?.username ?? '',
  password: sync.settings?.password ?? '',
  directory: sync.settings?.directory ?? 'LifeLog',
})
const testing = ref(false)
const formError = ref('')
const busy = computed(() => testing.value || sync.status === 'syncing')
const customOpen = ref(false)
const isCustom = computed(() => !!sync.settings && !INTERVAL_PRESETS.includes(sync.settings.intervalMinutes))

async function chooseCustom(minutes: number) {
  customOpen.value = false
  await setSyncInterval(minutes)
}

async function save() {
  testing.value = true
  formError.value = (await saveSettings({ ...form })) ?? ''
  testing.value = false
}

async function remove() {
  await removeSettings()
  form.password = ''
}
</script>

<template>
  <div class="card" style="padding: 2px 14px">
    <div class="field"><label for="dav-url">{{ t('sync.url') }}</label>
      <input id="dav-url" v-model="form.url" type="url" inputmode="url" autocomplete="off" :placeholder="t('sync.urlPlaceholder')"></div>
    <div class="field"><label for="dav-user">{{ t('sync.username') }}</label>
      <input id="dav-user" v-model="form.username" autocomplete="username" autocapitalize="off"></div>
    <div class="field"><label for="dav-pass">{{ t('sync.password') }}</label>
      <input id="dav-pass" v-model="form.password" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="dav-dir">{{ t('sync.directory') }}</label>
      <input id="dav-dir" v-model="form.directory" autocapitalize="off"></div>
  </div>
  <p v-if="formError" class="hint danger-text" role="alert">{{ formError }}</p>
  <div class="actions">
    <button class="secondary" type="button" :disabled="busy || !form.url || !form.username" @click="save">
      {{ testing ? t('sync.testing') : t('sync.saveAndTest') }}
    </button>
    <button v-if="sync.settings" class="text-btn danger-text" type="button" :disabled="busy" @click="remove">{{ t('sync.remove') }}</button>
  </div>

  <template v-if="sync.settings">
    <div class="card status" style="margin-top: 12px">
      <p class="status-line" role="status">
        <template v-if="sync.status === 'syncing'">{{ t('sync.syncing') }}</template>
        <template v-else-if="sync.state.lastSyncAt">{{ t('sync.lastSync', { date: dateOf(sync.state.lastSyncAt), time: timeOf(sync.state.lastSyncAt) }) }}</template>
        <template v-else>{{ t('sync.never') }}</template>
        <template v-if="sync.dirty && sync.status !== 'syncing'"> {{ t('sync.pending') }}</template>
      </p>
      <p v-if="sync.status === 'error'" class="hint danger-text" role="alert" style="margin: 0">{{ sync.error }}</p>
      <button class="primary" type="button" style="align-self: flex-start" :disabled="busy" @click="syncNow">{{ t('sync.now') }}</button>
      <div class="interval">
        <span>{{ t('sync.interval') }}</span>
        <div class="seg" role="group" :aria-label="t('sync.interval')">
          <button v-for="minutes in INTERVAL_PRESETS" :key="minutes" type="button" :aria-pressed="sync.settings.intervalMinutes === minutes"
            @click="setSyncInterval(minutes)">
            {{ formatMinutes(minutes) }}
          </button>
          <button type="button" :aria-pressed="isCustom" @click="customOpen = true">{{ t('settings.custom') }}</button>
        </div>
        <span v-if="isCustom" class="hint" style="margin: 0">
          {{ t('settings.current', { value: sync.settings.intervalMinutes > 0 ? formatMinutes(sync.settings.intervalMinutes) : t('sync.manualOnly') }) }}
        </span>
        <p class="hint" style="margin: 0">{{ t('sync.intervalHint') }}</p>
      </div>
    </div>
    <p class="hint">{{ t('sync.file', { path: remotePath(sync.settings) }) }}</p>
    <DurationDialog v-if="customOpen" :title="t('sync.customTitle')" :minutes="sync.settings.intervalMinutes"
      :units="['minutes', 'hours', 'days']" :off-label="t('sync.manualOnly')" :fallback-minutes="24 * 60"
      @cancel="customOpen = false" @save="chooseCustom" />
  </template>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.field:last-child { border-bottom: 0; }
.field label { font-size: 12px; color: var(--muted); }
.field input { border: 0; outline: none; font-size: 15px; padding: 2px 0; background: transparent; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.status { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.status-line { margin: 0; font-size: 15px; }
.interval { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 14px; }
</style>
