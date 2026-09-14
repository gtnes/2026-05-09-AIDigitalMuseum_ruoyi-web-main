<script setup lang="ts">
import type { BubbleProps } from 'vue-element-plus-x/types/Bubble';
import type { BubbleListInstance } from 'vue-element-plus-x/types/BubbleList';
import type { AppChatApp } from '@/api/app-chat/types';
import { ArrowLeft, ChatDotRound } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Sender } from 'vue-element-plus-x';
import { useRoute, useRouter } from 'vue-router';
import { getAppInfo, sendAppChat } from '@/api/app-chat';
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
  role: 'user' | 'system';
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

const urlAppId = computed(() => route.query.appId as string);

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

// 复制 / 编辑
const copyIconMap = ref<Record<number, string>>({});
const editingMessageKeys = ref<number[]>([]);
const editedContents = ref<Record<number, string>>({});

// 头像加载失败时清空 appShow，回退到默认图标
const avatarErrorKeys = ref<Set<number>>(new Set());
function onAvatarError() {
  if (currentApp.value)
    avatarErrorKeys.value.add(currentApp.value.id);
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
      currentApp.value = res.data;
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

onMounted(() => {
  init();
});

onUnmounted(() => {
  closeSSE();
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

  // 监听完成事件（后端 event 名称为 "done"）
  eventSource.addEventListener('done', (_event) => {
    finishLastAssistantMessage();
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

// 添加消息
function addMessage(message: string, isUser: boolean) {
  const key = bubbleItems.value.length;
  const obj: MessageItem = {
    key,
    avatar: isUser
      ? 'https://avatars.githubusercontent.com/u/32251822?s=96&v=4'
      : 'https://cube.elemecdn.com/0/88/03b0d39583f48206768a7534e55bcpng.png',
    avatarSize: '32px',
    role: isUser ? 'user' : 'system',
    placement: isUser ? 'end' : 'start',
    isMarkdown: !isUser,
    loading: !isUser,
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
  <div class="app-chat-page">
    <!-- 左上角返回按钮 -->
    <button class="back-btn" aria-label="返回" @click="goBack">
      <el-icon :size="20">
        <ArrowLeft />
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

      <BubbleList
        ref="bubbleListRef"
        class="chat-bubble-list"
        :list="bubbleItems"
        max-height="100%"
      >
        <template #content="{ item }">
          <XMarkdown
            v-if="item.content && item.role === 'system'"
            :markdown="item.content"
            :code-x-render="codeXRender"
            class="markdown-body"
            :themes="{ light: 'github-light', dark: 'github-dark' }"
            default-theme-mode="dark"
          />
          <div v-if="item.content && item.role === 'user'" class="userContent">
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
  // 聊天内容区域：上下布局，输入框固定在底部
  .chat-warp {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 100%;
    max-width: 800px;
    height: 100vh;
    padding: 0 10px 10px;
    // 消息列表：占据剩余空间并内部滚动，避免把输入框挤出屏幕
    .chat-bubble-list {
      flex: 1;
      min-height: 0;
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
  right: -10px;
  bottom: -28px;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
  transform: translateY(10px);
  transition: all 0.3s ease;
  // 复制/编辑按钮
  .copy-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 16px;
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
// BubbleList 滚动到底部按钮图标改为主题棕色
:deep(.el-bubble-list-default-back-button .el-bubble-list-back-to-bottom-icon) {
  color: var(--theme-primary) !important;
}
</style>
