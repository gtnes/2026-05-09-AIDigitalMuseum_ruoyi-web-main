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

// ---------- 纯JS SHA-256/HMAC兜底实现 ----------
// 浏览器的crypto.subtle（Web Crypto）仅在安全上下文（HTTPS或localhost）可用，
// 站点以http://部署时crypto.subtle为undefined，签名会在fetch前抛错且被上层静默吞掉，
// 表现为"点击播报无请求也无报错"；此兜底保证任何环境下都能完成签名
const SHA256_K = new Uint32Array([
  0x428A2F98,
  0x71374491,
  0xB5C0FBCF,
  0xE9B5DBA5,
  0x3956C25B,
  0x59F111F1,
  0x923F82A4,
  0xAB1C5ED5,
  0xD807AA98,
  0x12835B01,
  0x243185BE,
  0x550C7DC3,
  0x72BE5D74,
  0x80DEB1FE,
  0x9BDC06A7,
  0xC19BF174,
  0xE49B69C1,
  0xEFBE4786,
  0x0FC19DC6,
  0x240CA1CC,
  0x2DE92C6F,
  0x4A7484AA,
  0x5CB0A9DC,
  0x76F988DA,
  0x983E5152,
  0xA831C66D,
  0xB00327C8,
  0xBF597FC7,
  0xC6E00BF3,
  0xD5A79147,
  0x06CA6351,
  0x14292967,
  0x27B70A85,
  0x2E1B2138,
  0x4D2C6DFC,
  0x53380D13,
  0x650A7354,
  0x766A0ABB,
  0x81C2C92E,
  0x92722C85,
  0xA2BFE8A1,
  0xA81A664B,
  0xC24B8B70,
  0xC76C51A3,
  0xD192E819,
  0xD6990624,
  0xF40E3585,
  0x106AA070,
  0x19A4C116,
  0x1E376C08,
  0x2748774C,
  0x34B0BCB5,
  0x391C0CB3,
  0x4ED8AA4A,
  0x5B9CCA4F,
  0x682E6FF3,
  0x748F82EE,
  0x78A5636F,
  0x84C87814,
  0x8CC70208,
  0x90BEFFFA,
  0xA4506CEB,
  0xBEF9A3F7,
  0xC67178F2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

// SHA-256摘要：输入UTF-8字节，输出32字节
function sha256Bytes(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const blockCount = Math.ceil((len + 9) / 64);
  const total = blockCount * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);
  dv.setUint32(total - 4, bitLen % 4294967296, false);

  const h = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]);
  const w = new Uint32Array(64);
  for (let b = 0; b < blockCount; b++) {
    for (let i = 0; i < 16; i++)
      w[i] = dv.getUint32(b * 64 + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0];
    let b2 = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b2) ^ (a & c) ^ (b2 & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b2;
      b2 = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b2) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++)
    odv.setUint32(i * 4, h[i], false);
  return out;
}

// HMAC-SHA256：输出小写hex，与后端HmacSHA256结果严格一致
function hmacSha256Hex(keyStr: string, msgStr: string): string {
  const enc = new TextEncoder();
  const msg = enc.encode(msgStr);
  let key = enc.encode(keyStr);
  if (key.length > 64)
    key = sha256Bytes(key);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  ipad.set(key);
  opad.set(key);
  for (let i = 0; i < 64; i++) {
    ipad[i] ^= 0x36;
    opad[i] ^= 0x5C;
  }
  const innerInput = new Uint8Array(64 + msg.length);
  innerInput.set(ipad);
  innerInput.set(msg, 64);
  const outerInput = new Uint8Array(64 + 32);
  outerInput.set(opad);
  outerInput.set(sha256Bytes(innerInput), 64);
  return Array.from(sha256Bytes(outerInput))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成HMAC-SHA256签名（与后端算法严格一致）：
// sign = hex(HMAC(secret, `${timestamp}\n${nonce}\n${text}`))
// 优先用Web Crypto（HTTPS/localhost安全上下文），不可用时降级纯JS实现（http部署环境）
async function signTtsPayload(text: string) {
  const timestamp = Date.now();
  const nonce = genNonce();
  const message = `${timestamp}\n${nonce}\n${text}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(TTS_SIGN_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const sign = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return { timestamp, nonce, sign };
  }
  return { timestamp, nonce, sign: hmacSha256Hex(TTS_SIGN_SECRET, message) };
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
