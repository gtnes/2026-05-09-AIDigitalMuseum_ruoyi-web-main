<script setup lang="ts">
import type { BubbleProps } from 'vue-element-plus-x/types/Bubble';
import type { BubbleListInstance } from 'vue-element-plus-x/types/BubbleList';
import type { AppChatApp } from '@/api/app-chat/types';
import type { MuseumChatApp } from '@/api/museum/types';
import { ArrowDownBold, ArrowLeft, ArrowRight, ChatDotRound, Check, CopyDocument, Picture, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Sender } from 'vue-element-plus-x';
import { useRoute, useRouter } from 'vue-router';
import { getAppInfo, sendAppChat, synthesizeTts } from '@/api/app-chat';
import { getMuseumInfo } from '@/api/museum';
import { codeXRender } from '@/utils/markdownRenderers';

const route = useRoute();
const router = useRouter();

// 返回上一个页面（从博物馆页进入时返回博物馆）
function goBack() {
  if (window.history.length > 1) {
    router.back();
  }
  else {
    router.push('/museum');
  }
}

type MessageItem = BubbleProps & {
  key: number;
  role: 'user' | 'system' | 'preset';
  class?: string;
};

// 当前应用（按URL中的appId从公开接口获取）
const currentApp = ref<AppChatApp | null>(null);

// 对话相关
const bubbleItems = ref<MessageItem[]>([]);
const bubbleListRef = ref<BubbleListInstance | null>(null);
const inputValue = ref('');
const loading = ref(false);
const sessionId = ref('');
const senderRef = ref<InstanceType<typeof Sender> | null>(null);

// 预设问题：每次最多显示3个，点击刷新按页轮换显示剩余问题
const PRESET_PAGE_SIZE = 3;
const presetPageIndex = ref(0);
const presetExpanded = ref(false);
const presetRefreshing = ref(false);
const presetQuestions = computed(() => currentApp.value?.presetQuestions || []);
const presetPageCount = computed(() => Math.ceil(presetQuestions.value.length / PRESET_PAGE_SIZE));
const visiblePresetQuestions = computed(() => {
  const list = presetQuestions.value;
  // 展开时显示全部问题
  if (presetExpanded.value)
    return list;
  if (list.length <= PRESET_PAGE_SIZE)
    return list;
  const start = presetPageIndex.value * PRESET_PAGE_SIZE;
  return list.slice(start, start + PRESET_PAGE_SIZE);
});

// 刷新预设问题：翻到下一页（循环轮换）
function refreshPresetQuestions() {
  if (presetPageCount.value <= 1)
    return;
  presetPageIndex.value = (presetPageIndex.value + 1) % presetPageCount.value;
  // 播放一次旋转动画
  presetRefreshing.value = false;
  requestAnimationFrame(() => {
    presetRefreshing.value = true;
  });
}

// 展开 / 收起全部预设问题
function togglePresetExpand() {
  presetExpanded.value = !presetExpanded.value;
}

// 点击预设问题直接发送
function askPresetQuestion(question: string) {
  if (loading.value || !question)
    return;
  startSSE(question);
}

const urlAppId = computed(() => route.query.appId as string);

// 从博物馆页进入时携带的museumId，用于获取背景图/形象图
const urlMuseumId = computed(() => route.query.museumId as string);

// ==================== 背景开关：开启时显示博物馆背景图与AI形象图 ====================
const bgEnabled = ref(false);
const bgUrl = ref('');
const idleImgUrl = ref('');
const talkingGifUrl = ref('');

// 音频是否正在出声播放（控制形象图说话gif切换）
const audioPlaying = ref(false);

// 背景形象图：音频出声播放中显示说话gif，暂停/未播放显示待机图，缺失时回退另一张
const characterImg = computed(() => {
  if (audioPlaying.value && talkingGifUrl.value)
    return talkingGifUrl.value;
  return idleImgUrl.value || talkingGifUrl.value;
});

// 按museumId获取博物馆数据，提取当前应用的背景图/形象图/AI语音配置
// 当前智能体配置的音色档案id（voiceProfileId，空=该智能体无语音）
const currentVoiceProfileId = ref<number | string | null>(null);
// 管理端语音开关（false时整个语音功能对用户隐藏）
const voiceSwitchOn = ref(false);
// 自动播报初始状态（来自管理端配置，会话内用户可用气泡喇叭按钮切换）
const autoPlayVoice = ref(false);
// 每次开启开关都重新获取：OSS签名链接有时效，需保证链接新鲜
async function loadBgMedia() {
  try {
    const res = await getMuseumInfo(urlMuseumId.value);
    if (res.code === 200 && res.data) {
      const chatapp = (res.data.chatapps || []).find((a: MuseumChatApp) => String(a.id) === String(urlAppId.value));
      if (chatapp) {
        bgUrl.value = chatapp.bgUrl || '';
        idleImgUrl.value = chatapp.idleImgUrl || '';
        talkingGifUrl.value = chatapp.talkingGifUrl || '';
        // 智能体固定音色（AI语音管理配置的音色档案），未配置则语音功能不可用
        currentVoiceProfileId.value = chatapp.voiceProfileId ?? null;
        // 语音开关：旧数据null视为开启；关闭时不显示播报按钮、不发合成请求
        voiceSwitchOn.value = chatapp.voiceEnabled !== false;
        // 自动播报初始状态由管理端配置决定（会话内用户可用喇叭按钮切换）
        autoPlayVoice.value = chatapp.voiceAutoPlay === true;
      }
    }
  }
  catch {
    // 获取失败时静默处理，背景不显示
  }
}

// 切换背景开关
function toggleBg() {
  bgEnabled.value = !bgEnabled.value;
  if (bgEnabled.value && urlMuseumId.value)
    loadBgMedia();
}

// 背景图加载失败时清空，避免显示裂图
function onBgImgError() {
  bgUrl.value = '';
}

// 形象图加载失败时清空当前显示的那张，回退到另一张
function onCharacterImgError() {
  if (loading.value && talkingGifUrl.value)
    talkingGifUrl.value = '';
  else
    idleImgUrl.value = '';
}

// 输入框上方功能按钮
const featureOptions = [
  { key: 'web', label: '联网搜索', icon: 'Search' },
  { key: 'authority', label: '权威资讯', icon: 'Reading' },
  { key: 'deep', label: '深度思考', icon: 'MagicStick' },
];
const activeFeatures = ref<string[]>(['authority']);

