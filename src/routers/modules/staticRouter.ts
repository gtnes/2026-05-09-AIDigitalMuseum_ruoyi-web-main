import type { RouteRecordRaw } from 'vue-router';
import { HOME_URL } from '@/config';

export const layoutRouter: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: HOME_URL,
    component: () => import('@/layouts/index.vue'),
    children: [
      {
        path: HOME_URL,
        name: 'chat',
        component: () => import('@/pages/chat/index.vue'),
        meta: {
          title: '通用聊天',
          isDefaultChat: true,
          icon: 'HomeFilled',
        },
      },
      {
        path: '/chat/:id',
        name: 'chatWithId',
        component: () => import('@/pages/chat/index.vue'),
        meta: {
          title: '聊天详情',
          isDefaultChat: false,
        },
      },
      {
        path: '/app-market',
        name: 'appMarket',
        component: () => import('@/pages/app-market/index.vue'),
        meta: {
          title: '应用市场',
          icon: 'Grid',
        },
      },
    ],
  },
];

export const staticRouter: RouteRecordRaw[] = [
  {
    path: '/app-chat',
    name: 'appChat',
    component: () => import('@/pages/app-chat/index.vue'),
    meta: {
      title: 'AI对话',
      icon: 'ChatDotRound',
    },
  },
  {
    path: '/apps-chat',
    name: 'appsChat',
    component: () => import('@/pages/apps-chat/index.vue'),
    meta: {
      title: 'AI应用对话',
      icon: 'ChatLineRound',
      // 登录状态失效（401）时留在本页弹登录框，不跳转到 /chat
      stayOnAuthExpired: true,
    },
  },
  {
    path: '/museum',
    name: 'museum',
    component: () => import('@/pages/museum/index.vue'),
    meta: {
      title: 'AI数字博物馆',
      icon: 'Place',
    },
  },
];

export const errorRouter = [
  {
    path: '/403',
    name: '403',
    component: () => import('@/pages/error/403.vue'),
    meta: {
      title: '403页面',
      enName: '403 Page',
      icon: 'QuestionFilled',
      isHide: '1',
      isLink: '1',
      isKeepAlive: '0',
      isFull: '1',
      isAffix: '1',
    },
  },
  {
    path: '/404',
    name: '404',
    component: () => import('@/pages/error/404.vue'),
    meta: {
      title: '404页面',
      enName: '404 Page',
      icon: 'CircleCloseFilled',
      isHide: '1',
      isLink: '1',
      isKeepAlive: '0',
      isFull: '1',
      isAffix: '1',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/pages/error/404.vue'),
  },
];
