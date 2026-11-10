<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackHandler } from '../back'
import { chooseTime, clearDraft, draft, importPhotos, incoming, offerPhotoTimes } from '../compose'
import { logTime } from '../format'
import { t } from '../i18n'
import { composeContent, parseContent, photosOf } from '../media/content'
import type { PhotoSource } from '../media/photos'
import { closeScreen, db, reloadLive } from '../store'
import AppIcon from '../components/AppIcon.vue'
import BlockEditor from '../components/BlockEditor.vue'

// The draft in the layout editor: photos placed between paragraphs. Leaving without sending keeps the
// draft for the composer, as its text and photos (photos after the text).
const content = ref(composeContent(draft.text, draft.photos))
const editor = ref<InstanceType<typeof BlockEditor>>()
const photos = computed(() => photosOf(content.value))
const canSend = computed(() => content.value.trim() !== '')

function leave() {
  draft.text = parseContent(content.value).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n')
  draft.photos = photosOf(content.value)
  closeScreen()
}
useBackHandler(leave)

async function send() {
  if (!canSend.value) return
  await db().add(content.value, draft.time ?? undefined)
  clearDraft()
  await reloadLive()
  closeScreen()
}

async function add(source: PhotoSource) {
  const added = await importPhotos(source)
  editor.value?.insert(added)
  if (source !== 'capture') offerPhotoTimes(photosOf(content.value))
}

watch(incoming, (photos) => {
  if (photos.length === 0) return
  editor.value?.insert(photos)
  incoming.value = []
  offerPhotoTimes(photosOf(content.value))
})

onMounted(() => editor.value?.focusEnd())
</script>

<template>
  <div class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="leave"><AppIcon name="back" /></button>
      <h1>{{ t('compose.title') }}</h1>
      <button class="primary" type="button" :disabled="!canSend" style="height: 40px" @click="send">{{ t('compose.send') }}</button>
    </header>
    <div v-if="draft.time !== null" class="timechip">
      <AppIcon name="clock" :size="18" />
      <button type="button" class="chip-text" @click="chooseTime(photos)">{{ t('time.logAt', { time: logTime(draft.time) }) }}</button>
      <button type="button" class="chip-x" :aria-label="t('time.backToNow')" @click="draft.time = null"><AppIcon name="close" :size="16" /></button>
    </div>
    <BlockEditor ref="editor" v-model="content">
      <template #tools>
        <button class="icon-btn tool" type="button" :aria-label="t('photo.camera')" @mousedown.prevent @click="add('capture')"><AppIcon name="camera" /></button>
        <button class="icon-btn tool" type="button" :aria-label="t('photo.gallery')" @mousedown.prevent @click="add('pick')"><AppIcon name="image" /></button>
        <button class="icon-btn tool" :class="{ set: draft.time !== null }" type="button" :aria-label="t('photo.time')" @mousedown.prevent
          @click="chooseTime(photos)"><AppIcon name="clock" /></button>
      </template>
    </BlockEditor>
  </div>
</template>

<style scoped>
.tool { width: 42px; height: 42px; color: var(--muted); }
.tool.set { color: var(--accent); }
</style>
