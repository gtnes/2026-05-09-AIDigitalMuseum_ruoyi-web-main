<script setup lang="ts">
import { Link } from '@element-plus/icons-vue';

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
    <el-tooltip content="在新窗口打开" placement="left">
      <button class="vr-open-btn" aria-label="在新窗口打开" @click="openExternal">
        <el-icon class="vr-open-ico" :size="16">
          <Link />
        </el-icon>
      </button>
    </el-tooltip>
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgb(28 24 20 / 65%);
  color: #fff;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.vr-open-ico {
  color: #fff;
}
</style>