// 切换功能按钮选中状态
function toggleFeature(key: string) {
  const index = activeFeatures.value.indexOf(key);
  if (index >= 0)
    activeFeatures.value.splice(index, 1);
  else
    activeFeatures.value.push(key);
}

// ==================== 语音播报（TTS）：分段流式合成，边生成边合成边播放 ====================
// 当前朗读中的消息key
const playingKey = ref<number | null>(null);
let audio: HTMLAudioElement | null = null;
// 当前音频播放结束的回调（停止朗读时手动触发，使播放链退出等待）
let audioDone: (() => void) | null = null;
// 播放会话代号：每次停止/切换时+1，旧的异步播放链检测到变化自动退出
let playSession = 0;

// 语音功能是否可用（管理端语音开关开启 且 当前智能体配置了AI语音）
const voiceEnabled = computed(() => voiceSwitchOn.value && currentVoiceProfileId.value != null);

// 气泡上的自动播报开关：喇叭=开启自动播报并播放该条；禁止喇叭=关闭自动播报并停止播放
function toggleBubblePlay(item: MessageItem) {
  if (autoPlayVoice.value) {
    autoPlayVoice.value = false;
    localStorage.setItem('app-chat-voice-auto', '0');
    stopAudio();
    return;
  }
  autoPlayVoice.value = true;
  localStorage.setItem('app-chat-voice-auto', '1');
  playMessage(item);
}

// Markdown转纯文本：去掉代码块/图片/链接/标记符等，仅保留朗读内容
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- 分段合成引擎 ----------
// 每条消息的分段状态：texts分段文本 / urls已合成音频 / pending进行中的合成 / consumed已切片字符数
interface SegmentState {
  texts: string[];
  urls: (string | undefined)[];
  pending: Record<number, Promise<void> | undefined>;
  consumed: number;
  finished: boolean;
  rawText: string;
}
// 一段最短长度：避免请求过碎；无句读时的兜底最大长度
const SEGMENT_MIN_LENGTH = 24;
const SEGMENT_MAX_LENGTH = 80;
const SENTENCE_END_RE = /[。！？!?…；;]/;
const CLAUSE_END_RE = /[，,、：:）)”"\n]/;
const segmentStore = new Map<number, SegmentState>();

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// 从纯文本中按句读切出完整段（flush=true时把尾部剩余也切出来）
function cutSegments(st: SegmentState, flush: boolean) {
  const text = st.rawText;
  let start = st.consumed;
  let lastSentence = -1;
  let lastClause = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (SENTENCE_END_RE.test(ch))
      lastSentence = i;
    else if (CLAUSE_END_RE.test(ch))
      lastClause = i;
    const len = i - start + 1;
    if (lastSentence >= start && len >= SEGMENT_MIN_LENGTH) {
      st.texts.push(text.slice(start, lastSentence + 1));
      st.urls.push(undefined);
      start = lastSentence + 1;
      lastSentence = -1;
      lastClause = -1;
    }
    else if (lastClause >= start && len >= SEGMENT_MAX_LENGTH) {
      st.texts.push(text.slice(start, lastClause + 1));
      st.urls.push(undefined);
      start = lastClause + 1;
      lastSentence = -1;
      lastClause = -1;
    }
  }
  if (flush && start < text.length) {
    st.texts.push(text.slice(start));
    st.urls.push(undefined);
    start = text.length;
  }
  st.consumed = start;
}

// 发起单段合成（幂等：已合成/合成中跳过）
function startSegmentSynth(key: number, index: number) {
  const st = segmentStore.get(key);
  if (!st || st.urls[index] || st.pending[index] || !currentVoiceProfileId.value)
    return;
  st.pending[index] = synthesizeTts({ voiceId: currentVoiceProfileId.value, text: st.texts[index] })
    .then((res) => {
      delete st.pending[index];
      if (res.code === 200 && res.data?.dataUrl)
        st.urls[index] = res.data.dataUrl;
    })
    .catch(() => {
      delete st.pending[index];
    });
}

// SSE流式过程中持续喂入文本：增量切块并立即预合成；前缀变化（如代码块闭合）时重置重切
// autoStart=false时不自动启动播放（供手动播放路径使用，避免与手动播放链叠加成双声）
function feedSegments(key: number, content: string, autoStart = true) {
  if (!voiceEnabled.value || !content)
    return;
  const text = stripMarkdown(content);
  if (!text)
    return;
  let st = segmentStore.get(key);
  if (!st) {
    st = { texts: [], urls: [], pending: {}, consumed: 0, finished: false, rawText: '' };
    segmentStore.set(key, st);
  }
  if (!text.startsWith(st.rawText.slice(0, st.consumed))) {
    st.texts = [];
    st.urls = [];
    st.pending = {};
    st.consumed = 0;
    st.finished = false;
  }
  st.rawText = text;
  cutSegments(st, false);
  // 仅自动播报开启或该消息正在播放中时才预合成（边生成边合成秒出声）；
  // 自动播报关闭时只切分缓存文本、不发任何合成请求，点喇叭时再批量合成
  if (autoPlayVoice.value || playingKey.value === key)
    st.texts.forEach((_, i) => startSegmentSynth(key, i));

  // 自动播报：首段切出即开始播放（不打断手动播放中的其它消息）
  if (autoStart && autoPlayVoice.value && playingKey.value == null && st.texts.length > 0)
    startPlayback(key);
}

// 统一播放入口：先终止一切旧播放会话（会话代号+1使残留异步链失效），
// 保证任意时刻至多一条播放链、一个音频实例——否则会出现双声/停不掉
function startPlayback(key: number) {
  stopAudio();
  playingKey.value = key;
  playSegmentsLoop(key, playSession);
}

// 消息生成结束：收尾切块（尾部不足一段也切出）
function finishMessageTts(key: number) {
  const st = segmentStore.get(key);
  if (st && !st.finished) {
    st.finished = true;
    cutSegments(st, true);
    // 仅自动播报开启或该消息正在播放中时补合成尾部段；关闭自动播报时不发请求
    // （手动播放路径 playMessage 会自行批量合成，不依赖这里）
    if (autoPlayVoice.value || playingKey.value === key)
      st.texts.forEach((_, i) => startSegmentSynth(key, i));
  }
}

