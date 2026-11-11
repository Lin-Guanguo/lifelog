<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import { importPhotos } from '../compose'
import { dateOf, timeOf } from '../format'
import { t } from '../i18n'
import type { PhotoSource } from '../media/photos'
import type { LogRecord } from '../data/records'
import { closeScreen, db, logChanged } from '../store'
import AppIcon from '../components/AppIcon.vue'
import BlockEditor from '../components/BlockEditor.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

// Snapshot: the edit applies to the text that was current when editing started.
const props = defineProps<{ record: LogRecord }>()
const original = props.record
const text = ref(original.content)
const editor = ref<InstanceType<typeof BlockEditor>>()
const leaving = ref(false)
const dirty = computed(() => text.value !== original.content)
const canSave = computed(() => dirty.value && text.value.trim() !== '')

function leave() {
  if (dirty.value) leaving.value = true
  else closeScreen()
}
useBackHandler(leave)

async function save() {
  leaving.value = false
  if (!canSave.value) return
  await db().edit(original, text.value.trim())
  logChanged()
  closeScreen()
}

function discard() {
  leaving.value = false
  closeScreen()
}

async function add(source: PhotoSource) {
  editor.value?.insert(await importPhotos(source))
}

onMounted(() => editor.value?.focusEnd())
</script>

<template>
  <div class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="leave"><AppIcon name="back" /></button>
      <h1>{{ t('edit.title', { date: dateOf(original.logged_at), time: timeOf(original.logged_at) }) }}</h1>
      <button class="primary" type="button" :disabled="!canSave" style="height: 40px" @click="save">{{ t('common.save') }}</button>
    </header>
    <p class="hint edit-hint">{{ t('edit.hint') }}</p>
    <BlockEditor ref="editor" v-model="text">
      <template #tools>
        <button class="icon-btn tool" type="button" :aria-label="t('photo.camera')" @mousedown.prevent @click="add('capture')"><AppIcon name="camera" /></button>
        <button class="icon-btn tool" type="button" :aria-label="t('photo.gallery')" @mousedown.prevent @click="add('pick')"><AppIcon name="image" /></button>
      </template>
    </BlockEditor>
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
.edit-hint { margin: 10px 16px 0; }
.tool { width: 42px; height: 42px; color: var(--muted); }
</style>
