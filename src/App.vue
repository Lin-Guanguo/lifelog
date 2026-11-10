<script setup lang="ts">
import { App as CapApp } from '@capacitor/app'
import { onMounted, onUnmounted } from 'vue'
import { handleBack } from './back'
import { draft, importPhotos, incoming, notice, offerPhotoTimes, timePicker, timeStep } from './compose'
import { platform } from './media/photos'
import TimePicker from './components/TimePicker.vue'
import TimeStep from './components/TimeStep.vue'
import ComposeView from './views/ComposeView.vue'
import EditView from './views/EditView.vue'
import MainView from './views/MainView.vue'
import SearchView from './views/SearchView.vue'
import SettingsView from './views/SettingsView.vue'
import TrashView from './views/TrashView.vue'
import { db, reloadLive, retentionHours, screens } from './store'
import { autoSync, startAutoSync } from './sync/controller'

const removers: (() => void)[] = []

// Photos shared to LifeLog from another app join the draft. Screens without unsaved work close so the
// draft is in view; an open edit stays.
async function receiveShared() {
  const photos = await importPhotos('shared')
  if (photos.length === 0) return
  screens.value = screens.value.filter((s) => s.name === 'edit' || s.name === 'compose')
  if (screens.value.some((s) => s.name === 'compose')) {
    incoming.value = photos
    return
  }
  draft.photos.push(...photos)
  offerPhotoTimes(draft.photos)
}

onMounted(async () => {
  const back = await CapApp.addListener('backButton', () => {
    if (!handleBack()) CapApp.exitApp()
  })
  // Cleanup and sync also run when the app returns to the foreground after a pause.
  const resume = await CapApp.addListener('resume', async () => {
    await db().purgeExpired(retentionHours.value)
    await reloadLive()
    autoSync()
  })
  removers.push(() => back.remove(), () => resume.remove(), startAutoSync())
  platform.onShared(() => void receiveShared())
  await receiveShared()
})
onUnmounted(() => removers.forEach((r) => r()))
</script>

<template>
  <MainView />
  <TransitionGroup name="screen">
    <template v-for="(screen, i) in screens" :key="i">
      <SearchView v-if="screen.name === 'search'" />
      <SettingsView v-else-if="screen.name === 'settings'" />
      <TrashView v-else-if="screen.name === 'trash'" />
      <EditView v-else-if="screen.name === 'edit'" :entry-id="screen.entryId" />
      <ComposeView v-else-if="screen.name === 'compose'" />
    </template>
  </TransitionGroup>
  <TimeStep v-if="timeStep" :photos="timeStep" :current="draft.time" @done="(time) => { draft.time = time; timeStep = null }" @cancel="timeStep = null" />
  <TimePicker v-if="timePicker" :initial="draft.time" @done="(time) => { draft.time = time; timePicker = false }" @cancel="timePicker = false" />
  <div v-if="notice" class="notice" role="status">{{ notice }}</div>
</template>
