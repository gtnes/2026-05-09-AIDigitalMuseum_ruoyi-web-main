<script setup lang="ts">
import type { MuseumChatApp, MuseumInfo } from '@/api/museum/types';
import { Avatar, Compass, Microphone, Share as ShareIcon, VideoPlay } from '@element-plus/icons-vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { cleanUrl, getMuseumInfo } from '@/api/museum';
import ShareSheet from './components/ShareSheet.vue';
import VideoList from './components/VideoList.vue';
import VirtualSpace from './components/VirtualSpace.vue';

type TabKey = 'ai' | 'video' | 'vr';

const route = useRoute();
const router = useRouter();

const museumId = computed(() => (route.query.id as string) || '');
const loading = ref(true);
const errorMsg = ref('');
const museum = ref<MuseumInfo | null>(null);

const activeTab = ref<TabKey>('ai');
const pageIndex = ref(0);

const apps = computed<MuseumChatApp[]>(() => museum.value?.chatapps || []);
const currentApp = computed(() => apps.value[pageIndex.value] || null);

// 展示名称：优先用chat_app的应用描述，其次配置的description，最后回退appName
function displayName(app: MuseumChatApp) {
  return app.appDescribe || app.description || app.appName;
}

// 圆圈图标：优先用chat_app的应用图标，回退待机形象
function displayIcon(app: MuseumChatApp) {
  return app.appShow || app.idleImgUrl;
}

// 圆圈标题：优先用职责名称duty（如"AI馆员"），为空时回退展示名称
function circleName(app: MuseumChatApp) {
  return app.duty?.trim() || displayName(app);
}

// 通话按钮文案：与{当前激活智能体的duty}通话，duty为空时回退"AI馆员"
const callLabel = computed(() => `与${currentApp.value?.duty?.trim() || 'AI馆员'}通话`);

// 虚拟空间：vrEnable=1 且 vrUrl 有值时才显示
const vrUrl = computed(() => (museum.value ? cleanUrl(museum.value.vrUrl || '') : ''));
const showVrTab = computed(() => !!museum.value && museum.value.vrEnable === 1 && !!vrUrl.value);

const tabs = computed(() => {
  const list: { key: TabKey; label: string; icon: typeof Avatar }[] = [
    { key: 'ai', label: 'AI馆员', icon: Avatar },
    { key: 'video', label: 'AI视频', icon: VideoPlay },
  ];
  if (showVrTab.value)
    list.push({ key: 'vr', label: '虚拟空间', icon: Compass });
  return list;
});

// ==================== 初始化：根据URL中的id加载对应博物馆数据 ====================
async function loadMuseum() {
  loading.value = true;
  errorMsg.value = '';
  museum.value = null;
  activeTab.value = 'ai';
  pageIndex.value = 0;
  if (!museumId.value) {
    errorMsg.value = '缺少博物馆参数';
    loading.value = false;
    return;
  }
  try {
    const res = await getMuseumInfo(museumId.value);
    if (res.code === 200 && res.data) {
      museum.value = res.data;
    }
    else {
      errorMsg.value = res.msg || '未找到博物馆信息';
    }
  }
  catch {
    errorMsg.value = '获取博物馆信息失败';
  }
  loading.value = false;
}

onMounted(loadMuseum);

// 同一路由下切换不同博物馆id时重新加载
watch(museumId, (newId, oldId) => {
  if (newId && newId !== oldId)
    loadMuseum();
});

// ==================== 分享（底部抽屉，见 ShareSheet 组件） ====================
const shareVisible = ref(false);

function onShare() {
  shareVisible.value = true;
}

// ==================== 与AI馆员通话 ====================
function onCall(app: MuseumChatApp) {
  router.push({ path: '/app-chat', query: { appId: String(app.id) } });
}

// ==================== 左右滑动切换 ====================
const viewportRef = ref<HTMLElement | null>(null);
const dragX = ref(0);
const dragging = ref(false);
let startX = 0;
let startY = 0;
let horizontal: boolean | null = null;

function onPointerDown(e: PointerEvent) {
  if (apps.value.length < 2)
    return;
  // 按在按钮/圆圈等交互元素上时不启动滑动捕获，否则setPointerCapture会劫持click导致按钮无法点击
  if ((e.target as HTMLElement | null)?.closest('button, .app-circles'))
    return;
  dragging.value = true;
  horizontal = null;
  startX = e.clientX;
  startY = e.clientY;
  dragX.value = 0;
  viewportRef.value?.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value)
    return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8))
    horizontal = Math.abs(dx) > Math.abs(dy);
  if (!horizontal)
    return;
  // 到边缘时增加阻尼
  if ((pageIndex.value === 0 && dx > 0) || (pageIndex.value === apps.value.length - 1 && dx < 0))
    dragX.value = dx / 3;
  else
    dragX.value = dx;
}

