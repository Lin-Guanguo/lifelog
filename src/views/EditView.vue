<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import { dateOf, timeOf } from '../format'
import { t } from '../i18n'
import { closeScreen, db, liveRecords, reloadLive } from '../store'
import AppIcon from '../components/AppIcon.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const props = defineProps<{ entryId: number }>()
// Snapshot: the edit applies to the text that was current when editing started.
const original = liveRecords.value.find((r) => r.entry_id === props.entryId)
const text = ref(original?.content ?? '')
const editor = ref<HTMLTextAreaElement>()
const leaving = ref(false)
const dirty = computed(() => text.value !== original?.content)
const canSave = computed(() => dirty.value && text.value.trim() !== '')

function leave() {
  if (dirty.value) leaving.value = true
  else closeScreen()
}
useBackHandler(leave)

async function save() {
  leaving.value = false
  if (!original || !canSave.value) return
  await db().edit(original, text.value.trim())
  await reloadLive()
  closeScreen()
}

function discard() {
  leaving.value = false
  closeScreen()
}

onMounted(() => {
  if (!original) closeScreen()
  editor.value?.focus()
})
</script>

<template>
  <div v-if="original" class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="leave"><AppIcon name="back" /></button>
      <h1>{{ t('edit.title', { date: dateOf(original.logged_at), time: timeOf(original.logged_at) }) }}</h1>
      <button class="primary" type="button" :disabled="!canSave" style="height: 40px" @click="save">{{ t('common.save') }}</button>
    </header>
    <main class="scroll" style="display: flex; flex-direction: column; gap: 10px">
      <textarea ref="editor" v-model="text" class="editor" :aria-label="t('edit.label')"></textarea>
      <p class="hint">{{ t('edit.hint') }}</p>
    </main>
    <ConfirmDialog v-if="leaving" :title="t('edit.leaveTitle')" :message="t('edit.leaveMessage')" stacked @cancel="leaving = false">
      <template #actions>
        <button class="primary" type="button" :disabled="!canSave" @click="save">{{ t('common.save') }}</button>
        <button class="secondary danger-text" type="button" @click="discard">{{ t('edit.discard') }}</button>
        <button class="secondary" type="button" @click="leaving = false">{{ t('edit.keepEditing') }}</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.editor { flex-grow: 1; min-height: 200px; border: 1px solid var(--accent); border-radius: 14px; outline: none; resize: none;
  font-size: 17px; line-height: 1.6; padding: 14px; background: var(--surface); }
</style>