// 顺序播放各分段音频；下一段未就绪时等它的合成完成（合成早已并行发起），实现边合成边播
async function playSegmentsLoop(key: number, session: number) {
  const st = segmentStore.get(key);
  if (!st)
    return;
  for (let i = 0; i < st.texts.length || !st.finished;) {
    if (session !== playSession)
      return;
    if (i >= st.texts.length) {
      // 内容仍在生成，等待新段切出
      await sleep(250);
      continue;
    }
    // 预启动下一段合成，保持流水线：当前段播放时下一段已在合成
    if (i + 1 < st.texts.length)
      startSegmentSynth(key, i + 1);
    if (st.pending[i])
      await st.pending[i];
    if (session !== playSession)
      return;
    const url = st.urls[i];
    if (url) {
      await playAudio(key, url);
      i++;
    }
    else {
      i++; // 该段合成失败，跳过
    }
  }
  if (session === playSession && playingKey.value === key)
    playingKey.value = null;
}

// 朗读/停止朗读一条AI消息
function playMessage(item: MessageItem) {
  // 正在朗读这条消息：再次点击停止
  if (playingKey.value === item.key) {
    stopAudio();
    return;
  }
  if (!currentVoiceProfileId.value) {
    ElMessage.warning('当前智能体未配置AI语音');
    return;
  }
  if (!stripMarkdown(item.content || '')) {
    ElMessage.warning('没有可朗读的内容');
    return;
  }
  stopAudio();
  // 准备分段状态并从头播放（已合成段直接复用缓存）；不自动启动，由统一入口接管
  feedSegments(item.key, item.content || '', false);
  const st = segmentStore.get(item.key);
  if (!st)
    return;
  st.finished = true;
  cutSegments(st, true);
  st.texts.forEach((_, i) => startSegmentSynth(item.key, i));
  startPlayback(item.key);
}

// 播放单段音频，播完/出错/被停止时resolve
function playAudio(key: number, dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    audio = new Audio(dataUrl);
    playingKey.value = key;
    let settled = false;
    const done = () => {
      if (settled)
        return;
      settled = true;
      audioPlaying.value = false;
      audioDone = null;
      audio = null;
      resolve();
    };
    audioDone = done;
    audio.onended = done;
    audio.onerror = done;
    audio.play().then(() => {
      // play() resolve后再置true，防止已被停止（settled）时误标为播放中
      if (!settled)
        audioPlaying.value = true;
    }).catch(done);
  });
}

// 停止朗读：会话代号+1使播放链退出，并中断当前音频
function stopAudio() {
  playSession++;
  audioPlaying.value = false;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio = null;
  }
  audioDone?.();
  audioDone = null;
  playingKey.value = null;
}

// 回复完成后自动播报（自动开关开启且该消息未在播放中时，从头启动播放）
function autoPlayIfEnabled(key: number) {
  if (!voiceEnabled.value || !autoPlayVoice.value)
    return;
  if (playingKey.value === key)
    return; // 流式播放已在进行，收尾段会自动接上
  const st = segmentStore.get(key);
  if (!st || st.texts.length === 0)
    return;
  startPlayback(key);
}

// 复制 / 编辑
const copyIconMap = ref<Record<number, string>>({});
const editingMessageKeys = ref<number[]>([]);
const editedContents = ref<Record<number, string>>({});

// 头像加载失败标记，回退到默认图标
const avatarErrorKeys = ref<Set<number>>(new Set());

// 默认头像：内置SVG图标（浅棕底 + 主题色对话图标），不依赖外链地址
const DEFAULT_AVATAR
  = `data:image/svg+xml,${
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
      + '<rect width="1024" height="1024" fill="#F0E4DA"/>'
      + '<g transform="translate(512 512) scale(0.62) translate(-512 -512)" fill="#A0704D">'
      + '<path d="m174.72 855.68 135.296-45.12 23.68 11.84C388.096 849.536 448.576 864 512 864c211.84 0 384-166.784 384-352S723.84 160 512 160 128 326.784 128 512c0 69.12 24.96 139.264 70.848 199.232l22.08 28.8-46.272 115.584zm-45.248 82.56A32 32 0 0 1 89.6 896l58.368-145.92C94.72 680.32 64 596.864 64 512 64 299.904 256 96 512 96s448 203.904 448 416-192 416-448 416a461.056 461.056 0 0 1-206.912-48.384l-175.616 58.56z"/>'
      + '<path d="M512 563.2a51.2 51.2 0 1 1 0-102.4 51.2 51.2 0 0 1 0 102.4m192 0a51.2 51.2 0 1 1 0-102.4 51.2 51.2 0 0 1 0 102.4m-384 0a51.2 51.2 0 1 1 0-102.4 51.2 51.2 0 0 1 0 102.4"/>'
      + '</g></svg>',
    )}`;

// 用户默认头像：内置SVG人形图标，与AI默认头像同风格
const DEFAULT_USER_AVATAR
  = `data:image/svg+xml,${
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'
      + '<rect width="1024" height="1024" fill="#F0E4DA"/>'
      + '<g transform="translate(512 512) scale(0.62) translate(-512 -512)" fill="#A0704D">'
      + '<path d="M288 320a224 224 0 1 0 448 0 224 224 0 1 0-448 0m544 608H160a32 32 0 0 1-32-32v-96a160 160 0 0 1 160-160h448a160 160 0 0 1 160 160v96a32 32 0 0 1-32 32z"/>'
      + '</g></svg>',
    )}`;

// AI消息气泡头像：优先使用应用配置的appShow图片，未配置或加载失败时回退默认头像
const aiAvatar = computed(() => {
  const app = currentApp.value;
  if (app?.appShow && !avatarErrorKeys.value.has(app.id))
    return app.appShow;
  return DEFAULT_AVATAR;
});

function onAvatarError() {
  if (!currentApp.value)
    return;
  avatarErrorKeys.value.add(currentApp.value.id);
  // 已入列的AI气泡头像同步回退为默认头像
  bubbleItems.value = bubbleItems.value.map(item =>
    item.role === 'system' && item.avatar !== DEFAULT_AVATAR
      ? { ...item, avatar: DEFAULT_AVATAR }
      : item,
  );
}

// SSE
let eventSource: EventSource | null = null;

// 参数错误提示（无appId或应用不存在时显示"系统错误"，不做跳转）
const pageError = ref('');

