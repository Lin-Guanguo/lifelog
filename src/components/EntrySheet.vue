<script setup lang="ts">
import { ref } from 'vue'
import { useBackHandler } from '../back'
import type { LogRecord } from '../data/records'
import { dateOf, formatHours, timeOf } from '../format'
import { t } from '../i18n'
import { db, openScreen, reloadLive, retentionHours } from '../store'
import AppIcon from './AppIcon.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ record: LogRecord }>()
const emit = defineEmits<{ close: [] }>()
const confirming = ref(false)
useBackHandler(() => emit('close'))

function open(name: 'view' | 'edit') {
  emit('close')
  openScreen({ name, entryId: props.record.entry_id })
}

async function remove() {
  await db().trashEntries([props.record.entry_id])
  confirming.value = false
  emit('close')
  await reloadLive()
}
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click="emit('close')"></div>
    <div class="sheet" role="dialog" aria-modal="true" :aria-label="t('sheet.label')">
      <span class="grabber"></span>
      <div class="meta">{{ dateOf(record.logged_at) }} {{ timeOf(record.logged_at) }}</div>
      <div class="sheet-body">
        <p class="longtext sheet-text">{{ record.content }}</p>
        <div class="sheet-actions">
          <button class="round-btn" type="button" :aria-label="t('sheet.fullscreen')" :title="t('sheet.fullscreen')" @click="open('view')">
            <AppIcon name="expand" :size="20" />
          </button>
          <button class="round-btn" type="button" :aria-label="t('sheet.edit')" :title="t('sheet.edit')" style="color: var(--accent)" @click="open('edit')">
            <AppIcon name="edit" :size="20" />
          </button>
          <button class="round-btn" type="button" :aria-label="t('sheet.delete')" :title="t('sheet.delete')" style="color: var(--danger)" @click="confirming = true">
            <AppIcon name="trash" :size="20" />
          </button>
        </div>
      </div>
    </div>
    <ConfirmDialog v-if="confirming" :title="t('delete.title')"
      :message="retentionHours > 0 ? t('delete.message', { duration: formatHours(retentionHours) }) : t('delete.messageNoCleanup')"
      @cancel="confirming = false">
      <template #actions>
        <button class="secondary" type="button" @click="confirming = false">{{ t('common.cancel') }}</button>
        <button class="danger" type="button" @click="remove">{{ t('common.delete') }}</button>
      </template>
    </ConfirmDialog>
  </Teleport>
</template>

<style scoped>
.sheet-body { display: flex; gap: 8px; min-height: 0; }
.sheet-text { flex-grow: 1; min-width: 0; overflow-y: auto; min-height: 96px; }
.sheet-actions { align-self: flex-end; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
</style>
