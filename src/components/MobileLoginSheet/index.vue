<script setup lang="ts">
import type { LoginDTO, RegisterDTO } from '@/api/auth/types';
import { Bell, Lock, Message, Unlock, User } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onUnmounted, reactive, ref, watch } from 'vue';
import { emailCode, login, register } from '@/api';
import logoPng from '@/assets/images/logo.png';
import { useUserStore } from '@/stores';

// 弹层显示状态（与 userStore.isLoginDialogVisible 双向绑定，供守卫远程唤起）
const visible = defineModel<boolean>('visible', { required: true });

const userStore = useUserStore();
const isSubmitting = ref(false);

// 登录/注册模式切换
const mode = ref<'login' | 'register'>('login');

// 登录表单
const loginForm = reactive<LoginDTO>({
  username: '',
  password: '',
  clientId: import.meta.env.VITE_CLIENT_ID,
  grantType: 'password',
  tenantId: '000000',
  uuid: 'a5705def96be468f80e4b8bde3127c31',
});

// 注册表单
const registerForm = reactive<RegisterDTO>({
  username: '',
  password: '',
  code: '',
  confirmPassword: '',
});

// 弹层打开时重置密码并回到登录模式
watch(visible, (newVal) => {
  if (newVal) {
    mode.value = 'login';
    loginForm.password = '';
  }
});

function close() {
  visible.value = false;
}

function isEmail(email: string) {
  return /^[\w.-]+@[a-z0-9.-]+\.[a-z]{2,4}$/i.test(email);
}

// ==================== 登录 ====================
async function handleLogin() {
  if (isSubmitting.value)
    return;
  if (!loginForm.username.trim()) {
    ElMessage.warning('请输入账号');
    return;
  }
  if (!loginForm.password) {
    ElMessage.warning('请输入登录密码');
    return;
  }

  try {
    isSubmitting.value = true;
    const res = await login(loginForm);
    const loginData = res?.data ?? res;
    const token = loginData?.access_token || loginData?.token;
    if (!token)
      throw new Error('登录响应中缺少访问令牌');
    userStore.setToken(token);
    userStore.resetAuthExpiredHandling();
    ElMessage.success('登录成功');
    // 关闭弹层并留在当前页面（由各页面自行监听 token 完成数据初始化）
    close();
  }
  catch (error) {
    console.error('请求错误:', error);
    ElMessage.error(error instanceof Error ? error.message : '登录失败，请稍后重试');
  }
  finally {
    isSubmitting.value = false;
  }
}

// ==================== 注册 ====================
const countdown = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function startCountdown() {
  countdown.value = 60;
  timer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

onUnmounted(() => {
  if (timer)
    clearInterval(timer);
});

// 获取邮箱验证码
async function getEmailCode() {
  if (!isEmail(registerForm.username)) {
    ElMessage.warning('请输入正确的邮箱');
    return;
  }
  if (countdown.value > 0)
    return;
  try {
    startCountdown();
    // 后端按 query 参数 email 接收，用户端把邮箱放在 username 字段输入
    await emailCode({ email: registerForm.username });
    ElMessage.success('验证码发送成功');
  }
  catch (error) {
    console.error('请求错误:', error);
    if (timer) {
      clearInterval(timer);
      timer = null;
      countdown.value = 0;
    }
  }
}

async function handleRegister() {
  if (isSubmitting.value)
    return;
  if (!isEmail(registerForm.username)) {
    ElMessage.warning('请输入正确的邮箱');
    return;
  }
  if (!registerForm.code.trim()) {
    ElMessage.warning('请输入验证码');
    return;
  }
  if (!registerForm.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  if (registerForm.password !== registerForm.confirmPassword) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }

  try {
    isSubmitting.value = true;
    // 后端 RegisterBody 继承自 LoginBody，clientId / grantType 为必填项，且需指定租户
    await register({
      ...registerForm,
      clientId: import.meta.env.VITE_CLIENT_ID,
      grantType: 'password',
      tenantId: '000000',
    });
    ElMessage.success('注册成功，请登录');
    // 切回登录模式并保留邮箱，清空密码
    loginForm.username = registerForm.username;
    registerForm.password = '';
    registerForm.confirmPassword = '';
    registerForm.code = '';
    mode.value = 'login';
  }
  catch (error) {
    console.error('请求错误:', error);
  }
  finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <!-- 手机端登录弹层：居中显示，支持登录/注册切换 -->
  <Transition name="mls">
    <div v-if="visible" class="mls-mask" @click.self="close">
      <div class="mls-dialog">
        <!-- 顶部标题栏 -->
        <div class="mls-header">
          <img :src="logoPng" class="mls-logo" alt="logo">
          <span class="mls-app">RuoYi-AI</span>
          <button class="mls-close" type="button" aria-label="关闭" @click="close">
            ✕
          </button>
        </div>

        <p class="mls-welcome">
          {{ mode === 'login' ? '欢迎回来，请登录后继续' : '创建新账号' }}
        </p>

        <!-- 登录表单 -->
        <form v-if="mode === 'login'" class="mls-form" @submit.prevent="handleLogin">
          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <User />
            </el-icon>
            <input
              v-model="loginForm.username"
              class="mls-input"
              type="text"
              placeholder="请输入账号"
              autocomplete="username"
            >
          </label>

          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <Lock />
            </el-icon>
            <input
              v-model="loginForm.password"
              class="mls-input"
              type="password"
              placeholder="请输入登录密码"
              autocomplete="current-password"
            >
          </label>

          <button class="mls-submit" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? '登录中...' : '立即登录' }}
          </button>
        </form>

        <!-- 注册表单 -->
        <form v-else class="mls-form" @submit.prevent="handleRegister">
          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <Message />
            </el-icon>
            <input
              v-model="registerForm.username"
              class="mls-input"
              type="text"
              placeholder="请输入邮箱"
              autocomplete="off"
            >
          </label>

          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <Bell />
            </el-icon>
            <input
              v-model="registerForm.code"
              class="mls-input"
              type="text"
              placeholder="请输入验证码"
              autocomplete="off"
            >
            <button
              class="mls-code-btn"
              type="button"
              :disabled="countdown > 0"
              @click="getEmailCode"
            >
              {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
            </button>
          </label>

          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <Unlock />
            </el-icon>
            <input
              v-model="registerForm.password"
              class="mls-input"
              type="password"
              placeholder="请输入密码"
              autocomplete="new-password"
            >
          </label>

          <label class="mls-field">
            <el-icon :size="18" class="mls-field-icon">
              <Lock />
            </el-icon>
            <input
              v-model="registerForm.confirmPassword"
              class="mls-input"
              type="password"
              placeholder="请确认密码"
              autocomplete="new-password"
            >
          </label>

          <button class="mls-submit" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? '注册中...' : '注册' }}
          </button>
        </form>

        <!-- 模式切换 -->
        <div class="mls-switch">
          <template v-if="mode === 'login'">
            <span>没有账号，</span>
            <span class="mls-link" @click="mode = 'register'">立即注册</span>
          </template>
          <template v-else>
            <span>已有账号，</span>
            <span class="mls-link" @click="mode = 'login'">返回登录</span>
          </template>
        </div>

        <p class="mls-tip">
          {{ mode === 'login' ? '登录即代表你同意平台服务条款，我们会妥善保护你的账号信息。' : '注册即代表你同意平台服务条款，邮箱仅用于验证身份与账号安全。' }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.mls-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgb(15 23 42 / 55%);
}

