<script setup lang="ts">
import type { MuseumVideo } from '@/api/museum/types';
import { ArrowLeft, ArrowRight, ChatDotRound, Microphone, Refresh } from '@element-plus/icons-vue';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getVideoInfo } from '@/api/museum';

const route = useRoute();
const router = useRouter();

const videoId = computed(() => (route.query.id as string) || '');
const museumId = computed(() => (route.query.museumId as string) || '');
const chatappId = computed(() => (route.query.chatappId as string) || '');

const video = ref<MuseumVideo | null>(null);
const loading = ref(true);

// 返回上一个页面（从AI视频列表进入时返回列表）
function goBack() {
  if (window.history.length > 1) {
    router.back();
  }
  else {
    router.push('/museum');
  }
}

// 预设问题：与对话页一致的模块（每页3个，点击刷新轮换，更多/收起）
const PRESET_PAGE_SIZE = 3;
const presetPageIndex = ref(0);
const presetExpanded = ref(false);
const presetRefreshing = ref(false);
const presetQuestions = computed(() => video.value?.presetQuestions || []);
const presetPageCount = computed(() => Math.ceil(presetQuestions.value.length / PRESET_PAGE_SIZE));
const visiblePresetQuestions = computed(() => {
  const list = presetQuestions.value;
  if (presetExpanded.value)
    return list;
  if (list.length <= PRESET_PAGE_SIZE)
    return list;
  const start = presetPageIndex.value * PRESET_PAGE_SIZE;
  return list.slice(start, start + PRESET_PAGE_SIZE);
});

function refreshPresetQuestions() {
  if (presetPageCount.value <= 1)
    return;
  presetRefreshing.value = true;
  setTimeout(() => {
    presetPageIndex.value = (presetPageIndex.value + 1) % presetPageCount.value;
    presetRefreshing.value = false;
  }, 300);
}

function togglePresetExpand() {
  presetExpanded.value = !presetExpanded.value;
}

// 进入AI讲解员对话页（可携带预设问题自动发送）
function goChat(question?: string) {
  if (!chatappId.value)
    return;
  router.push({
    path: '/app-chat',
    query: {
      appId: chatappId.value,
      museumId: museumId.value,
      ...(question ? { q: question } : {}),
    },
  });
}

