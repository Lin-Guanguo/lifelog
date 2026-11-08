<script setup lang="ts">
import { Clipboard } from '@capacitor/clipboard'
import { ref } from 'vue'
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'

const AUTHOR_EMAIL = 'lin.guanguo2000+lifelog@gmail.com'
const AUTHOR_GITHUB = 'https://github.com/Lin-Guanguo/lifelog'

const emit = defineEmits<{ close: [] }>()
const copied = ref<string>()
let timer: number | undefined

async function copy(value: string) {
  await Clipboard.write({ string: value })
  copied.value = value
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { copied.value = undefined }, 2000)
}
</script>

<template>
  <ConfirmDialog :title="t('about.title')" @cancel="emit('close')">
    <p class="name">{{ t('about.name') }}</p>
    <button v-for="item in [{ label: t('about.email'), value: AUTHOR_EMAIL }, { label: t('about.github'), value: AUTHOR_GITHUB }]"
      :key="item.value" class="copy-row" type="button" :aria-label="t('about.copyLabel', { item: item.label })" @click="copy(item.value)">
      <span class="label">{{ item.label }}</span>
      <span class="value">{{ item.value.replace('https://', '') }}</span>
      <span class="hint-text" :class="{ done: copied === item.value }" aria-live="polite">
        {{ copied === item.value ? t('about.copied') : t('about.tapToCopy') }}
      </span>
    </button>
    <template #actions>
      <button class="secondary" type="button" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.name { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink) !important; }
.copy-row { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; width: 100%; padding: 10px 0; border: 0;
  border-top: 1px solid var(--line); background: transparent; text-align: left; }
.label { font-size: 13px; color: var(--muted); }
.value { grid-column: 1 / -1; font-size: 15px; color: var(--accent); overflow-wrap: anywhere; }
.hint-text { grid-column: 2; grid-row: 1; justify-self: end; font-size: 12px; color: var(--muted); }
.hint-text.done { color: var(--ok); font-weight: 600; }
</style>
