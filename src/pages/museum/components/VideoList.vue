<script setup lang="ts">
import type { MuseumVideo } from '@/api/museum/types';
import { Share as ShareIcon } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { getMuseumVideos } from '@/api/museum';

const props = defineProps<{
  /** 博物馆id */
  museumId: string;
  /** 博物馆logo（卡片角标） */
  logo?: string;
}>();

const emit = defineEmits<{
  share: [];
}>();

const videoList = ref<MuseumVideo[]>([]);
const loaded = ref(false);

onMounted(async () => {
  // TODO: 视频列表接口待后端提供后接入
  const res = await getMuseumVideos(props.museumId);
  videoList.value = res.data || [];
  loaded.value = true;
});

// 分享视频
async function onShare(video: MuseumVideo) {
  const shareUrl = window.location.href;
  if (navigator.share) {
    try {
      await navigator.share({ title: video.name, url: shareUrl });
    }
    catch {}
  }
  else {
    try {
      await navigator.clipboard.writeText(shareUrl);
      ElMessage.success('链接已复制');
    }
    catch {
      ElMessage.error('复制失败');
    }
  }
  emit('share');
}
</script>

<template>
  <div class="video-view">
    <h2 class="video-title">
      全部
    </h2>
    <div v-if="videoList.length > 0" class="video-grid">
      <div v-for="video in videoList" :key="video.id" class="video-card">
        <div class="video-cover">
          <img :src="video.coverUrl" :alt="video.name" draggable="false">
          <img v-if="logo" :src="logo" class="video-logo" alt="">
        </div>
        <div class="video-body">
          <div class="video-name">
            {{ video.name }}
          </div>
          <button class="video-share" @click.stop="onShare(video)">
            <el-icon :size="14">
              <ShareIcon />
            </el-icon>
            <span>分享</span>
          </button>
        </div>
      </div>
    </div>
    <div v-else-if="loaded" class="video-empty">
      暂无视频
    </div>
  </div>
</template>

<style scoped lang="scss">
.video-view {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: #f6f2ea;
  padding: 14px;
  box-sizing: border-box;
}

.video-title {
  margin: 4px 2px 14px;
  font-size: 20px;
  font-weight: 600;
  color: #4d3b26;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.video-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgb(94 74 44 / 8%);
}

.video-cover {
  position: relative;
  aspect-ratio: 16 / 10;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-logo {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    object-fit: cover;
    background: #fff;
  }
}

.video-body {
  padding: 10px 10px 12px;
}

.video-name {
  margin-bottom: 10px;
  font-size: 16px;
  color: #4a3822;
  line-height: 1.4;
}

.video-share {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  background: #f3e9d5;
  color: #8a6f45;
  font-size: 13px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.video-empty {
  padding-top: 100px;
  text-align: center;
  font-size: 15px;
  color: #b0a289;
}
</style>
