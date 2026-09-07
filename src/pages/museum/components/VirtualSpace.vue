<script setup lang="ts">
const props = defineProps<{
  /** VR页面地址 */
  url: string;
}>();

// 部分站点（如搜索引擎）通过CSP禁止被iframe嵌入，提供新窗口打开兜底
function openExternal() {
  window.open(props.url, '_blank', 'noopener');
}
</script>

<template>
  <div class="vr-view">
    <iframe
      :src="url"
      class="vr-frame"
      frameborder="0"
      allow="fullscreen; xr-spatial-tracking"
    />
    <button class="vr-open-btn" @click="openExternal">
      在新窗口打开
    </button>
  </div>
</template>

<style scoped lang="scss">
.vr-view {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}

.vr-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.vr-open-btn {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: 14px;
  z-index: 10;
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: rgb(28 24 20 / 65%);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
</style>
