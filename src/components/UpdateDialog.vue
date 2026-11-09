<script setup lang="ts">
import { t } from '../i18n'
import { APP_VERSION, closeUpdate, update } from '../update/controller'
import ConfirmDialog from './ConfirmDialog.vue'
</script>

<template>
  <ConfirmDialog :title="update.release ? t('update.title', { version: update.release.version }) : t('update.check')"
    :message="t('update.current', { version: APP_VERSION })" :stacked="!!update.release" @cancel="closeUpdate">
    <p v-if="update.status === 'checking'" role="status">{{ t('update.checking') }}</p>
    <p v-else-if="update.status === 'latest'" role="status">{{ t('update.latest') }}</p>
    <p v-else-if="update.status === 'error'" class="danger-text" role="alert">{{ t('update.failed', { error: update.error }) }}</p>
    <template v-else-if="update.release">
      <div v-if="update.release.notes" class="compare notes">{{ update.release.notes }}</div>
      <p class="hint" style="margin: 0">{{ t('update.hint') }}</p>
    </template>
    <template #actions>
      <!-- Outside links: Capacitor opens them in the system browser. -->
      <template v-if="update.release">
        <a class="primary link-btn" :href="update.release.apkUrl" target="_blank" rel="noopener" @click="closeUpdate">
          {{ t('update.download') }}
        </a>
        <a class="secondary link-btn" :href="update.release.pageUrl" target="_blank" rel="noopener" @click="closeUpdate">
          {{ t('update.view') }}
        </a>
        <button class="secondary" type="button" @click="closeUpdate">{{ t('update.later') }}</button>
      </template>
      <button v-else class="secondary" type="button" @click="closeUpdate">{{ t('common.close') }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.notes { max-height: 30vh; }
.link-btn { display: flex; align-items: center; justify-content: center; text-decoration: none; }
.link-btn.secondary { color: var(--ink); }
</style>
