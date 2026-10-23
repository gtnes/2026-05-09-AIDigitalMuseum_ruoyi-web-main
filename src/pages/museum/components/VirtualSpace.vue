<script setup lang="ts">
import { Link } from '@element-plus/icons-vue';
import { onActivated, onDeactivated, ref, watch } from 'vue';

const props = defineProps<{
  /** VR页面地址 */
  url: string;
  /** VR标签当前是否显示：false时卸载iframe停止播放（跨域iframe无法仅暂停音频） */
  visible?: boolean;
}>();

// 跨域iframe内的音频/视频无法直接暂停，v-show隐藏也不会停止其播放；博物馆页被KeepAlive缓存，
// 路由离开（如点击AI馆员进入对话页）时组件也不会卸载。
// 处理：离开VR标签或离开博物馆页时卸载iframe停止播放；切回VR标签或返回页面（停在VR标签）时
// 重新挂载，VR从头加载
const frameAlive = ref(true);
onDeactivated(() => {
  frameAlive.value = false;
});
onActivated(() => {
  frameAlive.value = !!props.visible;
});
watch(() => props.visible, (v) => {
  frameAlive.value = v;
});

// 部分站点（如搜索引擎）通过CSP禁止被iframe嵌入，提供新窗口打开兜底
function openExternal() {
  window.open(props.url, '_blank', 'noopener');
}
</script>

<template>
  <div class="vr-view">
    <iframe
      v-if="frameAlive"
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
