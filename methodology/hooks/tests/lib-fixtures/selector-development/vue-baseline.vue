<template>
  <button class="btn-primary" @click="onClick">{{ label }}</button>
</template>
<script setup lang="ts">
defineProps<{ label: string; onClick: () => void }>();
</script>