// 初始化（按URL中的appId定位应用、建立SSE连接）
async function init() {
  // 无appId：参数不合理，直接提示系统错误
  if (!urlAppId.value) {
    pageError.value = '系统错误';
    return;
  }

  // 生成会话ID
  sessionId.value = `app-chat-${Date.now()}`;

  // 按URL中的appId获取单个应用信息（公开接口，只返回该应用）
  try {
    const res = await getAppInfo(urlAppId.value);
    if (res.code === 200 && res.data) {
      const app = res.data as AppChatApp;
      currentApp.value = app;
      // 预设问题模块放在对话流第一条；欢迎语紧随其后
      if (presetQuestions.value.length)
        addPresetItem();
      if (app.welcomeMsg)
        addMessage(app.welcomeMsg, false, true);
    }
    else {
      pageError.value = '系统错误';
      return;
    }
  }
  catch {
    pageError.value = '系统错误';
    return;
  }

  // 建立SSE连接
  connectSSE();
}

// ==================== 回到底部按钮（自实现） ====================
// 内置按钮依赖容器尺寸变化的ResizeObserver判断是否有滚动条，移动端内容增长不触发容器
// 尺寸变化导致 hasVertical 停留 false，按钮偶发不渲染；改为页面自行监听滚动距离
const BACK_BOTTOM_THRESHOLD = 80;
const chatAreaRef = ref<HTMLElement | null>(null);
const showBackBottom = ref(false);

// 滚动离底超过阈值时显示按钮
function onChatListScroll() {
  const el = chatAreaRef.value?.querySelector('.el-bubble-list');
  if (!el)
    return;
  showBackBottom.value = el.scrollHeight - (el.scrollTop + el.clientHeight) > BACK_BOTTOM_THRESHOLD;
}

// 点击回到底部
function onBackBottom() {
  scrollToBottom();
}

onMounted(() => {
  init();
  // 监听对话列表滚动：控制回到底部按钮显隐
  chatAreaRef.value?.querySelector('.el-bubble-list')?.addEventListener('scroll', onChatListScroll, { passive: true });
  // 从博物馆页进入（带museumId）时默认开启背景并加载媒体
  // （同时提取智能体语音配置：音色/语音开关/自动播报初始状态）
  if (urlMuseumId.value) {
    bgEnabled.value = true;
    loadBgMedia();
  }
});

onUnmounted(() => {
  closeSSE();
  stopAudio();
  chatAreaRef.value?.querySelector('.el-bubble-list')?.removeEventListener('scroll', onChatListScroll);
});

// 建立SSE连接
function connectSSE() {
  if (!sessionId.value)
    return;

  const baseURL = import.meta.env.VITE_API_URL || '';
  const url = `${baseURL}/system/chatapp/connect/${sessionId.value}`;

  eventSource = new EventSource(url);

  // 监听内容事件（后端 event 名称为 "content"）
  eventSource.addEventListener('content', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const content = data.content || '';
      if (content) {
        // 后端推送的是完整文本，直接替换而不是累加
        const lastIndex = bubbleItems.value.length - 1;
        const lastMsg = bubbleItems.value[lastIndex];
        if (lastMsg && lastMsg.role === 'system') {
          // 创建新对象引用，确保 BubbleList 能检测到内容变化
          bubbleItems.value[lastIndex] = { ...lastMsg, content, loading: false };
          bubbleItems.value = [...bubbleItems.value];
          scrollToBottom();
          // 边生成边切分合成语音（自动播报开启时首段就绪即开播）
          feedSegments(lastMsg.key, content);
        }
      }
    }
    catch (e) {
      console.error('SSE content 事件解析错误:', e);
    }
  });

  // 监听错误事件（后端 event 名称为 "error"）
  eventSource.addEventListener('error', (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      const errorMsg = data.error || '对话出错';
      ElMessage.error(errorMsg);
      finishLastAssistantMessage();
    }
    catch (e) {
      console.error('SSE error 事件解析错误:', e);
    }
  });

  // 监听完成事件（后端 event 名称为 "done"）：收尾切块合成剩余文本，按需自动播报
  eventSource.addEventListener('done', (_event) => {
    finishLastAssistantMessage();
    const lastMsg = bubbleItems.value[bubbleItems.value.length - 1];
    if (lastMsg && lastMsg.role === 'system' && lastMsg.content) {
      finishMessageTts(lastMsg.key);
      autoPlayIfEnabled(lastMsg.key);
    }
  });

  // 默认消息处理（兜底）
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const content = data.content;
      if (typeof content === 'string' && content) {
        const lastIndex = bubbleItems.value.length - 1;
        const lastMsg = bubbleItems.value[lastIndex];
        if (lastMsg && lastMsg.role === 'system') {
          bubbleItems.value[lastIndex] = { ...lastMsg, content, loading: false };
          bubbleItems.value = [...bubbleItems.value];
          scrollToBottom();
          feedSegments(lastMsg.key, content);
        }
      }
    }
    catch (e) {
      console.error('SSE默认消息解析错误:', e);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE连接错误:', error);
    finishLastAssistantMessage();
    // 连接异常中断：收尾已生成的部分文本（不自动播报）
    const lastMsg = bubbleItems.value[bubbleItems.value.length - 1];
    if (lastMsg && lastMsg.role === 'system' && lastMsg.content)
      finishMessageTts(lastMsg.key);
  };
}

// 结束当前助手消息的 loading 状态
function finishLastAssistantMessage() {
  loading.value = false;
  const lastIndex = bubbleItems.value.length - 1;
  const lastMsg = bubbleItems.value[lastIndex];
  if (lastMsg && lastMsg.role === 'system' && lastMsg.loading) {
    bubbleItems.value[lastIndex] = { ...lastMsg, loading: false };
    bubbleItems.value = [...bubbleItems.value];
  }
}

// 关闭SSE
function closeSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// 添加预设问题模块（对话流第一条，无头像、无气泡背景，随消息一起滚动）
function addPresetItem() {
  bubbleItems.value.push({
    key: bubbleItems.value.length,
    role: 'preset',
    placement: 'start',
    noStyle: true,
    maxWidth: '100%',
    loading: false,
    content: '',
  });
}

// 添加消息（staticMsg为true时用于欢迎语等静态AI消息，不显示loading态）
function addMessage(message: string, isUser: boolean, staticMsg = false) {
  const key = bubbleItems.value.length;
  const obj: MessageItem = {
    key,
    avatar: isUser ? DEFAULT_USER_AVATAR : aiAvatar.value,
    avatarSize: '32px',
    role: isUser ? 'user' : 'system',
    placement: isUser ? 'end' : 'start',
    isMarkdown: !isUser,
    loading: !isUser && !staticMsg,
    content: message || '',
    noStyle: isUser,
  };
  bubbleItems.value.push(obj);
  copyIconMap.value[key] = 'CopyDocument';
}

