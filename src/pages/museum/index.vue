<script setup lang="ts">
import type { MuseumChatApp, MuseumInfo } from '@/api/museum/types';
import { Avatar, Compass, Microphone, Share as ShareIcon, VideoPlay } from '@element-plus/icons-vue';
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { synthesizeMuseumTts } from '@/api/app-chat';
import { cleanUrl, getMuseumInfo } from '@/api/museum';
import ShareSheet from './components/ShareSheet.vue';
import VideoList from './components/VideoList.vue';
import VirtualSpace from './components/VirtualSpace.vue';

// 组件名供App.vue的KeepAlive include="Museum"匹配：返回时保持列表滚动位置与筛选状态
defineOptions({ name: 'Museum' });

type TabKey = 'ai' | 'video' | 'vr';

const route = useRoute();
const router = useRouter();

const museumId = computed(() => (route.query.id as string) || '');
const loading = ref(true);
const errorMsg = ref('');
const museum = ref<MuseumInfo | null>(null);

const activeTab = ref<TabKey>('ai');
const pageIndex = ref(0);

// ==================== 会话内记住浏览位置：从播放页/对话页返回时恢复 ====================
const stateKey = computed(() => `museum-state:${museumId.value}`);
try {
  const saved = JSON.parse(sessionStorage.getItem(stateKey.value) || '{}');
  if (saved.tab)
    activeTab.value = saved.tab;
  if (typeof saved.index === 'number')
    pageIndex.value = saved.index;
}
catch {}

watch([activeTab, pageIndex], () => {
  // 离开museum路由期间（如播放页也带id参数）不写入，避免污染缓存状态
  if (route.path !== '/museum')
    return;
  sessionStorage.setItem(stateKey.value, JSON.stringify({ tab: activeTab.value, index: pageIndex.value }));
});

// 首页圆圈区仅显示"首页显示"开启的智能体（管理端homeShow=0隐藏，null视为显示）
const apps = computed<MuseumChatApp[]>(() => (museum.value?.chatapps || []).filter(app => app.homeShow !== 0));
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

// ==================== 播报中形象切换（与app-chat一致） ====================
// 简介播报出声时当前智能体显示说话gif，播放结束/停止回退待机图
const introSpeaking = ref(false);
// 说话gif加载失败的智能体id集合：失败后回退待机图，避免播报中显示裂图
const talkingGifErrorIds = ref<Set<number | string>>(new Set());

function characterImg(app: MuseumChatApp, active: boolean) {
  const talk = app.talkingGifUrl && !talkingGifErrorIds.value.has(app.id) ? app.talkingGifUrl : '';
  if (active && introSpeaking.value && talk)
    return talk;
  return app.idleImgUrl || talk;
}

function onCharacterImgError(app: MuseumChatApp) {
  if (introSpeaking.value && app.talkingGifUrl)
    talkingGifErrorIds.value.add(app.id);
}

// 通话按钮文案：与{当前激活智能体的duty}通话，duty为空时回退"AI馆员"
const callLabel = computed(() => `与${currentApp.value?.duty?.trim() || 'AI馆员'}通话`);

// ==================== 简介欢迎方式：滚动展示 + 语音播报 ====================
// 欢迎方式=简介（welcomeMode=1且配置了文案）时，用滚动简介框替代欢迎语
const isIntroMode = computed(() => museum.value?.welcomeMode === 1 && !!(museum.value?.introText || '').trim());
const introText = computed(() => (museum.value?.introText || '').trim());

// 简介配音音频地址：OSS签名链接为http://时https站点会被混合内容拦截，统一升级（S3签名与协议无关）
const introVoiceUrl = computed(() => {
  const url = museum.value?.introVoiceUrl || '';
  return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
});

// 简介语音合成音色：优先当前智能体配置的音色，未配置时回退任一已配置音色的智能体（后端校验音色需绑定本博物馆）
const introVoiceProfileId = computed(() => {
  if (currentApp.value?.voiceProfileId != null)
    return currentApp.value.voiceProfileId;
  return (museum.value?.chatapps || []).find(app => app.voiceProfileId != null)?.voiceProfileId ?? null;
});

