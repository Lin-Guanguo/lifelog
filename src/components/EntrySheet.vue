<script setup lang="ts">
import { ref } from 'vue'
import { useBackHandler } from '../back'
import type { LogRecord } from '../data/records'
import { dateOf, formatHours, timeOf } from '../format'
import { t } from '../i18n'
import { db, openScreen, reloadLive, retentionHours } from '../store'
import AppIcon from './AppIcon.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import EntryContent from './EntryContent.vue'

const SWIPE_PX = 60

const props = defineProps<{ record: LogRecord }>()
const emit = defineEmits<{ close: [] }>()
// The sheet slides out before the parent unmounts it (emit on after-leave).
const shown = ref(true)
const expanded = ref(false)
const confirming = ref(false)
const dragY = ref(0)
useBackHandler(() => {
  if (expanded.value) expanded.value = false
  else shown.value = false
})

function edit() {
  emit('close')
  openScreen({ name: 'edit', entryId: props.record.entry_id })
}

async function remove() {
  await db().trashEntries([props.record.entry_id])
  confirming.value = false
  shown.value = false
  await reloadLive()
}

// Dragging the handle: up expands; down collapses, then closes.
let dragStart: number | undefined
function onDragStart(event: PointerEvent) {
  dragStart = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function onDragMove(event: PointerEvent) {
  if (dragStart !== undefined) dragY.value = Math.max(0, event.clientY - dragStart)
}
function onDragEnd(event: PointerEvent) {
  if (dragStart === undefined) return
  const dy = event.clientY - dragStart
  dragStart = undefined
  dragY.value = 0
  if (dy < -SWIPE_PX) expanded.value = true
  else if (dy > SWIPE_PX && expanded.value) expanded.value = false
  else if (dy > SWIPE_PX) shown.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" appear>
      <div v-if="shown" class="scrim" @click="shown = false"></div>
    </Transition>
    <Transition name="slide-up" appear @after-leave="emit('close')">
      <div v-if="shown" class="sheet" :class="{ expanded, dragging: dragY > 0 }" role="dialog" aria-modal="true"
        :aria-label="t('sheet.label')" :style="dragY ? { transform: `translateY(${dragY}px)` } : undefined">
        <div class="handle" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
          <span class="grabber"></span>
          <div class="meta">{{ dateOf(record.logged_at) }} {{ timeOf(record.logged_at) }}</div>
        </div>
        <div class="sheet-body">
          <div class="sheet-text"><EntryContent :content="record.content" /></div>
          <div class="sheet-actions">
            <button class="round-btn" type="button" :aria-label="t(expanded ? 'sheet.collapse' : 'sheet.fullscreen')"
              :title="t(expanded ? 'sheet.collapse' : 'sheet.fullscreen')" @click="expanded = !expanded">
              <AppIcon :name="expanded ? 'collapse' : 'expand'" :size="20" />
            </button>
            <button class="round-btn" type="button" :aria-label="t('sheet.edit')" :title="t('sheet.edit')" style="color: var(--accent)" @click="edit">
              <AppIcon name="edit" :size="20" />
            </button>
            <button class="round-btn" type="button" :aria-label="t('sheet.delete')" :title="t('sheet.delete')" style="color: var(--danger)" @click="confirming = true">
              <AppIcon name="trash" :size="20" />
            </button>
          </div>
        </div>
      </div>
    </Transition>
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
.handle { display: flex; flex-direction: column; gap: 10px; margin: -10px -20px 0; padding: 10px 20px 4px; touch-action: none; }
.sheet-body { display: flex; gap: 8px; min-height: 0; flex-grow: 1; }
.sheet-text { flex-grow: 1; min-width: 0; overflow-y: auto; min-height: 96px; user-select: text; }
.sheet-actions { align-self: flex-end; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
</style>
