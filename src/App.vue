<script setup lang="ts"></script>

<template>
  <router-view v-slot="{ Component }">
    <!-- 缓存博物馆主页：从播放页/对话页返回时保持列表滚动位置与筛选状态 -->
    <KeepAlive include="Museum">
      <component :is="Component" />
    </KeepAlive>
  </router-view>
</template>

<style scoped lang="scss"></style>
