import type { AppChatApp, AppChatSendDTO } from './types';
import { get } from '@/utils/request';

// 公开请求（不带 JWT）
const publicRequest = {
  get: (url: string) => fetch(`${import.meta.env.VITE_API_URL}${url}`),
  post: (url: string, data: any) => fetch(`${import.meta.env.VITE_API_URL}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
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

// 发送对话消息（公开，无需登录）
export function sendAppChat(data: AppChatSendDTO) {
  return publicRequest.post('/system/chatapp/chat/send', data);
}

// 语音合成（公开，无需登录）：按音色档案合成（voiceId来自博物馆智能体配置），返回dataUrl可直接播放
export function synthesizeTts(data: { voiceId: number | string; text: string }) {
  return publicRequest.post('/voice/tts', data).then(r => r.json());
}