// 虚拟空间：vrEnable=1 且 vrUrl 有值时才显示
const vrUrl = computed(() => (museum.value ? cleanUrl(museum.value.vrUrl || '') : ''));
const showVrTab = computed(() => !!museum.value && museum.value.vrEnable === 1 && !!vrUrl.value);

// 虚拟空间/AI视频懒加载：首次切换到对应标签后才挂载组件（避免进页面即加载VR和视频列表）；
// 访问过一次后保持挂载，切换标签再回来不重新加载；刷新恢复停留在该标签时视为已访问（immediate覆盖）
const vrVisited = ref(false);
const videoVisited = ref(false);
watch(activeTab, (tab, old) => {
  if (tab === 'vr')
    vrVisited.value = true;
  if (tab === 'video')
    videoVisited.value = true;
  // immediate首次执行（old为undefined）时简介播报状态尚未声明（TDZ）且无播放，跳过
  if (old === undefined)
    return;
  // 简介播报仅在AI馆员视图进行：切走即停止；切回时简介框可能首次可见需重测滚动参数
  if (tab === 'ai')
    updateIntroScroll();
  else
    stopIntroAudio();
}, { immediate: true });

// AI视频：videoEnable=1 时才显示
const showVideoTab = computed(() => !!museum.value && museum.value.videoEnable === 1);

const tabs = computed(() => {
  const list: { key: TabKey; label: string; icon: typeof Avatar }[] = [
    { key: 'ai', label: 'AI馆员', icon: Avatar },
  ];
  // 标签显示名支持管理端配置模块别名，未配置时用默认文案
  if (showVideoTab.value)
    list.push({ key: 'video', label: museum.value?.videoAlias?.trim() || 'AI视频', icon: VideoPlay });
  if (showVrTab.value)
    list.push({ key: 'vr', label: museum.value?.vrAlias?.trim() || '虚拟空间', icon: Compass });
  return list;
});

// 恢复的tab在当前配置下不可用（如AI视频/VR被关闭）时回退默认
watch(tabs, (list) => {
  if (list.length > 0 && !list.some(t => t.key === activeTab.value))
    activeTab.value = 'ai';
});

// 恢复的智能体索引超出范围时回退第一个
watch(apps, (list) => {
  if (list.length > 0 && pageIndex.value >= list.length)
    pageIndex.value = 0;
});