// 发送消息
async function startSSE(content: string) {
  if (!currentApp.value) {
    ElMessage.warning('请先选择应用');
    return;
  }
  if (loading.value)
    return;

  inputValue.value = '';

  // 添加用户消息
  addMessage(content, true);
  // 添加空的助手消息（等待SSE填充）
  addMessage('', false);

  loading.value = true;
  scrollToBottom();

  try {
    await sendAppChat({
      appId: currentApp.value.id,
      content,
      sessionId: sessionId.value,
    });
  }
  catch (error) {
    console.error('发送失败:', error);
    loading.value = false;
    ElMessage.error('发送失败');
  }
}

// 取消生成
function cancelSSE() {
  closeSSE();
  connectSSE();
  loading.value = false;
}

// 滚动到底部
function scrollToBottom() {
  nextTick(() => {
    bubbleListRef.value?.scrollToBottom();
  });
}

// 复制
function copyToClipboard(text: string, key: number) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      copyIconMap.value[key] = 'Check';
      setTimeout(() => {
        copyIconMap.value[key] = 'CopyDocument';
      }, 2000);
    })
    .catch((err) => {
      console.error('复制失败:', err);
      ElMessage.error('复制失败，请手动复制');
    });
}

// 编辑
function startEditing(item: MessageItem) {
  if (!editingMessageKeys.value.includes(item.key)) {
    editingMessageKeys.value.push(item.key);
    editedContents.value[item.key] = item.content || '';
  }
  item.noStyle = true;
  item.class = 'editing-bubble';
}

function cancelEditingByKey(key: number) {
  const item = bubbleItems.value.find(i => i.key === key);
  if (item) {
    // 用户消息始终保持自定义气泡样式，避免与 Bubble 默认样式叠加
    item.noStyle = true;
    item.class = '';
  }
  editingMessageKeys.value = editingMessageKeys.value.filter(k => k !== key);
  delete editedContents.value[key];
}

function sendMessageByKey(key: number) {
  const newContent = editedContents.value[key];
  if (newContent) {
    startSSE(newContent);
    cancelEditingByKey(key);
  }
}
</script>