.mls-dialog {
  width: min(400px, 100%);
  max-height: calc(100vh - 32px);
  padding: 20px;
  overflow-y: auto;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 22px 56px rgb(15 23 42 / 22%);
  box-sizing: border-box;
}

.mls-header {
  display: flex;
  gap: 10px;
  align-items: center;
}

.mls-logo {
  width: 34px;
  height: 34px;
  padding: 5px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.mls-app {
  flex: 1;
  color: #111827;
  font-size: 17px;
  font-weight: 700;
}

.mls-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: #64748b;
  font-size: 15px;
  cursor: pointer;
  background: #f1f5f9;
  border: none;
  border-radius: 50%;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.mls-welcome {
  margin: 16px 0 20px;
  color: #334155;
  font-size: 15px;
  font-weight: 600;
}

.mls-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 自绘输入行：宽高可控，绝不横向溢出 */
.mls-field {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 48px;
  padding: 0 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  transition: border-color 0.2s ease;

  &:focus-within {
    border-color: #2563eb;
    background: #fff;
  }
}

.mls-field-icon {
  flex-shrink: 0;
  color: #94a3b8;
}

/* 16px字号避免iOS聚焦时页面自动放大 */
.mls-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  color: #0f172a;
  font-size: 16px;
  background: transparent;
  border: none;
  outline: none;

  &::placeholder {
    color: #94a3b8;
  }
}

/* 获取验证码按钮 */
.mls-code-btn {
  flex-shrink: 0;
  padding: 6px 0 6px 10px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  background: none;
  border: none;
  border-left: 1px solid #e2e8f0;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &:disabled {
    color: #94a3b8;
    cursor: default;
  }
}

.mls-submit {
  height: 48px;
  margin-top: 6px;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  border: none;
  border-radius: 12px;
  box-shadow: 0 8px 18px rgb(37 99 235 / 24%);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  &:disabled {
    opacity: 0.7;
  }

  &:active {
    transform: scale(0.98);
  }
}

.mls-switch {
  margin-top: 16px;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.mls-link {
  color: #2563eb;
  font-weight: 600;
  cursor: pointer;
}

.mls-tip {
  margin: 12px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

/* 过渡：遮罩淡入 + 弹窗居中缩放 */
.mls-enter-active,
.mls-leave-active {
  transition: opacity 0.22s ease;

  .mls-dialog {
    transition: transform 0.22s ease;
  }
}

.mls-enter-from,
.mls-leave-to {
  opacity: 0;

  .mls-dialog {
    transform: scale(0.94);
  }
}
</style>
