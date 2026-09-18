/**
 * 应用信息
 */
export interface AppChatApp {
  id: number;
  appName: string;
  appType: string;
  providerCode: string;
  appDescribe?: string;
  appShow?: string;
  welcomeMsg?: string;
  presetQuestions?: string[];
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
 * 博物馆C端对话发送请求（公开接口，后端校验服务到期与智能体绑定）
 */
export interface MuseumChatSendDTO extends AppChatSendDTO {
  museumId: number | string;
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

/**
 * 语音合成结果
 */
export interface AppChatTtsResult {
  format: string;
  mimeType: string;
  b64Json: string;
  dataUrl: string;
  textLength: number;
}

/**
 * AI语音音色档案（启用中）
 */
export interface VoiceProfileItem {
  id: number | string;
  /** 音色名称（如 西西） */
  voiceName: string;
  /** 平台名称（如 阿里云） */
  platformName?: string;
  /** 平台音色显示名（如 龙婉） */
  platformVoiceName?: string;
}