onMounted(async () => {
  if (!videoId.value) {
    loading.value = false;
    return;
  }
  try {
    const res = await getVideoInfo(videoId.value);
    if (res.code === 200 && res.data) {
      res.data.videoUrl = (res.data.videoUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
      res.data.coverUrl = (res.data.coverUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
      video.value = res.data;
    }
  }
  catch {}
  loading.value = false;
});
</script>

<template>
  <div class="play-page">
    <div class="phone">
      <!-- 加载中/参数错误 -->
      <div v-if="loading" class="state-view">
        <span class="state-text">加载中...</span>
      </div>
      <div v-else-if="!video" class="state-view">
        <span class="state-text">视频不存在或已下架</span>
      </div>

      <template v-else>
        <!-- 视频播放器 -->
        <div class="player">
          <video
            :src="video.videoUrl"
            :poster="video.coverUrl"
            controls
            autoplay
            playsinline
            webkit-playsinline
            class="player-video"
          />
        </div>

        <!-- 视频信息 -->
        <div class="video-info">
          <div class="video-name">
            {{ video.title }}
          </div>
          <div v-if="video.showCategory" class="video-tag">
            {{ video.showCategory }}
          </div>
          <div v-if="video.description" class="video-desc">
            {{ video.description }}
          </div>
        </div>

        <!-- 底部：预设问题模块 + 与AI讲解员通话按钮 -->
        <div class="play-footer">
          <div v-if="presetQuestions.length > 0" class="preset-questions">
            <div class="preset-header">
              <el-icon :size="18" class="preset-title-icon">
                <ChatDotRound />
              </el-icon>
              <span class="preset-title">你可以试着问我</span>
              <el-icon
                v-if="!presetExpanded && presetPageCount > 1"
                class="preset-refresh"
                :class="{ spinning: presetRefreshing }"
                :size="16"
                @click="refreshPresetQuestions"
              >
                <Refresh />
              </el-icon>
              <div class="preset-more" @click="togglePresetExpand">
                <span>{{ presetExpanded ? '收起' : '更多' }}</span>
                <el-icon :size="12" class="preset-more-arrow" :class="{ expanded: presetExpanded }">
                  <ArrowRight />
                </el-icon>
              </div>
            </div>
            <div class="preset-list">
              <div
                v-for="question in visiblePresetQuestions"
                :key="question"
                class="preset-item"
                @click="goChat(question)"
              >
                <span class="preset-dot" />
                <span class="preset-text">{{ question }}</span>
              </div>
            </div>
          </div>

          <button v-if="chatappId" class="call-btn" @click="goChat()">
            <el-icon :size="18">
              <Microphone />
            </el-icon>
            <span>与AI讲解员通话</span>
          </button>
        </div>

        <!-- 左上角返回按钮（与对话页同款） -->
        <button class="back-btn" aria-label="返回" @click="goBack">
          <el-icon :size="20">
            <ArrowLeft />
          </el-icon>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.play-page {
  --theme-primary: #a0704d;

  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  background: #000;
}

.phone {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  height: 100%;
  overflow: hidden;
  background: #26211c;
}

/* ==================== 状态视图 ==================== */
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0 32px;
  box-sizing: border-box;
}

.state-text {
  font-size: 17px;
  color: rgb(255 255 255 / 88%);
  text-align: center;
  line-height: 1.7;
}

/* ==================== 播放器 ==================== */
.player {
  position: relative;
  width: 100%;
  background: #000;

  .player-video {
    display: block;
    width: 100%;
    max-height: 56vh;
  }
}

/* ==================== 视频信息 ==================== */
.video-info {
  flex-shrink: 0;
  padding: 14px 16px 6px;
}

.video-name {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  line-height: 1.5;
}

.video-tag {
  display: inline-block;
  margin-top: 8px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(232 167 101 / 18%);
  color: #e8a765;
  font-size: 12px;
}

.video-desc {
  margin-top: 10px;
  font-size: 14px;
  color: rgb(255 255 255 / 60%);
  line-height: 1.7;
}

/* ==================== 底部区域 ==================== */
.play-footer {
  display: flex;
  flex-direction: column;
  flex: 1;
  justify-content: flex-end;
  min-height: 0;
  padding: 0 16px calc(24px + env(safe-area-inset-bottom));
  overflow-y: auto;
}

/* 预设问题模块：与对话页一致（主题棕色标题 + 下划线问题列表） */
.preset-questions {
  padding-top: 4px;
  margin-bottom: 18px;

  .preset-header {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 14px;
  }

  .preset-title-icon,
  .preset-refresh {
    color: var(--theme-primary);
  }

  .preset-refresh {
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    &.spinning {
      animation: preset-refresh-spin 0.4s ease;
    }
  }

  .preset-title {
    font-size: 15px;
    font-weight: normal;
    color: var(--theme-primary);
  }

  .preset-more {
    display: flex;
    gap: 2px;
    align-items: center;
    margin-left: auto;
    font-size: 13px;
    color: var(--theme-primary);
    cursor: pointer;
    user-select: none;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    .preset-more-arrow {
      transition: transform 0.2s ease;

      &.expanded {
        transform: rotate(90deg);
      }
    }
  }

  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 0 4px;
  }

  .preset-item {
    display: flex;
    gap: 10px;
    align-items: center;
    width: fit-content;
    font-size: 14px;
    color: #b9b3a8;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    .preset-dot {
      flex-shrink: 0;
      width: 5px;
      height: 5px;
      background: #8a8478;
      border-radius: 50%;
    }

    .preset-text {
      text-decoration: underline;
      text-decoration-color: rgb(255 255 255 / 25%);
      text-underline-offset: 5px;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover .preset-text {
        color: var(--theme-primary);
        text-decoration-color: var(--theme-primary);
      }
    }
  }
}

/* 与AI讲解员通话按钮：与博物馆首页通话按钮同款 */
.call-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 26px;
  border: none;
  border-radius: 999px;
  background: rgb(28 24 20 / 72%);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &:active {
    background: rgb(28 24 20 / 88%);
  }
}

/* 左上角返回按钮：与对话页同款（圆形半透明白底） */
.back-btn {
  position: absolute;
  top: 14px;
  left: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: #4e4e52;
  cursor: pointer;
  background: rgb(255 255 255 / 85%);
  border: 1px solid rgb(0 0 0 / 8%);
  border-radius: 50%;
  box-shadow: 0 2px 8px 0 rgb(0 0 0 / 8%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: var(--theme-primary);
      background: #fff;
    }
  }

  &:active {
    transform: scale(0.94);
  }
}

/* 预设问题刷新图标旋转动画（与对话页一致） */
@keyframes preset-refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
