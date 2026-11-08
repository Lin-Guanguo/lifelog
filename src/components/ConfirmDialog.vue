<script setup lang="ts">
import { useBackHandler } from '../back'

defineProps<{ title: string; message?: string; stacked?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()
useBackHandler(() => emit('cancel'))
</script>

<template>
  <Teleport to="body">
    <div class="dialog-wrap" @click.self="emit('cancel')">
      <div class="dialog" role="alertdialog" aria-modal="true" :aria-label="title">
        <h2>{{ title }}</h2>
        <p v-if="message">{{ message }}</p>
        <slot />
        <div class="actions" :class="{ stack: stacked }"><slot name="actions" /></div>
      </div>
    </div>
  </Teleport>
</template>
