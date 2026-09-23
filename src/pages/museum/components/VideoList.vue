<script setup lang="ts">
import type { MuseumVideo } from '@/api/museum/types';
import { Share, VideoPlay } from '@element-plus/icons-vue';
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { getMuseumVideos } from '@/api/museum';
import ShareSheet from './ShareSheet.vue';

const props = defineProps<{
  /** 博物馆id（跳转播放页透传） */
  museumId: string;
  /** AI视频分类id（videoEnable开启时管理端配置） */
  categoryId?: string | number | null;
  /** AI视频讲解员id（videoEnable开启时管理端配置，播放页通话用） */
  chatappId?: string | number | null;
}>();

const router = useRouter();

const videoList = ref<MuseumVideo[]>([]);
const loaded = ref(false);

// 展示类别筛选（全部 + 去重后的展示类别）
const activeCategory = ref('全部');
const categoryOptions = computed(() => {
  const set = new Set<string>();
  videoList.value.forEach((v) => {
    if (v.showCategory)
      set.add(v.showCategory);
  });
  return ['全部', ...Array.from(set)];
});
const filteredVideos = computed(() =>
  activeCategory.value === '全部'
    ? videoList.value
    : videoList.value.filter(v => v.showCategory === activeCategory.value),
);

// 置顶视频进入顶部banner轮播，瀑布流只展示非置顶视频
const topVideos = computed(() => filteredVideos.value.filter(v => v.topFlag === 1));
const normalVideos = computed(() => filteredVideos.value.filter(v => v.topFlag !== 1));

// 左右双列（按索引奇偶分列）：横向顺序排列，奇数个时最后一个落在左列
const leftVideos = computed(() => normalVideos.value.filter((_, i) => i % 2 === 0));
const rightVideos = computed(() => normalVideos.value.filter((_, i) => i % 2 === 1));

/* ==================== 置顶banner轮播 ==================== */
const bannerRef = ref<HTMLElement | null>(null);
const bannerIndex = ref(0);
let bannerTimer: ReturnType<typeof setInterval> | undefined;

function onBannerScroll() {
  const el = bannerRef.value;
  if (!el)
    return;
  requestAnimationFrame(() => {
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== bannerIndex.value && idx >= 0 && idx < topVideos.value.length)
      bannerIndex.value = idx;
  });
}

function scrollToBanner(i: number) {
  const el = bannerRef.value;
  if (!el)
    return;
  bannerIndex.value = i;
  el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  restartBannerTimer();
}

function stopBannerTimer() {
  if (bannerTimer) {
    clearInterval(bannerTimer);
    bannerTimer = undefined;
  }
}

function restartBannerTimer() {
  stopBannerTimer();
  // 单个置顶无需自动轮播
  if (topVideos.value.length <= 1)
    return;
  bannerTimer = setInterval(() => {
    scrollToBanner((bannerIndex.value + 1) % topVideos.value.length);
  }, 5000);
}

// 列表或筛选变化时：banner归位并重建轮播
watch(filteredVideos, async () => {
  bannerIndex.value = 0;
  await nextTick();
  bannerRef.value?.scrollTo({ left: 0 });
  restartBannerTimer();
});

onBeforeUnmount(() => {
  stopBannerTimer();
});

// museum页被KeepAlive缓存期间（进入播放页/对话页）暂停轮播，返回时恢复
onActivated(() => {
  restartBannerTimer();
});

onDeactivated(() => {
  stopBannerTimer();
});