<template>
  <div class="app-chat-page" :class="{ 'bg-on': bgEnabled }">
    <!-- 背景层：开启背景开关后显示博物馆背景图与AI形象图（半透明蒙层保证消息可读） -->
    <div v-if="bgEnabled" class="chat-bg-layer" aria-hidden="true">
      <img
        v-if="bgUrl"
        :src="bgUrl"
        class="chat-bg"
        alt=""
        draggable="false"
        @error="onBgImgError"
      >
      <img
        v-if="characterImg"
        :src="characterImg"
        class="chat-character"
        alt=""
        draggable="false"
        @error="onCharacterImgError"
      >
    </div>
    <!-- 左上角返回按钮 -->
    <button class="back-btn" aria-label="返回" @click="goBack">
      <el-icon :size="20">
        <ArrowLeft />
      </el-icon>
    </button>
    <!-- 右上角背景开关：仅从博物馆页进入（带museumId）时显示 -->
    <button
      v-if="urlMuseumId"
      class="bg-toggle-btn"
      :class="{ 'is-on': bgEnabled }"
      aria-label="背景开关"
      title="背景显示开关"
      @click="toggleBg"
    >
      <el-icon :size="14">
        <Picture />
      </el-icon>
    </button>
    <!-- 参数错误提示：无appId或应用不存在 -->
    <div v-if="pageError" class="page-error">
      <div class="page-error-icon">
        <el-icon :size="30">
          <WarningFilled />
        </el-icon>
      </div>
      <div class="page-error-title">
        系统错误
      </div>
      <div class="page-error-desc">
        页面参数有误，请检查访问链接是否完整
      </div>
    </div>
    <div v-else class="chat-warp">
      <!-- 顶部智能体头像与名称 -->
      <div v-if="currentApp" class="agent-header">
        <img
          v-if="currentApp.appShow && !avatarErrorKeys.has(currentApp.id)"
          class="agent-avatar"
          :src="currentApp.appShow"
          :alt="currentApp.appName"
          @error="onAvatarError"
        >
        <div v-else class="agent-avatar agent-avatar-fallback">
          <el-icon :size="28">
            <ChatDotRound />
          </el-icon>
        </div>
        <div class="agent-name">
          {{ currentApp.appName }}
        </div>
      </div>

      <div ref="chatAreaRef" class="chat-bubble-area">
        <BubbleList
          ref="bubbleListRef"
          class="chat-bubble-list"
          :list="bubbleItems"
          max-height="100%"
          :show-back-button="false"
        >
          <template #content="{ item }">
            <!-- 预设问题模块：对话流第一条，随消息一起滚动 -->
            <div v-if="item.role === 'preset'" class="preset-questions">
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
                  @click="askPresetQuestion(question)"
                >
                  <span class="preset-dot" />
                  <span class="preset-text">{{ question }}</span>
                </div>
              </div>
            </div>
            <div v-else-if="item.role === 'system'" class="system-msg-wrap">
              <XMarkdown
                v-if="item.content"
                :markdown="item.content"
                :code-x-render="codeXRender"
                class="markdown-body"
                :themes="{ light: 'github-light', dark: 'github-dark' }"
                default-theme-mode="dark"
              />
              <!-- 操作按钮：复制 + 朗读（朗读需音色可用） -->
              <div v-if="item.content" class="tts-action-row">
                <button class="tts-btn" @click="copyToClipboard(item.content, item.key)">
                  <el-icon :size="12">
                    <Check v-if="copyIconMap[item.key] === 'Check'" />
                    <CopyDocument v-else />
                  </el-icon>
                </button>
                <!-- 自绘小喇叭图标（Element Plus无喇叭图标）：允许播报=喇叭+声波，禁止播报=喇叭+斜线 -->
                <button
                  v-if="voiceEnabled"
                  class="tts-btn"
                  :class="{ 'is-playing': playingKey === item.key }"
                  @click="toggleBubblePlay(item)"
                >
                  <svg
                    v-if="autoPlayVoice"
                    class="tts-ico"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                  <svg
                    v-else
                    class="tts-ico"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                </button>
              </div>
            </div>
            <div v-else-if="item.content && item.role === 'user'" class="userContent">
              <div class="user-bubble" :class="{ editing: editingMessageKeys.includes(item.key) }">
                <template v-if="!editingMessageKeys.includes(item.key)">
                  <div class="user-content">
                    {{ item.content }}
                  </div>
                </template>

                <template v-else>
                  <div class="edit-card">
                    <el-input
                      v-model="editedContents[item.key]"
                      type="textarea"
                      autosize
                      class="edit-input"
                    />
                    <div class="edit-actions">
                      <el-button size="small" @click="cancelEditingByKey(item.key)">
                        取消
                      </el-button>
                      <el-button type="primary" size="small" @click="sendMessageByKey(item.key)">
                        发送
                      </el-button>
                    </div>
                  </div>
                </template>
              </div>

              <div v-if="!editingMessageKeys.includes(item.key)" class="copy-button-container">
                <el-tooltip content="复制" placement="bottom">
                  <el-button
                    class="copy-btn"
                    :icon="copyIconMap[item.key] || 'CopyDocument'"
                    size="small"
                    @click="copyToClipboard(item.content, item.key)"
                  />
                </el-tooltip>
                <el-tooltip content="编辑" placement="bottom">
                  <el-button class="copy-btn" icon="Edit" size="small" @click="startEditing(item)" />
                </el-tooltip>
              </div>
            </div>
          </template>
        </BubbleList>

        <!-- 回到底部：滚动离底超过阈值时显示（自实现，替代内置按钮在移动端偶发不渲染的问题） -->
        <Transition name="back-bottom-fade">
          <button
            v-if="showBackBottom"
            class="back-bottom-btn"
            aria-label="回到底部"
            @click="onBackBottom"
          >
            <el-icon :size="24">
              <ArrowDownBold />
            </el-icon>
          </button>
        </Transition>
      </div>

      <div class="sender-wrapper">
        <!-- 功能按钮：输入框外部左上方 -->
        <div class="feature-buttons">
          <div
            v-for="opt in featureOptions"
            :key="opt.key"
            class="feature-btn"
            :class="{ 'is-active': activeFeatures.includes(opt.key) }"
            @click="toggleFeature(opt.key)"
          >
            <el-icon :size="12">
              <component :is="opt.icon" />
            </el-icon>
            <span>{{ opt.label }}</span>
          </div>
        </div>

        <Sender
          ref="senderRef"
          v-model="inputValue"
          class="chat-sender"
          :auto-size="{
            maxRows: 6,
            minRows: 3,
          }"
          variant="updown"
          clearable
          allow-speech
          :loading="loading"
          @submit="startSSE"
          @cancel="cancelSSE"
        >
          <template #prefix>
            <div class="sender-prefix-container" />
          </template>
        </Sender>

        <!-- 底部免责声明 -->
        <div class="sender-footer-tip">
          内容由阿里AI大模型生成，仅供参考
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 页面容器：居中布局，撑满全屏高度
.app-chat-page {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  // 页面主题色变量（棕色系），供下方样式统一引用
  --theme-primary: #a0704d;
  --theme-primary-rgb: 160, 112, 77;

  // 米色基色：背景开启模式下统一使用（标题字体、气泡与模块背景）
  --theme-cream: #fffaf2;
  --theme-cream-rgb: 255, 250, 242;
  // 将 Element Plus 主色统一改为主题棕色，覆盖所有组件默认蓝色
  --el-color-primary: var(--theme-primary);
  --el-color-primary-light-3: #b88d6d;
  --el-color-primary-light-5: #c9a88d;
  --el-color-primary-light-7: #dbc3b0;
  --el-color-primary-light-8: #e5d3c4;
  --el-color-primary-light-9: #f0e4da;
  --el-color-primary-dark-2: #805a3e;
  // 页面顶部渐变背景（浅橙到白色），不影响内容层
  &::before {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    width: 100%;
    height: 30vh;
    min-height: 180px;
    content: '';
    background: linear-gradient(180deg, #fff0db 0%, #ffffff 100%);
    pointer-events: none;
  }

  // 背景层：背景图铺满 + 形象图居中底部，定位在页面最底层
  .chat-bg-layer {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;

    // 背景图：铺满全屏（与museum页page-bg一致）
    .chat-bg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    // 形象图：底部居中（与museum页page-character一致）
    .chat-character {
      position: absolute;
      bottom: 0;
      left: 50%;
      height: 62%;
      object-fit: contain;
      transform: translateX(-50%);
    }

    // 半透明深色蒙层：压暗背景对消息阅读的干扰
    &::after {
      position: absolute;
      inset: 0;
      content: '';
      background: rgb(0 0 0 / 60%);
    }
  }

  // 聊天内容区域：上下布局，输入框固定在底部
  .chat-warp {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 800px;
    height: 100vh;
    padding: 0 10px 10px;
    // 消息列表：占据剩余空间并内部滚动，避免把输入框挤出屏幕
    .chat-bubble-area {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .chat-bubble-list {
      flex: 1;
      min-height: 0;
    }
    // 预设问题模块：主题棕色标题 + 下划线问题列表（位于对话流中）
    .preset-questions {
      padding-top: 4px;

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
        color: #8f9095;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;

        .preset-dot {
          flex-shrink: 0;
          width: 5px;
          height: 5px;
          background: #b4b6bd;
          border-radius: 50%;
        }

        .preset-text {
          text-decoration: underline;
          text-decoration-color: rgb(0 0 0 / 25%);
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
    // 输入框容器
    .sender-wrapper {
      position: relative;
      flex-shrink: 0;
      width: 100%;
    }
  }
  // 覆盖 BubbleList 组件内部样式
  :deep() {
    // 气泡列表顶部间距
    .el-bubble-list {
      padding-top: 24px;
    }
    // 单个气泡左右和底部间距
    .el-bubble {
      padding: 0 12px;
      padding-bottom: 24px;
    }
    // 打字器圆角
    .el-typewriter {
      overflow: hidden;
      border-radius: 12px;
    }
    // 用户消息文本保留换行
    .user-content {
      white-space: pre-wrap;
    }
    // AI（system）气泡背景改为更浅的灰色
    .el-bubble.el-bubble-start .el-bubble-content-filled {
      background-color: #f7f7f7 !important;
    }
    // Markdown 内容：透明背景、不限制宽度
    .markdown-body {
      width: auto;
      max-width: none;
      overflow: visible;
      background-color: transparent;
    }
    // XMarkdown 容器内边距
    .elx-xmarkdown-container {
      width: 100%;
      padding: 8px 4px;
      overflow: visible;
    }
  }

  // 背景开启时的适配样式：白色统一为米色、气泡半透明
  &.bg-on {
    // 头像下方标题：浅色（米色）
    .agent-name {
      color: var(--theme-cream);
    }

    // "你可以试着问我"模块：深色半透明背景（标题/更多保持浅色模式的主题棕），问题文字米色系
    .chat-warp .preset-questions {
      padding: 12px;
      background: rgb(45 34 27 / 88%);
      border-radius: 12px;

      // 问题列表：浅米色文字
      .preset-item {
        color: rgb(var(--theme-cream-rgb), 80%);
        .preset-dot {
          background: rgb(var(--theme-cream-rgb), 50%);
        }
        .preset-text {
          text-decoration-color: rgb(var(--theme-cream-rgb), 80%);
        }

        @media (hover: hover) and (pointer: fine) {
          &:hover .preset-text {
            color: var(--theme-cream);
            text-decoration-color: var(--theme-cream);
          }
        }
      }
    }

    // AI气泡：米色底透明度75%，文字深棕色
    :deep(.el-bubble.el-bubble-start .el-bubble-content-filled) {
      color: rgb(86 65 51);
      background-color: rgb(var(--theme-cream-rgb), 75%) !important;
    }

    // XMarkdown容器默认color:#000会盖住气泡继承色，需单独覆盖
    :deep(.el-bubble.el-bubble-start .elx-xmarkdown-container) {
      color: rgb(86 65 51);
    }

    // 用户气泡：透明度75%，文字米色
    .user-bubble {
      color: var(--theme-cream);
      background: rgb(var(--theme-primary-rgb), 75%);
    }

    // 复制/编辑按钮：无背景色，白色图标
    .copy-btn {
      color: var(--theme-cream);
      background-color: transparent;

      // 悬停时仅显示淡白圆形底
      &:hover {
        background-color: rgb(255 255 255 / 20%);
      }
    }

    // 朗读按钮：透明底，主色文字（与用户气泡同色系，深色可见）
    .tts-btn {
      color: rgb(var(--theme-primary-rgb), 70%);
      background-color: transparent;
      border-color: rgb(var(--theme-primary-rgb), 40%);

      // 播放中：主色实色高亮
      &.is-playing {
        color: var(--theme-primary);
        border-color: var(--theme-primary);
      }
    }

    // 功能开关按钮（未激活）：透明背景、白色文字
    .feature-btn {
      color: var(--theme-cream);
      background: transparent;

      // 悬停：米色文字与边框
      @media (hover: hover) and (pointer: fine) {
        &:hover {
          color: var(--theme-cream);
          border-color: var(--theme-cream);
        }
      }

      // 激活态：比浅色模式更亮的棕金色，深底上更醒目
      &.is-active {
        color: #e0aa76;
        background: rgb(var(--theme-primary-rgb) / 15%);
        border-color: #e0aa76;
      }
    }

    // Sender操作按钮（清除/语音/发送）：透明背景、白色图标、半透明白色圆圈
    :deep(.el-send-button .el-button) {
      color: var(--theme-cream);
      background-color: transparent;
      border-color: rgb(var(--theme-cream-rgb), 45%);
      &:hover {
        color: var(--theme-cream);
        background-color: transparent;
        border-color: var(--theme-cream);
      }
    }

    // 禁用态（输入为空时发送按钮）：图标保持白色，仅圆圈更淡示意不可用
    :deep(.el-send-button .el-button.is-disabled) {
      color: var(--theme-cream);
      background-color: transparent;
      border-color: rgb(var(--theme-cream-rgb), 25%);
    }

    // 录音中/回复中的暂停按钮：亮棕金，与激活的功能按钮一致
    :deep(.el-send-button .loading-svg) {
      color: #e0aa76;
    }

    // 输入框文字与光标：米色，深色背景上可读
    :deep(.chat-sender .el-textarea__inner) {
      color: var(--theme-cream);
      caret-color: var(--theme-cream);
    }
  }
}
// 左上角返回按钮：固定在屏幕左上角，不参与内容布局
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
      background: #ffffff;
    }
  }
  &:active {
    transform: scale(0.94);
  }
}

// 右上角背景开关：与返回按钮同款圆形样式
.bg-toggle-btn {
  position: absolute;
  top: 14px;
  right: 12px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  color: #4e4e52;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  cursor: pointer;
  background: rgb(255 255 255 / 85%);
  border: 1px solid rgb(0 0 0 / 8%);
  border-radius: 50%;
  box-shadow: 0 2px 8px 0 rgb(0 0 0 / 8%);

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: var(--theme-primary);
      background: #ffffff;
    }
  }
  &:active {
    transform: scale(0.94);
  }

  // 开启态：主题棕色高亮
  &.is-on {
    color: var(--theme-primary);
    background: rgb(var(--theme-primary-rgb), 0.12);
    border-color: rgb(var(--theme-primary-rgb), 0.35);
  }
}

