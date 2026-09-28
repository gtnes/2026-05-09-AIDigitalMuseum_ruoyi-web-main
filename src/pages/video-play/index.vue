<script setup lang="ts">
import type { MuseumVideo } from '@/api/museum/types';
import { ArrowLeft, ArrowRight, ArrowUp, ChatDotRound, Close, Microphone, Refresh, Share as ShareIcon } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getVideoInfo } from '@/api/museum';
import ShareSheet from '@/pages/museum/components/ShareSheet.vue';

const route = useRoute();
const router = useRouter();

const museumId = computed(() => (route.query.museumId as string) || '');
const chatappId = computed(() => (route.query.chatappId as string) || '');

// 当前视频id（可随上下滑切换更新）
const currentVideoId = ref('');
// 播放上下文：从视频列表进入时记录的完整列表，供上下滑切换
interface VideoPlayContext {
  ids: string[];
  index: number;
}
const playContext = ref<VideoPlayContext | null>(null);

const video = ref<MuseumVideo | null>(null);
const loading = ref(true);

async function loadVideo(id: string) {
  if (!id) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const res = await getVideoInfo(id);
    if (res.code === 200 && res.data) {
      res.data.videoUrl = (res.data.videoUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
      res.data.coverUrl = (res.data.coverUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
      video.value = res.data;
    }
  }
  catch {}
  loading.value = false;
  // 数据就绪后启动/重置底部模块交替（默认先显示"我猜你想问"）
  switchBottom('preset');
}

// ==================== 上滑下一个视频 / 下滑上一个视频 ====================
function switchVideo(direction: 1 | -1) {
  const ctx = playContext.value;
  if (!ctx || ctx.ids.length <= 1) {
    ElMessage.info('没有其它视频了');
    return;
  }
  const next = ctx.index + direction;
  if (next < 0) {
    ElMessage.info('已经是第一个视频');
    return;
  }
  if (next >= ctx.ids.length) {
    ElMessage.info('已经是最后一个视频');
    return;
  }
  ctx.index = next;
  currentVideoId.value = ctx.ids[next]!;
  // 同步地址栏（分享链接指向当前视频）
  router.replace({ query: { ...route.query, id: currentVideoId.value } });
  loadVideo(currentVideoId.value);
}

// 播放区手势：上滑/下滑切换视频（滑动后抑制随后的click，避免误触播放暂停）
let touchStartX = 0;
let touchStartY = 0;
let suppressClick = false;

function onPlayerTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0]?.clientX ?? 0;
  touchStartY = e.touches[0]?.clientY ?? 0;
}

function onPlayerTouchEnd(e: TouchEvent) {
  const endX = e.changedTouches[0]?.clientX ?? touchStartX;
  const endY = e.changedTouches[0]?.clientY ?? touchStartY;
  const dx = endX - touchStartX;
  const dy = endY - touchStartY;
  // 垂直滑动（且垂直分量大于水平分量）才切换视频
  if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) {
    suppressClick = true;
    switchVideo(dy < 0 ? 1 : -1);
  }
}

// 分享抽屉（不传url则分享当前播放页地址）
const shareVisible = ref(false);

// ==================== 点击播放区切换播放/暂停 ====================
const videoRef = ref<HTMLVideoElement>();

function onPlayerTap(e: MouseEvent) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const el = videoRef.value;
  if (!el)
    return;
  // 原生控制条区域（视频底部约56px）不处理，避免与控制条按钮冲突
  const rect = el.getBoundingClientRect();
  if (e.clientY >= rect.top && rect.bottom - e.clientY < 56)
    return;
  el.paused ? el.play() : el.pause();
}

// 伪横屏切换：页面整体旋转90度（手机逆时针横放观看），宽高互换
const isLandscape = ref(false);
function toggleOrientation() {
  isLandscape.value = !isLandscape.value;
}

