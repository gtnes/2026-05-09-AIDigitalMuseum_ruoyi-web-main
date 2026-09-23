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
  /** AI语音音色档案id（voice_profile.id，空=该智能体不播报语音） */
  voiceProfileId?: number | string | null;
  /** 语音开关（管理端配置，false时C端不显示播报按钮、不调用语音合成接口） */
  voiceEnabled?: boolean | null;
  /** 语音自动播报（管理端配置，C端自动播报的初始状态） */
  voiceAutoPlay?: boolean | null;
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
  /** 是否开启AI视频（0关闭 1开启） */
  videoEnable: 0 | 1;
  /** AI视频分类id（ai_video_category.id，管理端配置） */
  videoCategoryId?: number | string | null;
  /** AI视频讲解员（chat_app.id，管理端配置） */
  videoChatappId?: number | string | null;
  /** 智能体配置列表 */
  chatapps: MuseumChatApp[];
}

export interface MuseumVideo {
  /** 视频id */
  id: number | string;
  /** 视频名称 */
  title: string;
  /** 视频封面 URL */
  coverUrl: string;
  /** 视频地址 URL */
  videoUrl: string;
  /** 展示类别（宣传片/文物/历史等） */
  showCategory?: string;
  /** 视频介绍 */
  description?: string;
  /** 预设问题列表（播放页"你可以试着问我"模块） */
  presetQuestions?: string[];
  /** 视频时长（秒） */
  duration?: number;
  /** 显示顺序 */
  sort?: number;
  /** 是否置顶（0否 1是），置顶视频列表优先返回 */
  topFlag?: number;
}
