import type { AppChatSendDTO } from './types';

// 公开请求（不带 JWT）
const publicRequest = {
  get: (url: string) => fetch(`${import.meta.env.VITE_API_URL}${url}`),
  post: (url: string, data: any) => fetch(`${import.meta.env.VITE_API_URL}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
};

// 获取应用列表（公开，无需登录）
export function getAppList() {
  return publicRequest.get('/system/chatapp/appList').then(r => r.json());
}

// 发送对话消息（公开，无需登录）
export function sendAppChat(data: AppChatSendDTO) {
  return publicRequest.post('/system/chatapp/chat/send', data);
}