// 返回：横屏时先切回竖屏，竖屏时返回上一页面
function goBack() {
  if (isLandscape.value) {
    isLandscape.value = false;
    return;
  }
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

// ==================== 底部模块交替显示：我猜你想问 <-> 向上滑动继续观看视频 ====================
type BottomState = 'preset' | 'hint' | 'hidden';
const bottomState = ref<BottomState>('preset');
const ROTATE_PRESET_MS = 6000; // 我猜你想问显示时长
const ROTATE_HINT_MS = 4000; // 上滑提示显示时长
const RECOVER_MS = 8000; // 上滑隐藏后自动恢复时长
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let recoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearBottomTimers() {
  if (rotateTimer) {
    clearTimeout(rotateTimer);
    rotateTimer = null;
  }
  if (recoverTimer) {
    clearTimeout(recoverTimer);
    recoverTimer = null;
  }
}

function switchBottom(state: BottomState) {
  bottomState.value = state;
  clearBottomTimers();
  if (state === 'preset') {
    // 无预设问题时不可进入preset态，常驻显示提示条（不轮换）
    if (presetQuestions.value.length === 0) {
      bottomState.value = 'hint';
      return;
    }
    rotateTimer = setTimeout(() => switchBottom('hint'), ROTATE_PRESET_MS);
  }
  else if (state === 'hint') {
    rotateTimer = setTimeout(() => switchBottom('preset'), ROTATE_HINT_MS);
  }
}

// 关闭"我猜你想问"：切换到上滑提示
function closePreset() {
  switchBottom('hint');
}

// 上滑/点击提示：隐藏底部模块，专心看视频，稍后自动恢复
function hideBottom() {
  clearBottomTimers();
  bottomState.value = 'hidden';
  recoverTimer = setTimeout(() => switchBottom('preset'), RECOVER_MS);
}

// 上滑手势（仅提示条显示时生效，避免与面板内滚动冲突）
let footerTouchY = 0;
function onFooterTouchStart(e: TouchEvent) {
  footerTouchY = e.touches[0]?.clientY ?? 0;
}
function onFooterTouchEnd(e: TouchEvent) {
  if (bottomState.value !== 'hint')
    return;
  const endY = e.changedTouches[0]?.clientY ?? footerTouchY;
  if (footerTouchY - endY > 30)
    hideBottom();
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

onMounted(() => {
  currentVideoId.value = (route.query.id as string) || '';
  // 读取播放上下文（从视频列表进入时记录的完整列表）
  try {
    const raw = sessionStorage.getItem('videoPlayContext');
    if (raw) {
      const ctx = JSON.parse(raw) as VideoPlayContext;
      if (Array.isArray(ctx.ids) && ctx.ids.length > 0)
        playContext.value = ctx;
    }
  }
  catch {}
  loadVideo(currentVideoId.value);
});

onUnmounted(() => {
  clearBottomTimers();
});
</script>

<template>
  <div class="play-page">
    <div class="phone" :class="{ landscape: isLandscape }">
      <!-- 加载中/参数错误 -->
      <div v-if="loading" class="state-view">
        <span class="state-text">加载中...</span>
      </div>
      <div v-else-if="!video" class="state-view">
        <span class="state-text">视频不存在或已下架</span>
      </div>

      <template v-else>
        <!-- 视频播放器：铺满全屏，横竖版均垂直水平居中；点击切换播放/暂停；上/下滑切换下/上一个视频 -->
        <div
          class="player"
          @click.prevent="onPlayerTap"
          @touchstart="onPlayerTouchStart"
          @touchend="onPlayerTouchEnd"
        >
          <video
            ref="videoRef"
            :src="video.videoUrl"
            :poster="video.coverUrl"
            controls
            autoplay
            playsinline
            webkit-playsinline
            class="player-video"
          />
          <!-- 透明点击遮罩：盖住视频画面与周边空白，点击冒泡到.player切换播放/暂停；
               底部让出56px给原生控制条；层级低于返回/分享等UI按钮 -->
          <div class="tap-mask" />
        </div>

        <!-- 左上角返回按钮（与对话页同款） -->
        <button class="back-btn" aria-label="返回" @click="goBack">
          <el-icon :size="20">
            <ArrowLeft />
          </el-icon>
        </button>

        <!-- 标题信息：顶部水平居中 -->
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

        <!-- 横竖屏切换按钮：距顶60%、左右居中 -->
        <button class="rotate-btn" :aria-label="isLandscape ? '切换为竖屏' : '切换为横屏'" @click="toggleOrientation">
          <svg
            class="rotate-icon"
            :class="{ 'rotate-icon--landscape': isLandscape }"
            viewBox="0 0 1024 1024"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M576 448h352a96 96 0 0 1 96 96v384a96 96 0 0 1-96 96H288a96 96 0 0 1-96-96v-96H96a96 96 0 0 1-96-96V96a96 96 0 0 1 96-96h384a96 96 0 0 1 96 96v352z m-64 0V96a32 32 0 0 0-32-32H96a32 32 0 0 0-32 32v640a32 32 0 0 0 32 32h96V544a96 96 0 0 1 96-96h224z m327.28-200.8a458.432 458.432 0 0 0-151.2-139.744 32 32 0 0 1 31.76-55.568A522.432 522.432 0 0 1 898.592 220.8l39.264-17.488a16 16 0 0 1 22.48 15.344l-7.808 174.48a16 16 0 0 1-26.144 11.648l-134.912-110.944a16 16 0 0 1 3.664-26.976l44.16-19.664zM960 544a32 32 0 0 0-32-32H288a32 32 0 0 0-32 32v384a32 32 0 0 0 32 32h640a32 32 0 0 0 32-32V544z"
              fill="currentColor"
            />
          </svg>
        </button>

        <!-- 右上角分享按钮：仅图标 -->
        <button class="share-btn" aria-label="分享" @click="shareVisible = true">
          <el-icon :size="20">
            <ShareIcon />
          </el-icon>
        </button>

        <!-- 底部浮层：我猜你想问 与 向上滑动提示 交替显示 -->
        <div
          class="play-footer"
          @touchstart="onFooterTouchStart"
          @touchend="onFooterTouchEnd"
        >
          <!-- 我猜你想问面板 -->
          <Transition name="bottom-panel">
            <div v-if="bottomState === 'preset' && presetQuestions.length > 0" class="preset-questions">
              <button class="sheet-close" aria-label="关闭" @click="closePreset">
                <el-icon :size="12">
                  <Close />
                </el-icon>
              </button>
              <div class="preset-header">
                <span class="preset-title-icon">
                  <el-icon :size="16">
                    <ChatDotRound />
                  </el-icon>
                </span>
                <span class="preset-title">我猜你想问</span>
                <button
                  v-if="!presetExpanded && presetPageCount > 1"
                  class="preset-refresh"
                  :class="{ spinning: presetRefreshing }"
                  aria-label="换一批"
                  @click="refreshPresetQuestions"
                >
                  <el-icon :size="14">
                    <Refresh />
                  </el-icon>
                </button>
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
                  <span class="preset-arrow">›</span>
                </div>
              </div>
              <div v-if="presetQuestions.length > PRESET_PAGE_SIZE" class="preset-more" @click="togglePresetExpand">
                <span>{{ presetExpanded ? '收起' : '更多' }}</span>
                <el-icon :size="12" class="preset-more-arrow" :class="{ expanded: presetExpanded }">
                  <ArrowRight />
                </el-icon>
              </div>
            </div>
          </Transition>

          <!-- 向上滑动继续观看视频提示 -->
          <Transition name="bottom-panel">
            <div v-if="bottomState === 'hint'" class="swipe-hint" @click="hideBottom">
              <el-icon :size="16" class="swipe-hint-icon">
                <ArrowUp />
              </el-icon>
              <span>向上滑动继续观看视频</span>
            </div>
          </Transition>
        </div>

        <!-- 与AI讲解员通话按钮：距顶70%、左右居中浮动 -->
        <button v-if="chatappId" class="call-btn" @click="goChat()">
          <el-icon :size="16">
            <Microphone />
          </el-icon>
          <span>与AI讲解员通话</span>
        </button>
      </template>
    </div>

    <!-- 分享抽屉（独立组件，不传url则分享当前播放页地址） -->
    <ShareSheet v-model="shareVisible" />
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
  transition: transform 0.35s ease, width 0.35s ease, height 0.35s ease;

  /* 伪横屏：整体旋转90度（手机逆时针横放观看），宽高互换 */
  &.landscape {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100vh;
    height: 100vw;
    max-width: none;
    transform: translate(-50%, -50%) rotate(90deg);
  }
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
/* 播放区占据剩余空间，视频（横版/竖版）垂直水平居中：
   竖版视频高度受限时宽度按内在比例自动收缩，不会变形或贴顶 */
.player {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  width: 100%;
  background: #000;

  .player-video {
    display: block;
    width: 100%;
    max-height: 100%;
  }

  /* 透明点击遮罩：解决原生video控件吞掉点击（点视频本体不冒泡）导致无法切换播放/暂停的问题 */
  .tap-mask {
    position: absolute;
    inset: 0;
    z-index: 5;
    bottom: 56px; /* 让出底部原生控制条区域 */
    background: transparent;
  }
}

/* ==================== 标题信息（顶部水平居中，带渐变遮罩） ==================== */
.video-info {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 90;
  padding: calc(12px + env(safe-area-inset-top)) 56px 40px;
  text-align: center;
  background: linear-gradient(to bottom, rgb(0 0 0 / 72%), transparent);
  pointer-events: none;
}

.video-name {
  overflow: hidden;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  text-overflow: ellipsis;
  text-shadow: 0 1px 4px rgb(0 0 0 / 50%);
  white-space: nowrap;
}

.video-tag {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgb(232 167 101 / 18%);
  color: #e8a765;
  font-size: 12px;
}

.video-desc {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 6px;
  color: rgb(255 255 255 / 62%);
  font-size: 12px;
  line-height: 1.6;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* ==================== 横竖屏切换按钮（距顶60%、左右居中，无背景白色图标） ==================== */
.rotate-btn {
  position: absolute;
  top: 65%;
  left: 50%;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  color: #fff;
  cursor: pointer;
  background: none;
  border: none;
  transform: translateX(-50%);
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 60%));
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  /* 转屏后图标跟随旋转90度，提示当前处于横屏状态 */
  .rotate-icon {
    width: 22px;
    height: 22px;
    transition: transform 0.35s ease;
  }

  .rotate-icon--landscape {
    transform: rotate(90deg);
  }

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      opacity: 0.8;
    }
  }

  &:active {
    transform: translateX(-50%) scale(0.92);
  }
}

