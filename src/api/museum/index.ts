import type { MuseumInfo, MuseumVideo } from './types';

// 公开请求（不带 JWT），与 app-chat 模块保持一致
const publicRequest = {
  get: (url: string) => fetch(`${import.meta.env.VITE_API_URL}${url}`),
};

/** 清理URL（去除录入时可能误存的反引号/引号） */
export function cleanUrl(url: string) {
  return (url || '').replace(/^[`'"]+|[`'"]+$/g, '').trim();
}

/** 清洗博物馆数据中的URL字段 */
function cleanMuseumInfo(info: MuseumInfo): MuseumInfo {
  info.logoUrl = cleanUrl(info.logoUrl);
  info.bannerUrl = cleanUrl(info.bannerUrl);
  info.vrUrl = cleanUrl(info.vrUrl);
  (info.chatapps || []).forEach((app) => {
    app.bgUrl = cleanUrl(app.bgUrl);
    app.idleImgUrl = cleanUrl(app.idleImgUrl);
    app.talkingGifUrl = cleanUrl(app.talkingGifUrl);
    app.appShow = cleanUrl(app.appShow);
  });
  return info;
}

/**
 * 获取AI博物馆前台展示信息（公开，无需登录）
 * 后端会检查服务是否到期：isExpire=1 时前端显示 expireTips
 */
export async function getMuseumInfo(id: string | number) {
  const res = await publicRequest.get(`/system/aimuseum/front/${id}`).then(r => r.json());
  if (res.code === 200 && res.data)
    res.data = cleanMuseumInfo(res.data);
  return res;
}

/**
 * 获取指定AI视频分类下的视频列表（公开，无需登录，仅启用中的视频）
 */
export function getMuseumVideos(categoryId: string | number): Promise<{ code: number; data: MuseumVideo[] }> {
  return publicRequest.get(`/video/video/front/list/${categoryId}`).then(r => r.json());
}

/**
 * 获取视频详情（公开，无需登录，播放页使用）
 */
export function getVideoInfo(id: string | number): Promise<{ code: number; data: MuseumVideo | null }> {
  return publicRequest.get(`/video/video/front/${id}`).then(r => r.json());
}