// ==================== 初始化：根据URL中的id加载对应博物馆数据 ====================
async function loadMuseum() {
  loading.value = true;
  errorMsg.value = '';
  museum.value = null;
  if (!museumId.value) {
    errorMsg.value = '缺少博物馆参数';
    loading.value = false;
    return;
  }
  try {
    const res = await getMuseumInfo(museumId.value);
    if (res.code === 200 && res.data) {
      museum.value = res.data;
      // 简介模式：数据就绪后启动语音播报（滚动展示由模板渲染+updateIntroScroll测量驱动）
      if (res.data.isExpire !== 1)
        startIntroPlayback();
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

// 切换不同博物馆id时重新加载并重置浏览位置。
// 注意：museumId取自全局route.query.id，在播放页（/video-play?id=视频id）期间也会变化，
// 因此用lastMuseumId记录上次处理过的博物馆id——仅id真正变化时才重置，返回museum不触发。
let lastMuseumId = museumId.value;
watch(museumId, (newId) => {
  if (route.path !== '/museum' || !newId || newId === lastMuseumId)
    return;
  lastMuseumId = newId;
  activeTab.value = 'ai';
  pageIndex.value = 0;
  loadMuseum();
});

// ==================== 分享（底部抽屉，见 ShareSheet 组件） ====================
const shareVisible = ref(false);

function onShare() {
  shareVisible.value = true;
}

// ==================== 与AI馆员通话 ====================
function onCall(app: MuseumChatApp) {
  // 携带museumId，对话页可通过它获取背景图/形象图等博物馆侧配置
  router.push({ path: '/app-chat', query: { appId: String(app.id), museumId: museumId.value } });
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

// ==================== 简介滚动展示 ====================
// 文案超出框高时纵向匀速滚动，时长按内容高度计算，整段滚出后循环
const introViewportRef = ref<HTMLElement | null>(null);
const introTextRef = ref<HTMLElement | null>(null);
const introNeedsScroll = ref(false);
const introScrollDuration = ref(20);
// 滚动速度（像素/秒）：管理端可配置，未配置/非法值回退24
const introScrollSpeed = computed(() => {
  const v = museum.value?.introScrollSpeed;
  return typeof v === 'number' && v > 0 ? v : 24;
});

function updateIntroScroll() {
  nextTick(() => {
    const viewport = introViewportRef.value;
    const text = introTextRef.value;
    if (!viewport || !text)
      return;
    const innerH = viewport.clientHeight;
    const contentH = text.scrollHeight;
    introNeedsScroll.value = contentH > innerH + 4;
    if (introNeedsScroll.value)
      introScrollDuration.value = Math.max(6, Math.ceil((contentH + innerH) / introScrollSpeed.value));
  });
}
// 简介文案就绪后（DOM渲染完成）测量一次滚动参数
watch(introText, updateIntroScroll);

// ==================== 简介语音播报（与app-chat一致的自动播放解锁策略） ====================
// 复用同一音频元素：微信/iOS WebView的音频解锁绑定在元素上，手势内成功播放过一次后续换src不再要求手势
let introAudioEl: HTMLAudioElement | null = null;
// 当前音频播放结束的回调（停止播报时手动触发，使播放链退出等待）
let introAudioDone: (() => void) | null = null;
// 播放会话代号：每次停止/重新播放时+1，旧的异步播放链检测到变化自动退出
let introPlaySession = 0;

// 极短静音音频（8kHz/8bit/单声道，20ms）：仅用于在用户手势内"点亮"共享音频元素
const SILENT_WAV_URL = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let audioUnlocked = false;
// 解锁静音播放进行中标记：防止解锁完成后pause()误伤已被播放链接管的真实音频
let unlockingAudio = false;
// 首次手势解锁完成的通知队列：play()被自动播放策略拦截时挂起等待，解锁后重试播放
// （如直接打开链接/刷新后无任何用户手势，Chrome拒绝audio.play()——需首次触摸/点击后才能出声）
let unlockWaiters: Array<() => void> = [];

function flushUnlockWaiters() {
  const ws = unlockWaiters;
  unlockWaiters = [];
  ws.forEach(w => w());
}

// 等待首次用户手势且共享元素解锁完成：已解锁（此前发生过交互）则立即放行
function waitAudioUnlock(): Promise<void> {
  if (audioUnlocked)
    return Promise.resolve();
  return new Promise(resolve => unlockWaiters.push(resolve));
}

// 首次用户交互（点任何地方）时，在手势同步栈内用共享元素播放极短静音完成解锁
function unlockAudioOnFirstTouch() {
  if (audioUnlocked)
    return;
  audioUnlocked = true;
  window.removeEventListener('touchend', unlockAudioOnFirstTouch);
  window.removeEventListener('click', unlockAudioOnFirstTouch);
  // 元素正在播放真实音频：此前已解锁过，不重设src干扰
  if (introAudioEl && !introAudioEl.paused) {
    flushUnlockWaiters();
    return;
  }
  const el = introAudioEl || (introAudioEl = new Audio());
  el.onended = null;
  el.onerror = null;
  el.src = SILENT_WAV_URL;
  unlockingAudio = true;
  el.play().then(() => {
    if (unlockingAudio) {
      unlockingAudio = false;
      el.pause();
    }
    flushUnlockWaiters();
  }).catch(() => {
    unlockingAudio = false;
    flushUnlockWaiters();
  });
}
window.addEventListener('touchend', unlockAudioOnFirstTouch);
window.addEventListener('click', unlockAudioOnFirstTouch);

// 播放一段音频（上传配音URL或TTS dataUrl），播完/出错/被停止时resolve；出声期间置说话态
function playIntroSegment(url: string, session: number): Promise<void> {
  return new Promise((resolve) => {
    const el = introAudioEl || (introAudioEl = new Audio());
    unlockingAudio = false; // 播放链接管元素，解锁流程的pause()不再生效
    let settled = false;
    const done = () => {
      if (settled)
        return;
      settled = true;
      introSpeaking.value = false;
      introAudioDone = null;
      resolve();
    };
    introAudioDone = done;
    el.onended = done;
    el.onerror = done;
    el.src = url;
    el.play().then(() => {
      // play()成功出声后再置说话态（已被停止时settled为true，不误标）
      if (!settled)
        introSpeaking.value = true;
    }).catch(async (err) => {
      // 无用户手势被拒（直接打开链接/刷新后）：挂起等待首次交互解锁后重播，其余错误按播完跳过
      if (err?.name !== 'NotAllowedError' || settled || session !== introPlaySession) {
        done();
        return;
      }
      await waitAudioUnlock();
      if (settled || session !== introPlaySession)
        return;
      el.onended = done;
      el.onerror = done;
      introAudioDone = done;
      el.src = url;
      try {
        await el.play();
        if (!settled)
          introSpeaking.value = true;
      }
      catch {
        done();
      }
    });
  });
}

// 停止简介播报：会话+1使旧播放链退出，并中断当前音频
function stopIntroAudio() {
  introPlaySession++;
  introSpeaking.value = false;
  const done = introAudioDone;
  introAudioDone = null;
  if (introAudioEl) {
    introAudioEl.onended = null;
    introAudioEl.onerror = null;
    introAudioEl.pause();
  }
  done?.();
}

// 按句读把简介切成朗读段（与app-chat分段策略一致，避免单次合成文本过长）
const INTRO_SEG_MIN = 24;
const INTRO_SEG_MAX = 80;
function cutIntroSegments(text: string): string[] {
  const segs: string[] = [];
  let start = 0;
  let lastSentence = -1;
  let lastClause = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/[。！？!?…；;]/.test(ch))
      lastSentence = i;
    else if (/[，,、：:）)”"\n]/.test(ch))
      lastClause = i;
    const len = i - start + 1;
    if (lastSentence >= start && len >= INTRO_SEG_MIN) {
      segs.push(text.slice(start, lastSentence + 1));
      start = lastSentence + 1;
      lastSentence = -1;
      lastClause = -1;
    }
    else if (lastClause >= start && len >= INTRO_SEG_MAX) {
      segs.push(text.slice(start, lastClause + 1));
      start = lastClause + 1;
      lastSentence = -1;
      lastClause = -1;
    }
  }
  if (start < text.length)
    segs.push(text.slice(start));
  return segs;
}

// 语音合成播报：按段串行合成播放（音色来自智能体配置），失败段静默跳过
async function playIntroTts(session: number) {
  const text = introText.value;
  const voiceId = introVoiceProfileId.value;
  if (!text || voiceId == null || !museumId.value)
    return;
  for (const seg of cutIntroSegments(text)) {
    if (session !== introPlaySession)
      return;
    try {
      const res = await synthesizeMuseumTts({ museumId: museumId.value, voiceId, text: seg });
      if (session !== introPlaySession)
        return;
      if (res.code === 200 && res.data?.dataUrl)
        await playIntroSegment(res.data.dataUrl, session);
      // 合成失败（含额度超限等）静默跳过该段，不影响滚动展示
    }
    catch {
      // 网络异常跳过该段
    }
  }
}

// 简介播报入口：仅AI馆员视图启动（刷新恢复到AI视频/VR标签时不播）；上传配音直接播放；语音合成（introVoiceMode=2或空值）按段合成播放
function startIntroPlayback() {
  const m = museum.value;
  if (activeTab.value !== 'ai')
    return;
  if (!m || m.welcomeMode !== 1 || m.introVoiceEnable !== 1)
    return;
  stopIntroAudio();
  const session = introPlaySession;
  if (m.introVoiceMode === 1) {
    if (introVoiceUrl.value)
      void playIntroSegment(introVoiceUrl.value, session);
  }
  else {
    void playIntroTts(session);
  }
}

// KeepAlive离开本页（如进入对话页）时停止播报；返回不自动重播（进场已播过一次）
onDeactivated(() => {
  stopIntroAudio();
});

onUnmounted(() => {
  stopIntroAudio();
  window.removeEventListener('touchend', unlockAudioOnFirstTouch);
  window.removeEventListener('click', unlockAudioOnFirstTouch);
});
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

          <!-- 分享：仅图标 -->
          <button class="share-btn" aria-label="分享" @click="onShare">
            <el-icon :size="20">
              <ShareIcon />
            </el-icon>
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
              <div v-for="(app, i) in apps" :key="app.id" class="app-page">
                <img v-if="app.bgUrl" :src="app.bgUrl" class="page-bg" alt="" draggable="false">
                <!-- 简介播报出声时当前智能体切换说话gif，播放结束回退待机图 -->
                <img
                  v-if="characterImg(app, i === pageIndex)"
                  :src="characterImg(app, i === pageIndex)"
                  class="page-character"
                  alt=""
                  draggable="false"
                  @error="onCharacterImgError(app)"
                >
              </div>
            </div>

            <!-- 欢迎语：欢迎方式=欢迎语（默认） -->
            <div v-if="currentApp && !isIntroMode" class="greeting">
              你好，我是{{ displayName(currentApp) }}
            </div>

            <!-- 简介：欢迎方式=简介，超出高度时纵向滚动展示 -->
            <div v-else-if="currentApp" class="intro-box">
              <div ref="introViewportRef" class="intro-viewport">
                <div
                  ref="introTextRef"
                  class="intro-text"
                  :class="{ scrolling: introNeedsScroll }"
                  :style="introNeedsScroll ? { animationDuration: `${introScrollDuration}s` } : undefined"
                >
                  {{ introText }}
                </div>
              </div>
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

        <!-- AI视频视图：video开关关闭或未点击过AI视频标签时用v-if不挂载，避免提前加载视频列表 -->
        <div v-if="showVideoTab && videoVisited" v-show="activeTab === 'video'" class="tab-view">
          <VideoList
            :museum-id="museumId"
            :category-id="museum.videoCategoryId"
            :chatapp-id="museum.videoChatappId"
            :tag-pins="museum.videoTagPins"
          />
        </div>

        <!-- 虚拟空间视图：vr开关关闭时用v-if完全不挂载，避免iframe加载页面 -->
        <div v-if="showVrTab && vrVisited" v-show="activeTab === 'vr'" class="tab-view">
          <VirtualSpace :url="vrUrl" :visible="activeTab === 'vr'" />
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

/* 分享按钮：仅图标，padding保证触控区域 */
.share-btn {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: 14px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border: none;
  background: none;
  color: #fff;
  cursor: pointer;
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
  padding: 4px 60px;
  white-space: nowrap;
  /* 与头像下方标题一致：中间实、两侧渐隐的橙棕背景 */
  background: linear-gradient(
    90deg,
    rgb(98 68 63 / 0%) 0%,
    rgb(98 68 63 / 100%) 30%,
    rgb(98 68 63 / 100%) 70%,
    rgb(98 68 63 / 0%) 100%
  );
  color: #fff;
  font-size: 16px;
  line-height: 1.5;
  text-align: center;
  transform: translateX(-50%);
  pointer-events: none;
  box-sizing: border-box;
}

/* ==================== 简介滚动框（欢迎方式=简介） ====================
   高度48px、宽度80%、半透明背景；文案过长时纵向匀速滚动，短文案垂直居中静态展示 */
.intro-box {
  position: absolute;
  left: 50%;
  bottom: 215px;
  z-index: 20;
  width: 90%;
  height: 48px;
  box-sizing: border-box;
  /* 与欢迎语同色系的半透明背景（中间实、两侧渐隐） */
  background: linear-gradient(
    90deg,
    rgb(98 68 63 / 0%) 0%,
    rgb(98 68 63 / 55%) 8%,
    rgb(98 68 63 / 55%) 92%,
    rgb(98 68 63 / 0%) 100%
  );
  color: #fff;
  font-size: 11px;
  line-height: 1.6;
  transform: translateX(-50%);
  pointer-events: none;
}

/* 滚动视口：上下渐隐遮罩，滚动时文字出入更柔和（40px = 48px框高 - 上下留白4px*2） */
.intro-viewport {
  position: absolute;
  inset: 4px 16px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
}

.intro-text {
  white-space: pre-line;
  word-break: break-all;
  text-align: center;

  /* 短文案不滚动时垂直居中 */
  &:not(.scrolling) {
    position: absolute;
    top: 50%;
    right: 0;
    left: 0;
    transform: translateY(-50%);
  }

  &.scrolling {
    animation: intro-scroll linear infinite;
  }
}

/* 从视口底部完整进入、整段滚出后循环（40px与.intro-viewport内框高一致） */
@keyframes intro-scroll {
  from {
    transform: translateY(40px);
  }

  to {
    transform: translateY(-100%);
  }
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
