<script setup lang="ts">
import type { BubbleProps } from 'vue-element-plus-x/types/Bubble';
import type { BubbleListInstance } from 'vue-element-plus-x/types/BubbleList';
import type { AppChatApp } from '@/api/app-chat/types';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Sender } from 'vue-element-plus-x';
import { useRoute } from 'vue-router';
import { getAppList, sendAppChat } from '@/api/app-chat';
import { codeXRender } from '@/utils/markdownRenderers';

const route = useRoute();

type MessageItem = BubbleProps & {
  key: number;
  role: 'user' | 'system';
  class?: string;
};

// 应用列表
const appList = ref<AppChatApp[]>([]);
const currentApp = ref<AppChatApp | null>(null);

// 对话相关
const bubbleItems = ref<MessageItem[]>([]);
const bubbleListRef = ref<BubbleListInstance | null>(null);
const inputValue = ref('');
const loading = ref(false);
const sessionId = ref('');
const senderRef = ref<InstanceType<typeof Sender> | null>(null);
const popoverRef = ref<any>(null);

const urlAppId = computed(() => route.query.appId as string);

// 复制 / 编辑
const copyIconMap = ref<Record<number, string>>({});
const editingMessageKeys = ref<number[]>([]);
const editedContents = ref<Record<number, string>>({});

// SSE
let eventSource: EventSource | null = null;

const popoverStyle = ref({
  width: '200px',
  padding: '4px',
  height: 'fit-content',
  background: 'var(--el-bg-color, #fff)',
  border: '1px solid var(--el-border-color-light)',
  borderRadius: '8px',
  boxShadow: '0 2px 12px 0 rgba(0, 0, 0, 0.1)',
});

// 初始化
onMounted(async () => {
  // 生成会话ID
  sessionId.value = `app-chat-${Date.now()}`;

  // 获取应用列表
  const res = await getAppList();
  appList.value = res.data || [];

  // 获取URL参数中的appId
  if (urlAppId.value) {
    const app = appList.value.find(a => String(a.id) === String(urlAppId.value));
    if (app) {
      currentApp.value = app;
    }
    else {
      ElMessage.error('应用不存在');
    }
  }
  else {
    if (appList.value.length > 0) {
      currentApp.value = appList.value[0];
    }
  }

  // 建立SSE连接
  connectSSE();
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

// 选择应用
function selectApp(app: AppChatApp) {
  currentApp.value = app;
  // 清空对话
  bubbleItems.value = [];
  // 重新生成sessionId
  sessionId.value = `app-chat-${Date.now()}`;
  // 重建SSE连接
  closeSSE();
  connectSSE();
  popoverRef.value?.hide?.();
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
    <div class="chat-warp">
      <BubbleList ref="bubbleListRef" :list="bubbleItems" max-height="calc(100vh - 220px)">
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
            <div class="sender-prefix-container">
              <!-- URL 无 appId 时显示应用切换 -->
              <Popover
                v-if="!urlAppId"
                ref="popoverRef"
                placement="top-start"
                :offset="[4, 0]"
                popover-class="popover-content"
                :popover-style="popoverStyle"
                trigger="clickTarget"
              >
                <template #trigger>
                  <div
                    class="app-select-box select-none flex items-center gap-4px p-10px rounded-10px cursor-pointer font-size-12px"
                  >
                    <SvgIcon name="models" size="12" />
                    <div class="app-select-box-text font-size-12px" :title="currentApp?.appName">
                      {{ currentApp?.appName || '选择应用' }}
                    </div>
                  </div>
                </template>

                <div class="popover-content-box">
                  <div
                    v-for="app in appList"
                    :key="app.id"
                    class="popover-content-box-items w-full rounded-8px select-none transition-all transition-duration-300 flex items-center hover:cursor-pointer hover:bg-[rgba(0,0,0,.04)]"
                  >
                    <div
                      class="popover-content-box-item p-4px font-size-12px text-overflow line-height-16px"
                      :class="{ 'is-select': currentApp?.id === app.id }"
                      @click="selectApp(app)"
                    >
                      <div>{{ app.appName }}</div>
                      <div v-if="app.appDesc" class="app-sub font-size-11px opacity-60">
                        {{ app.appDesc }}
                      </div>
                    </div>
                  </div>
                </div>
              </Popover>

              <!-- URL 有 appId 时仅展示当前应用 -->
              <div
                v-else
                class="app-select-box readonly select-none flex items-center gap-4px p-10px rounded-10px font-size-12px"
              >
                <SvgIcon name="models" size="12" />
                <div class="app-select-box-text font-size-12px">
                  {{ currentApp?.appName || '应用对话' }}
                </div>
              </div>
            </div>
          </template>
        </Sender>
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
    justify-content: space-between;
    box-sizing: border-box;
    width: 100%;
    max-width: 800px;
    min-height: 100vh;
    padding: 0 10px 10px;
    // 输入框容器
    .sender-wrapper {
      position: relative;
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
// 应用选择按钮
.app-select-box {
  font-weight: 600;
  color: var(--theme-primary);
  background: rgba(var(--theme-primary-rgb), 0.12);
  border: 1px solid var(--theme-primary);
  transition: all 0.2s ease;
  // 可点击状态悬停效果
  &:not(.readonly):hover {
    background-color: rgba(var(--theme-primary-rgb), 0.2);
    border-color: #8a6243;
  }
  // 只读状态（固定应用）
  &.readonly {
    cursor: default;
    opacity: 0.85;
  }
}
// 应用选择框文字：最多显示 5 个字符
.app-select-box-text {
  max-width: 5em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// 弹出列表中选中项高亮
.popover-content-box-item.is-select {
  font-weight: 700;
  color: var(--theme-primary);
}
// 应用选择弹出列表
.popover-content-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow: hidden auto;
  // 自定义滚动条样式
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: #f5f5f5;
  }
  &::-webkit-scrollbar-thumb {
    background: #cccccc;
    border-radius: 4px;
  }
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
