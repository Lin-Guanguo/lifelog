<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackHandler } from '../back'
import { t } from '../i18n'
import AppIcon from './AppIcon.vue'

export type EntryAction = 'copy' | 'input' | 'delete' | 'select'

const GAP = 8 // from the entry and from the screen's edges

// Opened by a long press on an entry: `x` is where the finger is, `top` and `bottom` the entry's edges on screen.
const props = defineProps<{ x: number; top: number; bottom: number; hasText: boolean }>()
const emit = defineEmits<{ pick: [action: EntryAction]; close: [] }>()
// The menu fades out before the parent unmounts it (emit on after-leave).
const shown = ref(true)
useBackHandler(() => { shown.value = false })

// The finger that opened the menu is still down, and lifting it can count as a tap on whatever is under it now:
// nothing here reacts until a press starts on the menu itself.
let armed = false
function arm() {
  armed = true
}

function pick(action?: EntryAction) {
  if (!armed) return
  if (action) emit('pick', action)
  shown.value = false
}

// Below the entry when it fits, else above it, else at the bottom of the screen; centred on the finger.
const menu = ref<HTMLElement>()
const place = ref<Record<string, string>>()
onMounted(() => {
  const { offsetWidth: width, offsetHeight: height } = menu.value!
  const left = Math.max(GAP, Math.min(props.x - width / 2, window.innerWidth - width - GAP))
  const below = props.bottom + GAP
  const above = props.top - GAP - height
  const fitsBelow = below + height <= window.innerHeight - GAP
  const top = fitsBelow ? below : above >= GAP ? above : Math.max(GAP, window.innerHeight - height - GAP)
  place.value = { left: `${left}px`, top: `${top}px`, transformOrigin: `${props.x - left}px ${fitsBelow ? 'top' : 'bottom'}` }
})
</script>

<template>
  <Teleport to="body">
    <!-- mousedown.prevent keeps the keyboard open -->
    <Transition name="fade" appear>
      <div v-if="shown" class="menu-scrim" @pointerdown="arm" @mousedown.prevent @click="pick()"></div>
    </Transition>
    <Transition name="pop" appear @after-leave="emit('close')">
      <div v-if="shown" ref="menu" class="menu" role="menu" :aria-label="t('menu.label')" :style="place" @pointerdown="arm">
        <button type="button" role="menuitem" :disabled="!hasText" @mousedown.prevent @click="pick('copy')">
          <AppIcon name="copy" :size="20" />{{ t('menu.copy') }}
        </button>
        <button type="button" role="menuitem" :disabled="!hasText" @mousedown.prevent @click="pick('input')">
          <AppIcon name="toInput" :size="20" />{{ t('menu.toInput') }}
        </button>
        <button class="danger-text" type="button" role="menuitem" @mousedown.prevent @click="pick('delete')">
          <AppIcon name="trash" :size="20" />{{ t('common.delete') }}
        </button>
        <button type="button" role="menuitem" @mousedown.prevent @click="pick('select')">
          <AppIcon name="select" :size="20" />{{ t('menu.select') }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.menu-scrim { position: fixed; inset: 0; z-index: 25; background: rgba(0, 0, 0, .14); }
.menu { position: fixed; z-index: 25; min-width: 184px; padding: 6px; border-radius: 16px; background: var(--surface);
  border: 1px solid var(--line); box-shadow: 0 10px 32px rgba(0, 0, 0, .2); display: flex; flex-direction: column; }
.menu button { display: flex; align-items: center; gap: 14px; height: 46px; padding: 0 18px 0 12px; border: 0; border-radius: 10px;
  background: transparent; font-size: 16px; text-align: left; white-space: nowrap; }
.menu button:not(.danger-text) :deep(svg) { color: var(--muted); }
.menu button:active:not(:disabled) { background: var(--chip); }
.pop-enter-active { transition: transform .18s var(--ease), opacity .18s var(--ease); }
.pop-leave-active { transition: opacity .12s var(--ease); pointer-events: none; }
.pop-enter-from { transform: scale(.88); opacity: 0; }
.pop-leave-to { opacity: 0; }
</style>