function onPointerUp() {
  if (!dragging.value)
    return;
  dragging.value = false;
  const dx = dragX.value;
  dragX.value = 0;
  if (dx <= -60 && pageIndex.value < apps.value.length - 1)
    pageIndex.value++;
  else if (dx >= 60 && pageIndex.value > 0)
    pageIndex.value--;
}
</script>

<template>
  <div class="museum-page">
    <div class="phone">
      <!-- 加载中 -->
      <div v-if="loading" class="state-view">
        <span class="state-text">加载中...</span>
      </div>

      <!-- 加载失败 -->
      <div v-else-if="errorMsg" class="state-view">
        <span class="state-text">{{ errorMsg }}</span>
      </div>

      <!-- 服务到期提示 -->
      <div v-else-if="museum && museum.isExpire === 1" class="state-view expired">
        <img v-if="museum.logoUrl" :src="museum.logoUrl" class="expired-logo" alt="">
        <span class="state-text">{{ museum.expireTips || '服务已到期，请联系管理员' }}</span>
      </div>

      <!-- 正常展示 -->
      <template v-else-if="museum">
        <!-- AI馆员视图 -->
        <div v-show="activeTab === 'ai'" class="ai-view">
          <!-- 顶部logo -->
          <img v-if="museum.logoUrl" :src="museum.logoUrl" class="museum-logo" alt="logo">

          <!-- 分享 -->
          <button class="share-btn" @click="onShare">
            <el-icon :size="20">
              <ShareIcon />
            </el-icon>
            <span>分享</span>
          </button>

          <!-- 应用切换圆圈：平移轨道，激活项始终位于中间（item宽132px，步长132px） -->
          <div
            class="app-circles"
            :style="{ transform: `translateX(calc(-1 * (${pageIndex} * 132px + 66px)))` }"
          >
            <div
              v-for="(app, i) in apps"
              :key="app.id"
              class="circle-item"
              :class="{ active: i === pageIndex }"
              @click="pageIndex = i"
            >
              <div class="circle-avatar">
                <img v-if="displayIcon(app)" :src="displayIcon(app)" class="circle-img" alt="" draggable="false">
                <span v-else class="circle-placeholder">{{ circleName(app).slice(0, 1) }}</span>
              </div>
              <span class="circle-label">{{ circleName(app) }}</span>
            </div>
          </div>

          <!-- 可滑动页面 -->
          <div
            ref="viewportRef"
            class="swipe-viewport"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <div
              class="swipe-track"
              :style="{
                transform: `translateX(calc(${-pageIndex * 100}% + ${dragX}px))`,
                transition: dragging ? 'none' : 'transform 0.35s ease',
              }"
            >
              <div v-for="app in apps" :key="app.id" class="app-page">
                <img v-if="app.bgUrl" :src="app.bgUrl" class="page-bg" alt="" draggable="false">
                <img v-if="app.idleImgUrl" :src="app.idleImgUrl" class="page-character" alt="" draggable="false">
              </div>
            </div>

            <!-- 欢迎语 -->
            <div v-if="currentApp" class="greeting">
              你好，我是{{ displayName(currentApp) }}
            </div>

            <!-- 通话按钮 -->
            <button v-if="currentApp" class="call-btn" @click="onCall(currentApp)">
              <el-icon :size="18">
                <Microphone />
              </el-icon>
              <span>{{ callLabel }}</span>
            </button>
          </div>
        </div>

        <!-- AI视频视图 -->
        <div v-show="activeTab === 'video'" class="tab-view">
          <VideoList :museum-id="museumId" :logo="museum.logoUrl" />
        </div>

        <!-- 虚拟空间视图 -->
        <div v-show="activeTab === 'vr'" class="tab-view">
          <VirtualSpace :url="vrUrl" />
        </div>

        <!-- 底部导航 -->
        <div class="bottom-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="nav-item"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            <el-icon :size="24">
              <component :is="tab.icon" />
            </el-icon>
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 分享抽屉（独立组件） -->
    <ShareSheet v-model="shareVisible" />
  </div>
</template>

<style scoped lang="scss">
.museum-page {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  background: #000;
}

.phone {
  position: relative;
  width: 100%;
  max-width: 520px;
  height: 100%;
  overflow: hidden;
  background: #26211c;
}

