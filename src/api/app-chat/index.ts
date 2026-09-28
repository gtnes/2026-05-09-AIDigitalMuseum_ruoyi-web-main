import type { AppChatApp, AppChatSendDTO, MuseumChatSendDTO, VoiceProfileItem } from './types';
import { useUserStore } from '@/stores';
import { get, post } from '@/utils/request';

// 公开请求（不带 JWT）
const publicRequest = {
  get: (url: string) => fetch(`${import.meta.env.VITE_API_URL}${url}`),
  post: (url: string, data: any, signal?: AbortSignal) => fetch(`${import.meta.env.VITE_API_URL}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  }),
};

// 获取应用列表（需登录，自动携带token）
export function getAppList() {
  return get<AppChatApp[]>('/system/chatapp/appList').json();
}

// 按ID获取应用信息（公开，无需登录）
export function getAppInfo(appId: string | number) {
  return publicRequest.get(`/system/chatapp/appInfo/${appId}`).then(r => r.json());
}

// 发送对话消息（需登录，自动携带token）
export function sendAppChat(data: AppChatSendDTO) {
  return post('/system/chatapp/chat/send', data).json();
}

// 博物馆C端发送对话消息（公开接口，需museumId；后端校验服务到期与智能体绑定）
// 走公开fetch（无全局错误弹框）：失败时返回{code,msg}由页面静默处理
export function sendMuseumChat(data: MuseumChatSendDTO) {
  return publicRequest.post('/system/chatapp/chat/museumSend', data).then(r => r.json());
}

// TTS接口签名密钥（防脚本直刷的门槛性校验，非安全级密钥；须与后端 tts.sign-secret 配置一致）
const TTS_SIGN_SECRET = 'tts_9f3b7c2a4e8d1f6b0a5c3e7d9f2b4a6c';

// 生成随机nonce（优先用原生randomUUID，老浏览器降级）
function genNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// 生成HMAC-SHA256签名（与后端算法严格一致）：
// sign = hex(HMAC(secret, `${timestamp}\n${nonce}\n${text}`))
async function signTtsPayload(text: string) {
  const timestamp = Date.now();
  const nonce = genNonce();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TTS_SIGN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}\n${nonce}\n${text}`));
  const sign = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return { timestamp, nonce, sign };
}

// 语音合成（需登录，手动携带JWT走原生fetch）：按音色档案合成（voiceId来自博物馆智能体配置），返回dataUrl可直接播放
// 请求自动附带HMAC签名+时间戳+随机串（后端TtsRequestGuard校验）。
// 不走全局hook-fetch：其插件链在非200时会把reject包装成空对象resolve（body丢失），页面无法识别日配额超限熔断；
// 原生fetch原样返回{code,msg,data}（与博物馆语音接口语义一致），超限提示由页面统一处理，也避免全局ElMessage重复弹窗
export async function synthesizeTts(data: { voiceId: number | string; text: string }) {
  const payload = await signTtsPayload(data.text);
  const userStore = useUserStore();
  const res = await fetch(`${import.meta.env.VITE_API_URL}/voice/tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${userStore.token}`,
      'ClientID': import.meta.env.VITE_CLIENT_ID,
    },
    body: JSON.stringify({ ...data, ...payload }),
  });
  return res.json();
}

// 博物馆C端语音合成（公开接口，需museumId；后端校验服务到期与音色绑定，保留HMAC签名防直刷）
// 走公开fetch（无全局错误弹框）：失败时返回{code,msg}，页面按"该段合成失败"静默跳过
// signal：用户关闭语音/停止朗读时中止飞行中的请求，避免浪费
export async function synthesizeMuseumTts(data: { museumId: number | string; voiceId: number | string; text: string }, signal?: AbortSignal) {
  const payload = await signTtsPayload(data.text);
  return publicRequest.post('/voice/tts/museum', { ...data, ...payload }, signal).then(r => r.json());
}

// 获取启用中的音色档案列表（需登录，apps-chat测试页音色选择用）
export function getVoiceList() {
  return get<VoiceProfileItem[]>('/voice/tts/voices').json();
}
