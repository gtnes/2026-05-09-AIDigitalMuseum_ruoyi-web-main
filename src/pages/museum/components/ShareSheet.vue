<script setup lang="ts">
import { Link } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const props = defineProps<{
  /** 自定义分享链接（如视频播放页）；不传则分享当前页面地址 */
  url?: string;
}>();

// 抽屉显示状态（v-model）
const visible = defineModel<boolean>({ required: true });

// 微信内无法用 JS 直接调起分享，只能引导用户走右上角菜单；普通浏览器则复制链接后提示
const isInWeChat = /MicroMessenger/i.test(navigator.userAgent);

async function copyLink(): Promise<boolean> {
  const url = props.url || window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  }
  catch {
    // clipboard API 不可用时降级为 execCommand
    try {
      const input = document.createElement('textarea');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      return true;
    }
    catch {
      return false;
    }
  }
}

function close() {
  visible.value = false;
}

async function onCopyLink() {
  const ok = await copyLink();
  close();
  ok ? ElMessage.success('链接已复制') : ElMessage.error('复制失败');
}

async function onWechat() {
  close();
  if (isInWeChat) {
    ElMessageBox.alert('点击右上角"···"，选择"发送给朋友"', '分享给微信好友', { confirmButtonText: '我知道了' });
  }
  else if (await copyLink()) {
    ElMessage.success('链接已复制，请在微信中粘贴发送给好友');
  }
  else {
    ElMessage.error('复制失败');
  }
}

async function onMoments() {
  close();
  if (isInWeChat) {
    ElMessageBox.alert('点击右上角"···"，选择"分享到朋友圈"', '分享到朋友圈', { confirmButtonText: '我知道了' });
  }
  else if (await copyLink()) {
    ElMessage.success('链接已复制，请在微信中粘贴分享到朋友圈');
  }
  else {
    ElMessage.error('复制失败');
  }
}
</script>

<template>
  <!-- 分享抽屉：底部弹出 -->
  <Transition name="share">
    <div v-if="visible" class="share-mask" @click.self="close">
      <div class="share-sheet">
        <div class="share-title">
          分享到
        </div>
        <div class="share-options">
          <button class="share-option" @click="onCopyLink">
            <span class="share-icon copy">
              <el-icon :size="22">
                <Link />
              </el-icon>
            </span>
            <span>复制链接</span>
          </button>
          <button class="share-option" @click="onWechat">
            <span class="share-icon wechat">
              <!-- 微信双气泡 logo -->
              <svg viewBox="0 0 36 36" width="30" height="30">
                <ellipse cx="14.5" cy="13.5" rx="10.5" ry="9" fill="#fff" />
                <path d="M9.5 20.5 L6.5 25.5 L13.5 21.8 Z" fill="#fff" />
                <circle cx="10.8" cy="12" r="1.4" fill="#0ac569" />
                <circle cx="18.2" cy="12" r="1.4" fill="#0ac569" />
                <ellipse cx="24.5" cy="21.5" rx="8.5" ry="7" fill="#fff" />
                <path d="M28.5 27.5 L31 31.5 L24.8 28.4 Z" fill="#fff" />
                <circle cx="21.8" cy="20.5" r="1.2" fill="#0ac569" />
                <circle cx="27.4" cy="20.5" r="1.2" fill="#0ac569" />
              </svg>
            </span>
            <span>微信</span>
          </button>
          <button class="share-option" @click="onMoments">
            <span class="share-icon moments">
              <!-- 朋友圈光圈 logo -->
              <svg viewBox="0 0 36 36" width="30" height="30">
                <circle
                  cx="18"
                  cy="18"
                  r="12.5"
                  fill="none"
                  stroke="#fff"
                  stroke-width="5.5"
                  stroke-dasharray="58 20.5"
                  transform="rotate(40 18 18)"
                />
                <circle cx="18" cy="18" r="5.2" fill="#fff" />
              </svg>
            </span>
            <span>朋友圈</span>
          </button>
        </div>
        <button class="share-cancel" @click="close">
          取消
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.share-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(0 0 0 / 45%);
}

.share-sheet {
  width: 100%;
  padding-top: 22px;
  text-align: center;
  background: #fff;
  border-radius: 16px 16px 0 0;
}

.share-title {
  margin-bottom: 26px;
  color: #333;
  font-size: 15px;
}

.share-options {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0 15%;
  margin-bottom: 26px;
}

.share-option {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  padding: 0;
  color: #333;
  font-size: 13px;
  background: none;
  border: none;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;

  .share-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 54px;
    height: 54px;
    border-radius: 50%;

    &.copy {
      background: #f2f2f2;
      color: #555;
    }

    /* 微信品牌绿 */
    &.wechat {
      background: #0ac569;
    }

    /* 朋友圈浅绿 */
    &.moments {
      background: #78c438;
    }
  }
}

.share-cancel {
  width: 100%;
  padding: 16px;
  color: #333;
  font-size: 16px;
  background: #fff;
  border: none;
  border-top: 8px solid #f5f5f5;
  border-radius: 0;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

/* 抽屉过渡：遮罩淡入 + 面板上滑 */
.share-enter-active,
.share-leave-active {
  transition: opacity 0.25s ease;

  .share-sheet {
    transition: transform 0.25s ease;
  }
}

.share-enter-from,
.share-leave-to {
  opacity: 0;

  .share-sheet {
    transform: translateY(100%);
  }
}
</style>
