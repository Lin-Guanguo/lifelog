<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackHandler } from '../back'
import { RESULT_LIMIT, type LogRecord } from '../data/records'
import { groupByDay, timeOf } from '../format'
import { t } from '../i18n'
import { closeScreen, db, logVersion } from '../store'
import AppIcon from '../components/AppIcon.vue'
import EntrySheet from '../components/EntrySheet.vue'
import HighlightText from '../components/HighlightText.vue'
import { photosOf, textOf } from '../media/content'

const query = ref('')
const results = ref<LogRecord[]>([])
const more = ref(false) // more matched than are shown
const input = ref<HTMLInputElement>()
const sheetRecord = ref<LogRecord>()
const days = computed(() => groupByDay(results.value))
useBackHandler(closeScreen)

let timer: number | undefined
async function run() {
  const q = query.value.trim()
  const page = q ? await db().searchLive(q) : { rows: [], more: false }
  results.value = page.rows
  more.value = page.more
}
watch(query, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(run, 150)
})
// Edits and deletes made from the sheet change the results.
watch(logVersion, run)

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="screen">
    <header class="topbar">
      <button class="icon-btn" type="button" :aria-label="t('common.back')" @click="closeScreen"><AppIcon name="back" /></button>
      <div class="search-field">
        <input ref="input" v-model="query" type="search" enterkeyhint="search" :aria-label="t('search.label')" :placeholder="t('search.placeholder')">
      </div>
    </header>
    <main class="scroll">
      <p v-if="!query.trim()" class="empty">{{ t('search.prompt') }}</p>
      <p v-else-if="results.length === 0" class="empty">{{ t('search.none') }}</p>
      <template v-else>
        <p class="hint">{{ more ? t('search.limited', { n: RESULT_LIMIT }) : t('search.summary', { n: results.length }) }}</p>
        <section v-for="day in days" :key="day.key" class="card result-day">
          <h2 class="section-title" style="margin: 0; padding: 10px 14px 2px">{{ day.label }}</h2>
          <button v-for="record in day.rows" :key="record.id" class="entry result" type="button" @click="sheetRecord = record">
            <time>{{ timeOf(record.logged_at) }}</time>
            <span class="text">
              <HighlightText :text="textOf(record.content)" :query="query.trim()" />
              <small v-if="photosOf(record.content).length" class="photo-count">{{ t('photo.count', { n: photosOf(record.content).length }) }}</small>
            </span>
          </button>
        </section>
      </template>
    </main>
    <EntrySheet v-if="sheetRecord" :record="sheetRecord" @close="sheetRecord = undefined" />
  </div>
</template>

<style scoped>
.result-day { margin-bottom: 12px; padding-bottom: 4px; }
.photo-count { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }
.result { width: 100%; border: 0; background: transparent; text-align: left; padding: 9px 14px; border-radius: 0; }
</style>
