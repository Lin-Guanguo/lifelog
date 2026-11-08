<script setup lang="ts">
import { App as CapApp } from '@capacitor/app'
import { onMounted, onUnmounted } from 'vue'
import { handleBack } from './back'
import EditView from './views/EditView.vue'
import MainView from './views/MainView.vue'
import RecordView from './views/RecordView.vue'
import SearchView from './views/SearchView.vue'
import SettingsView from './views/SettingsView.vue'
import TrashView from './views/TrashView.vue'
import { db, reloadLive, retentionDays, screens } from './store'

const removers: (() => void)[] = []

onMounted(async () => {
  const back = await CapApp.addListener('backButton', () => {
    if (!handleBack()) CapApp.exitApp()
  })
  // Cleanup also runs when the app returns to the foreground after a long pause.
  const resume = await CapApp.addListener('resume', async () => {
    await db().purgeExpired(retentionDays.value)
    await reloadLive()
  })
  removers.push(() => back.remove(), () => resume.remove())
})
onUnmounted(() => removers.forEach((r) => r()))
</script>

<template>
  <MainView />
  <template v-for="(screen, i) in screens" :key="i">
    <SearchView v-if="screen.name === 'search'" />
    <SettingsView v-else-if="screen.name === 'settings'" />
    <TrashView v-else-if="screen.name === 'trash'" />
    <RecordView v-else-if="screen.name === 'view'" :entry-id="screen.entryId" />
    <EditView v-else-if="screen.name === 'edit'" :entry-id="screen.entryId" />
  </template>
</template>
