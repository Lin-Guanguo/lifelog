import { createApp } from 'vue'
import App from './App.vue'
import { getLocalePreference, getRetentionHours } from './data/preferences'
import { openRecords } from './data/sqlite'
import { localePreference, t } from './i18n'
import { reloadLive, retentionHours, setRecords } from './store'
import { loadSync, noteChange } from './sync/controller'
import './style.css'

async function start() {
  localePreference.value = await getLocalePreference()
  try {
    await loadSync()
    const records = await openRecords(noteChange)
    setRecords(records)
    retentionHours.value = await getRetentionHours()
    await records.purgeExpired(retentionHours.value)
    await reloadLive()
  } catch (error) {
    document.getElementById('app')!.textContent = t('app.dbError', { error: String(error) })
    throw error
  }
  createApp(App).mount('#app')
}

start()
