import { createApp } from 'vue'
import App from './App.vue'
import { openRecords } from './data/sqlite'
import { localePreference, t } from './i18n'
import { getLocalePreference, getRetentionDays } from './data/preferences'
import { reloadLive, retentionDays, setRecords } from './store'
import './style.css'

async function start() {
  localePreference.value = await getLocalePreference()
  try {
    const records = await openRecords()
    setRecords(records)
    retentionDays.value = await getRetentionDays()
    await records.purgeExpired(retentionDays.value)
    await reloadLive()
  } catch (error) {
    document.getElementById('app')!.textContent = t('app.dbError', { error: String(error) })
    throw error
  }
  createApp(App).mount('#app')
}

start()