/* ==================== 状态视图（加载/错误/到期） ==================== */
.state-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  padding: 0 32px;
  box-sizing: border-box;

  &.expired {
    background: radial-gradient(circle at 50% 30%, #3d332a, #1c1712);
  }
}

.state-text {
  font-size: 17px;
  color: rgb(255 255 255 / 88%);
  text-align: center;
  line-height: 1.7;
  word-break: break-all;
}

.expired-logo {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
}

/* ==================== AI馆员视图 ==================== */
.ai-view {
  position: relative;
  width: 100%;
  height: 100%;
}

.museum-logo {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  left: 14px;
  z-index: 30;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  background: rgb(255 255 255 / 85%);
}

.share-btn {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: 14px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  text-shadow: 0 1px 4px rgb(0 0 0 / 45%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

/* 应用切换圆圈（平移轨道，激活项居中：item宽132px、gap0，步长132px） */
.app-circles {
  position: absolute;
  top: calc(60px + env(safe-area-inset-top));
  left: 50%;
  z-index: 30;
  display: flex;
  gap: 0;
  transition: transform 0.35s ease;
}

.circle-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 132px;
  flex-shrink: 0;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  /* 头像区域固定高度，使激活(84px)/未激活(68px)头像中心线垂直对齐 */
  .circle-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 84px;
  }

  .circle-img,
  .circle-placeholder {
    width: 68px;
    height: 68px;
    border: 3px solid rgb(255 255 255 / 45%);
    border-radius: 50%;
    object-fit: cover;
    background: rgb(255 255 255 / 30%);
    box-sizing: border-box;
    opacity: 0.72;
    transition: all 0.25s ease;
  }

  .circle-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 24px;
  }

  .circle-label {
    display: block;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: rgb(255 255 255 / 75%);
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    text-shadow: 0 1px 4px rgb(0 0 0 / 50%);
    padding: 3px 10px;
    box-sizing: border-box;
    transition: all 0.25s ease;
    /* 标题背景：中间实、左右虚化（未激活为#b0a28c深版） */
    background: linear-gradient(
      90deg,
      rgb(176 162 140 / 0%),
      rgb(176 162 140 / 85%) 30%,
      rgb(176 162 140 / 85%) 70%,
      rgb(176 162 140 / 0%)
    );
  }

  &.active {
    .circle-img,
    .circle-placeholder {
      width: 84px;
      height: 84px;
      border-color: #fff;
      opacity: 1;
    }

    .circle-label {
      color: #fff;
      font-size: 13px;
      margin-top: 3px;
      padding: 2px 10px;
      background: linear-gradient(
        90deg,
        rgb(232 167 101 / 0%),
        rgb(232 167 101 / 100%) 30%,
        rgb(232 167 101 / 100%) 70%,
        rgb(232 167 101 / 0%)
      );
    }
  }
}

/* 可滑动页面 */
.swipe-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: pan-y;
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
}

.swipe-track {
  display: flex;
  height: 100%;
  will-change: transform;
}

.app-page {
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.page-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.page-character {
  position: absolute;
  bottom: 0;
  left: 50%;
  height: 62%;
  object-fit: contain;
  transform: translateX(-50%);
}

/* 欢迎语 */
.greeting {
  position: absolute;
  left: 50%;
  bottom: 215px;
  z-index: 20;
  max-width: calc(100% - 32px);
  padding: 10px 18px;
  border-radius: 10px;
  background: rgb(28 24 20 / 72%);
  color: #fff;
  font-size: 16px;
  line-height: 1.5;
  text-align: center;
  transform: translateX(-50%);
  pointer-events: none;
  box-sizing: border-box;
}

/* 通话按钮 */
.call-btn {
  position: absolute;
  left: 50%;
  bottom: 152px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 26px;
  border: none;
  border-radius: 999px;
  background: rgb(28 24 20 / 72%);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  transform: translateX(-50%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &:active {
    background: rgb(28 24 20 / 88%);
  }
}

/* ==================== 视频与虚拟空间 ==================== */
.tab-view {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: calc(100% - 62px - env(safe-area-inset-bottom));
}

/* ==================== 底部导航 ==================== */
.bottom-nav {
  position: absolute;
  bottom: 0;
  left: 0;
  z-index: 40;
  display: flex;
  width: 100%;
  height: calc(62px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: rgb(32 26 21 / 90%);
  box-sizing: border-box;
}

.nav-item {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  background: none;
  color: #cfc8bd;
  font-size: 13px;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &.active {
    color: #e8a765;
  }
}
</style>