// 参数错误提示：全屏固定居中（不受父容器布局影响）
.page-error {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  // background: #ffffff;
  animation: page-error-in 0.35s ease both;

  // 圆形图标底座：柔和暖色背景，呼应页面主题
  .page-error-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    color: #d4884c;
    background: linear-gradient(160deg, #fdf3e7 0%, #f9e8d2 100%);
    border-radius: 50%;
    box-shadow: 0 10px 24px rgb(212 136 76 / 18%);
  }

  .page-error-title {
    color: #4e4e52;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 1px;
  }

  .page-error-desc {
    max-width: 260px;
    color: #a8abb2;
    font-size: 13px;
    line-height: 1.6;
  }
}

@keyframes page-error-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// 预设问题刷新图标旋转动画
@keyframes preset-refresh-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

// 顶部智能体头像与名称
.agent-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 24px 0 10px 0;
}
// 圆形头像
.agent-avatar {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border: 2px solid rgba(var(--theme-primary-rgb), 0.25);
  border-radius: 50%;
}
// 无图标时的默认头像：浅棕背景 + 对话图标
.agent-avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--theme-primary-rgb), 0.1);
  color: var(--theme-primary);
}
// 智能体名称
.agent-name {
  font-size: 15px;
  font-weight: 600;
  color: #4e4e52;
}

