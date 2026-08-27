<script setup lang="ts">
import type { AppChatApp } from '@/api/app-chat/types';
import { ElMessage } from 'element-plus';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getAppList, sendAppChat } from '@/api/app-chat';

const route = useRoute();

// 应用列表
const appList = ref<AppChatApp[]>([]);
const currentApp = ref<AppChatApp | null>(null);

// 对话相关
const messages = ref<{ role: 'user' | 'assistant'; content: string }[]>([]);
const inputMessage = ref('');
const loading = ref(false);
const sessionId = ref('');
const messagesRef = ref<HTMLDivElement>();

// SSE
let eventSource: EventSource | null = null;

// 初始化
onMounted(async () => {
  // 生成会话ID
  sessionId.value = `app-chat-${Date.now()}`;

  // 获取URL参数中的appId
  const urlAppId = route.query.appId as string;

  if (urlAppId) {
    // URL有appId，直接获取应用详情（这里简化处理，实际可能需要单独接口）
    // 先获取列表，然后找到对应的应用
    const res = await getAppList();
    appList.value = res.data || [];
    const app = appList.value.find(a => String(a.id) === String(urlAppId));
    if (app) {
      currentApp.value = app;
    }
    else {
      ElMessage.error('应用不存在');
    }
  }
  else {
    // URL没有appId，获取应用列表让用户选择
    const res = await getAppList();
    appList.value = res.data || [];
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
  eventSource.addEventListener('content', (event) => {
    try {
      const data = JSON.parse(event.data);
      const content = data.content || '';
      if (content) {
        // 后端推送的是完整文本，直接替换而不是累加
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = content;
        }
        scrollToBottom();
      }
    }
    catch (e) {
      console.error('SSE content 事件解析错误:', e);
    }
  });

  // 监听错误事件（后端 event 名称为 "error"）
  eventSource.addEventListener('error', (event) => {
    try {
      const data = JSON.parse(event.data);
      const errorMsg = data.error || '对话出错';
      ElMessage.error(errorMsg);
      loading.value = false;
    }
    catch (e) {
      console.error('SSE error 事件解析错误:', e);
    }
  });

  // 监听完成事件（后端 event 名称为 "done"）
  eventSource.addEventListener('done', (_event) => {
    loading.value = false;
  });

  // 默认消息处理（兜底）
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // 如果收到默认消息，尝试解析内容
      if (data.content) {
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = data.content;
        }
        scrollToBottom();
      }
    }
    catch (e) {
      console.error('SSE默认消息解析错误:', e);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE连接错误:', error);
    loading.value = false;
  };
}

// 关闭SSE
function closeSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// 发送消息
async function sendMessage() {
  if (!inputMessage.value.trim())
    return;
  if (!currentApp.value) {
    ElMessage.warning('请先选择应用');
    return;
  }
  if (loading.value)
    return;

  const message = inputMessage.value.trim();
  inputMessage.value = '';

  // 添加用户消息
  messages.value.push({ role: 'user', content: message });
  // 添加空的助手消息（等待SSE填充）
  messages.value.push({ role: 'assistant', content: '' });

  loading.value = true;
  scrollToBottom();

  try {
    await sendAppChat({
      appId: currentApp.value.id,
      content: message,
      sessionId: sessionId.value,
    });
  }
  catch (error) {
    console.error('发送失败:', error);
    loading.value = false;
    ElMessage.error('发送失败');
  }
}

// 选择应用
function selectApp(app: AppChatApp) {
  currentApp.value = app;
  // 清空对话
  messages.value = [];
  // 重新生成sessionId
  sessionId.value = `app-chat-${Date.now()}`;
  // 重建SSE连接
  closeSSE();
  connectSSE();
}

// 滚动到底部
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
  });
}

// 回车发送
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}
</script>

<template>
  <div class="app-chat-page">
    <!-- 应用选择器（URL没有appId时显示） -->
    <div v-if="!route.query.appId" class="app-selector">
      <el-select
        v-model="currentApp"
        value-key="id"
        placeholder="选择应用"
        @change="selectApp"
      >
        <el-option
          v-for="app in appList"
          :key="app.id"
          :label="app.appName"
          :value="app"
        />
      </el-select>
    </div>

    <!-- 当前应用信息 -->
    <div v-if="currentApp" class="app-info">
      <h3>{{ currentApp.appName }}</h3>
      <p v-if="currentApp.appDesc">
        {{ currentApp.appDesc }}
      </p>
    </div>

    <!-- 对话区域 -->
    <div ref="messagesRef" class="messages">
      <div
        v-for="(msg, index) in messages"
        :key="index"
        class="message" :class="[msg.role]"
      >
        <div class="avatar">
          {{ msg.role === 'user' ? '👤' : '🤖' }}
        </div>
        <div class="content">
          <template v-if="msg.role === 'assistant' && !msg.content && loading && index === messages.length - 1">
            <el-icon class="is-loading">
              <Loading />
            </el-icon>
          </template>
          <template v-else>
            {{ msg.content }}
          </template>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="input-area">
      <el-input
        v-model="inputMessage"
        type="textarea"
        :rows="3"
        placeholder="输入消息..."
        :disabled="loading || !currentApp"
        @keydown="handleKeydown"
      />
      <el-button
        type="primary"
        :loading="loading"
        :disabled="!inputMessage.trim() || !currentApp"
        @click="sendMessage"
      >
        发送
      </el-button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 20px;
  box-sizing: border-box;

  .app-selector {
    margin-bottom: 16px;

    .el-select {
      width: 300px;
    }
  }

  .app-info {
    margin-bottom: 16px;
    padding: 12px;
    background: #f5f7fa;
    border-radius: 8px;

    h3 {
      margin: 0 0 8px;
      font-size: 18px;
    }

    p {
      margin: 0;
      color: #666;
      font-size: 14px;
    }
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #fff;
    border-radius: 8px;
    margin-bottom: 16px;

    .message {
      display: flex;
      margin-bottom: 16px;
      gap: 12px;

      .avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: #e3f2fd;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }

      .content {
        flex: 1;
        padding: 12px;
        border-radius: 8px;
        line-height: 1.6;
        white-space: pre-wrap;
      }

      &.user {
        flex-direction: row-reverse;

        .content {
          background: #e3f2fd;
        }
      }

      &.assistant {
        .content {
          background: #f5f5f5;
        }
      }
    }
  }

  .input-area {
    display: flex;
    gap: 12px;

    .el-input {
      flex: 1;
    }

    .el-button {
      align-self: flex-end;
    }
  }
}
</style>
