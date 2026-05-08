<template>
  <button class="btn-primary" @click="onClick" data-testid="submit-button">{{ label }}</button>
</template>
<script setup lang="ts">
defineProps<{ label: string; onClick: () => void }>();
</script>