// 用户消息气泡：宽度自适应文字内容，并靠右对齐
.user-bubble {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  margin-left: auto;
  padding: 10px 14px;
  color: #ffffff;
  background: var(--theme-primary);
  border-radius: 12px;
}
// 预设问题气泡（无样式、start方向）：内容占满整行，保证"更多/收起"右侧对齐
:deep(.el-bubble-start.el-bubble-no-style .el-bubble-content) {
  width: 100% !important;
  max-width: 100% !important;
}
// 用户气泡内容区（组件实际类名，无双下划线）：
// 始终占满可用宽度，编辑框才能撑满；普通消息由 .user-bubble 自行收缩
:deep(.el-bubble-end .el-bubble-content) {
  width: 100% !important;
  max-width: 100% !important;
}
// 编辑状态下用户气泡：撑满内容区，清除背景和内边距
.user-bubble.editing {
  width: 100%;
  padding: 0;
  background: transparent !important;
}
// 编辑卡片容器：自适应宽度，不超出父容器
.edit-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #dcdfe6;
  border-radius: 16px;
  transition: all 0.2s ease;
}
// 编辑输入框：无边框、无背景、无阴影
.edit-input :deep(.el-textarea__inner) {
  padding: 0;
  font-size: 14px;
  resize: none;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
// 编辑操作按钮组：右对齐
.edit-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  margin-top: 12px;
}

// 复制/编辑按钮容器：悬浮在气泡右下角
.copy-button-container {
  position: absolute;
  right: 0;
  bottom: -22px;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  pointer-events: none;
  transition: all 0.3s ease;

  // 复制/编辑按钮
  .copy-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    font-size: 13px;
    color: #91949a;
    pointer-events: auto;
    cursor: pointer;
    border: none !important;

    // SVG 图标加粗描边
    :deep(svg) {
      stroke-width: 3 !important;
    }

    // 悬停时圆形背景
    &:hover {
      background-color: #f1efef;
      border-radius: 50%;
      transition: background-color 0.2s;
    }
  }

  // Element Plus 默认兄弟按钮有12px间距，改由容器gap控制
  .copy-btn + .copy-btn {
    margin-left: 0;
  }
}
// 输入框前缀区域：水平排列
.sender-prefix-container {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}
// 功能按钮组：输入框外部左上方
.feature-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 5px;
  margin-bottom: 8px;
}
// 单个功能按钮：胶囊样式，可点击切换
.feature-btn {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 5px 12px;
  font-size: 10px;
  color: #8f9095;
  user-select: none;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 999px;
  // 禁用移动端双击缩放，避免第二次点击被浏览器吞掉导致无法取消激活
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: all 0.2s ease;
  // 悬停样式仅在有真实鼠标的设备上生效，
  // 触屏设备点击后 :hover 会粘滞，导致按钮看起来无法取消激活
  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: var(--theme-primary);
      border-color: var(--theme-primary);
    }
  }
  // 选中态：主题棕色高亮
  &.is-active {
    color: var(--theme-primary);
    background: rgba(var(--theme-primary-rgb), 0.06);
    border-color: var(--theme-primary);
  }
  // 纯图标模式：去掉文字后的紧凑胶囊，高度与文字按钮一致（24px）
  &.icon-only {
    gap: 2px;
    padding: 5px 7px;
  }
}
// AI消息操作按钮行：位于Markdown内容下方
.tts-action-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
// 操作按钮：圆形图标钮（复制 / 朗读）
.tts-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: #91949a;
  user-select: none;
  cursor: pointer;
  background: transparent;
  border: 1px solid #e4e7ed;
  border-radius: 50%;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: all 0.2s ease;
  @media (hover: hover) and (pointer: fine) {
    &:hover {
      color: var(--theme-primary);
      border-color: var(--theme-primary);
    }
  }
  // 合成中 / 播放中：主题棕色高亮
  &.is-loading,
  &.is-playing {
    color: var(--theme-primary);
    background: rgba(var(--theme-primary-rgb), 0.06);
    border-color: var(--theme-primary);
  }
  // 自绘小喇叭svg：与el-icon同尺寸，颜色随按钮
  .tts-ico {
    display: block;
    width: 12px;
    height: 12px;
  }
}
// 输入框下方免责声明
.sender-footer-tip {
  margin-top: 8px;
  font-size: 10px;
  color: #a8abb2;
  text-align: center;
}
// Sender 前缀区域自适应宽度
:deep(.el-sender-prefix) {
  flex: 1;
  width: 100%;
}
// Sender 输入框聚焦时边框/阴影改为主题棕色
:deep(.el-textarea__inner:focus),
:deep(.el-textarea__inner:focus-visible),
:deep(.el-textarea__inner.is-focus) {
  border-color: var(--theme-primary) !important;
  outline: none !important;
  box-shadow: 0 0 0 1px var(--theme-primary) !important;
}
// Sender 容器聚焦状态的外层蓝色光晕也改为主题棕色
:deep(.el-sender:focus-within) {
  border-color: var(--theme-primary) !important;
  box-shadow: none !important;
}
// Sender 停止按钮改为主题棕色
:deep(.el-sender-stop-button) {
  color: var(--theme-primary) !important;
  background-color: rgba(var(--theme-primary-rgb), 0.12) !important;
  border-color: var(--theme-primary) !important;
}
// 加载时三个点改为主题棕色
:deep(.el-bubble-content-loading) {
  .dot,
  .dot-2,
  .dot-3 {
    background-color: var(--theme-primary) !important;
  }
}
// 回到底部按钮：外观克隆 vue-element-plus-x 内置按钮（白色圆形+主题棕色箭头）
.back-bottom-btn {
  position: absolute;
  bottom: 20px;
  left: calc(50% - 22px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  user-select: none;
  cursor: pointer;
  background-color: #fff;
  border: none;
  border-radius: 50%;
  box-shadow: 0 0 4px #00000005, 0 6px 10px #2f35401a;
  transition: all 0.3s ease;

  @media (hover: hover) and (pointer: fine) {
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px #00000026;
    }
  }

  .el-icon {
    color: var(--theme-primary);
  }
}
// 回到底部按钮淡入淡出
.back-bottom-fade-enter-active,
.back-bottom-fade-leave-active {
  transition: opacity 0.3s ease;
}
.back-bottom-fade-enter-from,
.back-bottom-fade-leave-to {
  opacity: 0;
}
</style>