/* ==================== 右上角分享按钮（与博物馆首页同款） ==================== */
.share-btn {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: 14px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  padding: 0;
  color: #fff;
  font-size: 13px;
  background: none;
  border: none;
  cursor: pointer;
  text-shadow: 0 1px 4px rgb(0 0 0 / 45%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

/* ==================== 底部区域（预设问题抽屉式面板） ==================== */
.play-footer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 90;
  display: flex;
  flex-direction: column;
  padding: 30px 0 0;
  background: linear-gradient(to top, rgb(0 0 0 / 72%), transparent);
  pointer-events: none;

  .preset-questions,
  .preset-entry {
    pointer-events: auto;
  }
}

/* 横屏：只保留返回和翻转按钮，其余浮层全部隐藏 */
.landscape {
  .video-info,
  .play-footer,
  .call-btn,
  .share-btn {
    display: none;
  }
}

/* 展开态：抽屉样式面板（深色渐变底 + 边框 + 顶部圆角 + 把手条 + 右上角关闭按钮） */
.preset-questions {
  position: relative;
  max-height: 38vh;
  padding: 12px 16px calc(30px + env(safe-area-inset-bottom));
  overflow-y: auto;
  background: linear-gradient(180deg, #2a241d, #1f1a14);
  border: 1px solid rgb(255 255 255 / 12%);
  border-bottom: none;
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 30px rgb(0 0 0 / 35%);

  /* 顶部中央把手条：抽屉质感 */
  &::before {
    content: '';
    position: absolute;
    top: 8px;
    left: 50%;
    width: 36px;
    height: 4px;
    background: rgb(255 255 255 / 18%);
    border-radius: 999px;
    transform: translateX(-50%);
  }

  /* 右上角关闭按钮 */
  .sheet-close {
    position: absolute;
    top: 12px;
    right: 10px;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: #fff;
    cursor: pointer;
    background: rgb(255 255 255 / 12%);
    border: none;
    border-radius: 50%;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        background: rgb(255 255 255 / 22%);
      }
    }

    &:active {
      transform: scale(0.92);
    }
  }

  /* 标题行 */
  .preset-header {
    display: flex;
    gap: 9px;
    align-items: center;
    padding: 6px 36px 8px 0;
    margin-bottom: 0;
  }

  /* 标题图标：渐变棕圆角底 */
  .preset-title-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px;
    color: #fff;
    background: linear-gradient(135deg, var(--theme-primary), #96603c);
    border-radius: 10px;
    box-shadow: 0 3px 8px rgb(160 112 77 / 30%);
  }

  .preset-title {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 1px;
    color: #ece6db;
  }

  /* 刷新按钮：圆形浅底 */
  .preset-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin-left: auto;
    padding: 0;
    color: rgb(255 255 255 / 75%);
    cursor: pointer;
    background: rgb(255 255 255 / 8%);
    border: none;
    border-radius: 50%;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    &.spinning {
      animation: preset-refresh-spin 0.4s ease;
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        color: #fff;
        background: rgb(255 255 255 / 16%);
      }
    }

    &:active {
      transform: scale(0.9);
    }
  }

  /* 问题列表：卡片式条目 */
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preset-item {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 9px 14px;
    background: rgb(255 255 255 / 6%);
    border: 1px solid rgb(255 255 255 / 6%);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    .preset-dot {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      background: var(--theme-primary);
      border-radius: 50%;
      box-shadow: 0 0 0 3px rgb(160 112 77 / 20%);
    }

    .preset-text {
      flex: 1;
      font-size: 14px;
      color: #d8d2c8;
    }

    /* 右侧箭头：暗示可点击 */
    .preset-arrow {
      flex-shrink: 0;
      font-size: 18px;
      line-height: 1;
      color: rgb(255 255 255 / 30%);
      transition: color 0.2s ease;
    }

    &:active {
      transform: scale(0.98);
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        background: rgb(255 255 255 / 10%);
        border-color: rgb(255 255 255 / 12%);

        .preset-text {
          color: #fff;
        }

        .preset-arrow {
          color: var(--theme-primary);
        }
      }
    }
  }

  /* 更多/收起：底部居中胶囊按钮 */
  .preset-more {
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: center;
    width: fit-content;
    margin: 10px auto 0;
    padding: 6px 20px;
    font-size: 13px;
    color: rgb(255 255 255 / 80%);
    background: rgb(255 255 255 / 8%);
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
    transition: background 0.2s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;

    .preset-more-arrow {
      color: rgb(255 255 255 / 55%);
      transition: transform 0.2s ease;

      &.expanded {
        transform: rotate(90deg);
      }
    }

    @media (hover: hover) and (pointer: fine) {
      &:hover {
        color: #fff;
        background: rgb(255 255 255 / 14%);
      }
    }

    &:active {
      transform: scale(0.97);
    }
  }
}

