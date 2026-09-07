export interface MuseumChatApp {
  /** chatapp中的id（即appId，与chat_app.id对应） */
  id: number | string;
  /** 应用名称 */
  appName: string;
  /** 应用描述（来自chat_app.appDescribe，H5展示名称） */
  appDescribe: string;
  /** 应用图标 URL（来自chat_app.appShow） */
  appShow: string;
  /** 背景图片 URL */
  bgUrl: string;
  /** AI形象待机图片 URL（静态图或gif） */
  idleImgUrl: string;
  /** AI形象说话时的gif URL */
  talkingGifUrl: string;
  /** 说明 */
  description: string;
  /** 职责名称（如"AI馆员"，用于通话按钮文案"与{duty}通话"） */
  duty: string;
  /** 展示排序 */
  sort: number;
}

export interface MuseumInfo {
  /** 主键 */
  id: number | string;
  /** 展示标题 */
  title: string;
  /** Logo URL */
  logoUrl: string;
  /** banner背景图 URL */
  bannerUrl: string;
  /** 是否已过期：0未过期，1已过期 */
  isExpire: 0 | 1;
  /** 过期提示文案 */
  expireTips: string;
  /** 是否开启VR（0关闭 1开启） */
  vrEnable: 0 | 1;
  /** VR地址 */
  vrUrl: string;
  /** 智能体配置列表 */
  chatapps: MuseumChatApp[];
}

export interface MuseumVideo {
  /** 视频id */
  id: number | string;
  /** 视频名称 */
  name: string;
  /** 视频封面 URL */
  coverUrl: string;
  /** 视频地址 URL */
  videoUrl: string;
}
