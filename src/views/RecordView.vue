<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useBackHandler } from '../back'
import { dateOf, formatHours, timeOf } from '../format'
import { t } from '../i18n'
import { closeScreen, db, liveRecords, openScreen, reloadLive, retentionHours } from '../store'
import AppIcon from '../components/AppIcon.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const props = defineProps<{ entryId: string }>()
const record = computed(() => liveRecords.value.find((r) => r.entry_id === props.entryId))
const confirming = ref(false)
useBackHandler(closeScreen)

// The entry can disappear (deleted here or elsewhere); there is nothing left to show.
watchEffect(() => {
  if (!record.value) closeScreen()
})

async function remove() {
  confirming.value = false
  await db().trashEntries([props.entryId])
  await reloadLive()
}
</script>

<template>
  <div v-if="record" class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="closeScreen"><AppIcon name="back" /></button>
      <h1>{{ dateOf(record.logged_at) }} {{ timeOf(record.logged_at) }}</h1>
      <button class="text-btn" type="button" @click="openScreen({ name: 'edit', entryId })">{{ t('view.edit') }}</button>
      <button class="text-btn danger-text" type="button" @click="confirming = true">{{ t('common.delete') }}</button>
    </header>
    <main class="scroll" style="padding: 20px">
      <p class="longtext" style="user-select: text">{{ record.content }}</p>
    </main>
    <ConfirmDialog v-if="confirming" :title="t('delete.title')"
      :message="retentionHours > 0 ? t('delete.message', { duration: formatHours(retentionHours) }) : t('delete.messageNoCleanup')"
      @cancel="confirming = false">
      <template #actions>
        <button class="secondary" type="button" @click="confirming = false">{{ t('common.cancel') }}</button>
        <button class="danger" type="button" @click="remove">{{ t('common.delete') }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>
