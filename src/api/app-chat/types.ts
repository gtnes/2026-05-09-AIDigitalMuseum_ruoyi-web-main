/**
 * 应用信息
 */
export interface AppChatApp {
  id: number;
  appName: string;
  appType: string;
  providerCode: string;
  apiHost: string;
  appDesc?: string;
  appShow?: string;
  remark?: string;
}

/**
 * 应用对话发送请求
 */
export interface AppChatSendDTO {
  appId: number;
  content: string;
  sessionId: string;
}

/**
 * SSE 事件类型
 */
export type AppChatSseType = 'text' | 'error' | 'done';

/**
 * SSE 事件数据
 */
export interface AppChatSseData {
  type: AppChatSseType;
  content?: string;
}
