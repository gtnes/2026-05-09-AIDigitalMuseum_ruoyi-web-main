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
 * 获取AI博物馆视频列表（公开，无需登录）
 * TODO: 视频列表接口待后端提供后接入
 */
export function getMuseumVideos(_id: string | number): Promise<{ code: number; data: MuseumVideo[] }> {
  return Promise.resolve({ code: 200, data: [] });
}