onMounted(async () => {
  if (!props.categoryId) {
    loaded.value = true;
    return;
  }
  try {
    const res = await getMuseumVideos(props.categoryId);
    // 清理录入时可能误存的反引号/引号
    (res.data || []).forEach((v) => {
      v.coverUrl = (v.coverUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
      v.videoUrl = (v.videoUrl || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
    });
    videoList.value = res.data || [];
  }
  catch {}
  loaded.value = true;
});

// 点击封面进入播放页
function openVideo(video: MuseumVideo) {
  router.push({
    path: '/video-play',
    query: {
      id: String(video.id),
      museumId: props.museumId,
      ...(props.chatappId ? { chatappId: String(props.chatappId) } : {}),
    },
  });
}

// 分享单个视频：弹出与博物馆首页相同的分享抽屉，链接指向该视频播放页
const shareVisible = ref(false);
const shareVideo = ref<MuseumVideo | null>(null);
const shareUrl = computed(() => {
  const v = shareVideo.value;
  if (!v)
    return window.location.href;
  const { origin } = window.location;
  const chatapp = props.chatappId ? `&chatappId=${props.chatappId}` : '';
  return `${origin}/video-play?id=${v.id}&museumId=${props.museumId}${chatapp}`;
});

function onShare(video: MuseumVideo) {
  shareVideo.value = video;
  shareVisible.value = true;
}

// 视频时长格式化（秒 → m:ss）
function formatDuration(sec?: number) {
  if (!sec || sec <= 0)
    return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div class="video-view">
    <!-- 置顶视频banner轮播：有置顶才显示 -->
    <div v-if="topVideos.length > 0" class="video-banner-wrap">
      <div ref="bannerRef" class="video-banner" @scroll.passive="onBannerScroll">
        <div
          v-for="video in topVideos"
          :key="video.id"
          class="banner-slide"
          @click="openVideo(video)"
        >
          <img :src="video.coverUrl" :alt="video.title" loading="lazy" draggable="false">
          <div class="banner-caption">
            <span v-if="video.showCategory" class="banner-cat">{{ video.showCategory }}</span>
            <span class="banner-title">{{ video.title }}</span>
          </div>
          <span v-if="video.duration" class="banner-duration">{{ formatDuration(video.duration) }}</span>
        </div>
      </div>
      <!-- 切换指示器 -->
      <div v-if="topVideos.length > 1" class="banner-dots">
        <span
          v-for="(video, i) in topVideos"
          :key="video.id"
          class="banner-dot"
          :class="{ active: i === bannerIndex }"
          @click="scrollToBanner(i)"
        />
      </div>
    </div>

    <!-- 标题 + 展示类别切换按钮 -->
    <div class="video-head">
      <h2 class="video-title">
        {{ activeCategory }}
      </h2>
      <div v-if="categoryOptions.length > 2" class="cat-chips">
        <button
          v-for="cat in categoryOptions"
          :key="cat"
          class="cat-chip"
          :class="{ active: activeCategory === cat }"
          @click="activeCategory = cat"
        >
          {{ cat }}
        </button>
      </div>
    </div>

    <!-- 瀑布流：左右双列，卡片高度随封面（横版/竖版）自适应 -->
    <div v-if="normalVideos.length > 0" class="video-falls">
      <div class="fall-col">
        <div
          v-for="video in leftVideos"
          :key="video.id"
          class="video-card"
          @click="openVideo(video)"
        >
          <div class="video-cover">
            <img :src="video.coverUrl" :alt="video.title" loading="lazy" draggable="false">
            <span v-if="video.duration" class="video-duration">{{ formatDuration(video.duration) }}</span>
          </div>
          <div class="video-body">
            <!-- 分类标签左、分享按钮右：同行两端对齐 -->
            <div class="video-meta">
              <span v-if="video.showCategory" class="video-cat">{{ video.showCategory }}</span>
              <button class="video-share" aria-label="分享视频" @click.stop="onShare(video)">
                <el-icon :size="12">
                  <Share />
                </el-icon>
              </button>
            </div>
            <div class="video-name">
              {{ video.title }}
            </div>
          </div>
        </div>
      </div>
      <div class="fall-col">
        <div
          v-for="video in rightVideos"
          :key="video.id"
          class="video-card"
          @click="openVideo(video)"
        >
          <div class="video-cover">
            <img :src="video.coverUrl" :alt="video.title" loading="lazy" draggable="false">
            <span v-if="video.duration" class="video-duration">{{ formatDuration(video.duration) }}</span>
          </div>
          <div class="video-body">
            <!-- 分类标签左、分享按钮右：同行两端对齐 -->
            <div class="video-meta">
              <span v-if="video.showCategory" class="video-cat">{{ video.showCategory }}</span>
              <button class="video-share" aria-label="分享视频" @click.stop="onShare(video)">
                <el-icon :size="12">
                  <Share />
                </el-icon>
              </button>
            </div>
            <div class="video-name">
              {{ video.title }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="loaded && topVideos.length > 0" class="video-no-more">
      该类别下暂无更多视频
    </div>
    <div v-else-if="loaded" class="video-empty">
      <el-icon :size="40" class="video-empty-icon">
        <VideoPlay />
      </el-icon>
      <span>暂无视频</span>
    </div>

    <!-- 分享抽屉：分享单个视频的播放页链接 -->
    <ShareSheet v-model="shareVisible" :url="shareUrl" />
  </div>
</template>

<style scoped lang="scss">
.video-view {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: linear-gradient(180deg, #f8f4ec 0%, #f5f0e5 100%);
  padding: 14px 14px 32px;
  box-sizing: border-box;
}

/* ==================== 置顶视频banner轮播 ==================== */
.video-banner-wrap {
  margin: 16px 2px 12px;
}

.video-banner {
  display: flex;
  overflow-x: auto;
  border-radius: 10px;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
}

.banner-slide {
  position: relative;
  flex: 0 0 100%;
  aspect-ratio: 16 / 9;
  background: #f4efe6;
  scroll-snap-align: center;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: cover-fade-in 0.4s ease both;
  }

  /* 底部渐变遮罩 + 标题信息 */
  .banner-caption {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 30px 12px 10px;
    background: linear-gradient(180deg, transparent 0%, rgb(0 0 0 / 62%) 100%);

    .banner-cat {
      align-self: flex-start;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgb(255 255 255 / 25%);
      color: #fff;
      font-size: 10px;
      line-height: 1.4;
      backdrop-filter: blur(2px);
    }

    .banner-title {
      overflow: hidden;
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-shadow: 0 1px 2px rgb(0 0 0 / 40%);
    }
  }

  /* 右下角时长角标 */
  .banner-duration {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgb(0 0 0 / 55%);
    color: #fff;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    backdrop-filter: blur(2px);
  }
}

/* 切换指示器：当前项胶囊拉伸 */
.banner-dots {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding-top: 8px;

  .banner-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgb(130 87 65 / 25%);
    cursor: pointer;
    transition: all 0.25s ease;

    &.active {
      width: 16px;
      background: #825741;
    }
  }
}

/* 仅剩置顶banner、无更多列表视频时的轻提示 */
.video-no-more {
  padding-top: 26px;
  color: #b0a289;
  font-size: 13px;
  text-align: center;
}

/* ==================== 标题 + 类别切换 ==================== */
.video-head {
  display: flex;
  gap: 12px;
  align-items: center;
  margin: 16px 2px 18px;
}

.video-title {
  position: relative;
  flex-shrink: 0;
  margin: 0;
  padding-left: 10px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 1px;
  line-height: 1.2;
  color: #4d3b26;

  /* 主题棕渐变装饰竖条 */
  &::before {
    position: absolute;
    top: 50%;
    left: 0;
    width: 4px;
    height: 15px;
    background: linear-gradient(180deg, #b98a5e 0%, #825741 100%);
    border-radius: 2px;
    content: '';
    transform: translateY(-50%);
  }
}

/* 展示类别切换按钮：横向滑动 */
.cat-chips {
  display: flex;
  flex: 1;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.cat-chip {
  flex-shrink: 0;
  padding: 4px 12px;
  border: 1px solid #eadfc9;
  border-radius: 999px;
  background: #fff;
  color: #9b7b54;
  font-size: 11px;
  letter-spacing: 0.5px;
  line-height: 1.2;
  box-shadow: 0 1px 2px rgb(94 74 44 / 5%);
  cursor: pointer;
  transition: all 0.2s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &.active {
    background: linear-gradient(135deg, #96633f 0%, #825741 100%);
    border-color: transparent;
    color: #fff;
    box-shadow: 0 2px 8px rgb(130 87 65 / 30%);
  }

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      border-color: #cbb794;
      color: #7a5c3d;
    }

    &.active:hover {
      border-color: transparent;
      color: #fff;
    }
  }

  &:active {
    opacity: 0.85;
  }
}

/* ==================== 瀑布流双列 ==================== */
.video-falls {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.fall-col {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.video-card {
  overflow: hidden;
  background: #fff;
  border-radius: 10px;
  box-shadow:
    0 1px 3px rgb(94 74 44 / 6%),
    0 6px 16px rgb(94 74 44 / 7%);
  cursor: pointer;
  transition: box-shadow 0.25s ease, transform 0.25s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      box-shadow:
        0 2px 6px rgb(94 74 44 / 8%),
        0 10px 24px rgb(94 74 44 / 12%);
      transform: translateY(-2px);
    }
  }

  &:active {
    transform: scale(0.98);
  }
}

.video-cover {
  position: relative;

  /* 图片加载前的浅色占位底，避免白块突兀 */
  background: #f4efe6;

  /* 高度随封面自适应：横版封面矮卡片、竖版封面高卡片；加载后淡入 */
  img {
    display: block;
    width: 100%;
    height: auto;
    object-fit: contain;
    animation: cover-fade-in 0.4s ease both;
  }

  /* 左下角视频时长角标 */
  .video-duration {
    position: absolute;
    bottom: 8px;
    left: 8px;
    padding: 2px 7px;
    background: rgb(0 0 0 / 55%);
    border-radius: 6px;
    color: #fff;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
    backdrop-filter: blur(2px);
  }
}

/* 展示类别第一行 + 标题第二行 */
.video-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 13px;
}

/* 分类标签左 + 分享按钮右：同行两端对齐 */
.video-meta {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  min-height: 20px;
}

/* 分享按钮：浅米色圆底，与分类标签同色系 */
.video-share {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: #8a6f45;
  background: #f3e9d5;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: #fff;
      background: #825741;
    }
  }

  &:active {
    transform: scale(0.92);
  }
}

.video-name {
  overflow: hidden;
  font-size: 14px;
  color: rgb(130 87 65);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s ease;

  @media (hover: hover) and (pointer: fine) {
    .video-card:hover & {
      color: #6e4527;
    }
  }
}

.video-cat {
  /* 跟随文字宽度，不拉伸占满整行 */
  align-self: flex-start;
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid #eadfc9;
  border-radius: 999px;
  background: linear-gradient(180deg, #faf5ea 0%, #f3e9d5 100%);
  color: #9b7b54;
  font-size: 10px;
  line-height: 1.4;
}

.video-empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  padding-top: 110px;
  color: #b0a289;
  font-size: 14px;

  .video-empty-icon {
    color: #dcccab;
  }
}

/* 封面加载淡入 */
@keyframes cover-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