/* 向上滑动继续观看视频：提示条（与面板交替显示） */
.swipe-hint {
  display: flex;
  gap: 8px;
  align-items: center;
  align-self: center;
  padding: 10px 22px;
  margin-bottom: calc(34px + env(safe-area-inset-bottom));
  color: #fff;
  font-size: 14px;
  letter-spacing: 1px;
  background: rgb(28 24 20 / 70%);
  border: 1px solid rgb(255 255 255 / 35%);
  border-radius: 999px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  .swipe-hint-icon {
    color: #fff;
    animation: swipe-hint-bounce 1.6s ease-in-out infinite;
  }

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      background: rgb(28 24 20 / 85%);
    }
  }

  &:active {
    transform: scale(0.97);
  }
}

@keyframes swipe-hint-bounce {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-4px);
  }
}

/* 底部模块交替过渡：上滑淡入/下滑淡出 */
.bottom-panel-enter-active,
.bottom-panel-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}

.bottom-panel-enter-from,
.bottom-panel-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

/* 离场元素脱流，避免与进场元素叠高跳动 */
.bottom-panel-leave-active {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
}

/* 与AI讲解员通话按钮：距顶70%、左右居中浮动（与博物馆首页通话按钮同款） */
.call-btn {
  position: absolute;
  top: 70%;
  left: 50%;
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 20px;
  border: 1px solid rgb(255 255 255 / 75%);
  border-radius: 999px;
  background: rgb(28 24 20 / 72%);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transform: translateX(-50%);
  box-shadow: 0 2px 10px 0 rgb(0 0 0 / 35%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &:active {
    background: rgb(28 24 20 / 88%);
  }
}

/* 左上角返回按钮：无背景白色图标（带阴影），固定左上角 */
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
  color: #fff;
  cursor: pointer;
  background: none;
  border: none;
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 60%));
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      opacity: 0.8;
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
