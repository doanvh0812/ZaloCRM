<template>
  <div class="message-thread d-flex flex-column flex-grow-1" style="height: 100%;">
    <!-- Empty state -->
    <div v-if="!conversation" class="d-flex align-center justify-center flex-grow-1" style="background: #F8F9FA;">
      <div class="text-center">
        <v-icon icon="mdi-chat-outline" size="80" color="grey-lighten-2" />
        <p class="text-h6 mt-4" style="color: #9CA3AF;">Chọn cuộc trò chuyện</p>
      </div>
    </div>

    <template v-else>
      <!-- Header — Figma style: avatar, name, online status, action icons -->
      <div class="msg-header pa-3 d-flex align-center">
        <v-avatar size="40" color="grey-lighten-3" class="mr-3">
          <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" color="grey" />
          <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
          <v-icon v-else icon="mdi-account" color="grey" />
        </v-avatar>
        <div class="flex-grow-1">
          <div class="font-weight-bold" style="font-size: 0.95rem; color: var(--text-primary, #1A1A2E);">
            {{ conversation.contact?.fullName || 'Unknown' }}
          </div>
          <div class="d-flex align-center" style="gap: 6px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #66BB6A; display: inline-block;"></span>
            <span class="text-caption" style="color: #66BB6A; font-weight: 500;">Online</span>
          </div>
        </div>
        <!-- Action icons — Figma style -->
        <v-btn icon variant="text" size="small" color="grey">
          <v-icon size="20">mdi-video-outline</v-icon>
        </v-btn>
        <v-btn
          icon variant="text" size="small"
          :color="showContactPanel ? 'primary' : 'grey'"
          @click="$emit('toggle-contact-panel')"
        >
          <v-icon size="20">mdi-information-outline</v-icon>
        </v-btn>
      </div>

      <!-- Messages area -->
      <div ref="messagesContainer" class="flex-grow-1 overflow-y-auto pa-4 chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

        <div v-for="msg in messages" :key="msg.id" class="mb-3 d-flex" :class="msg.senderType === 'self' ? 'justify-end' : 'justify-start'">
          <div style="max-width: 65%;">
            <!-- Sender name for groups -->
            <div v-if="conversation.threadType === 'group' && msg.senderType !== 'self'" class="text-caption mb-1" style="color: #2196F3; font-weight: 500;">
              {{ msg.senderName || 'Unknown' }}
            </div>

            <div class="message-bubble pa-3 px-4" :class="msg.senderType === 'self' ? 'bg-primary text-white' : ''">
              <!-- Deleted -->
              <div v-if="msg.isDeleted" class="text-decoration-line-through font-italic" style="opacity: 0.6;">
                {{ msg.content || '(tin nhắn)' }}<span class="text-caption"> (đã thu hồi)</span>
              </div>
              <!-- Image -->
              <div v-else-if="getImageUrl(msg)">
                <img :src="getImageUrl(msg)!" alt="Hình ảnh" class="chat-image" @click="previewImageUrl = getImageUrl(msg)!" />
              </div>
              <!-- File/PDF -->
              <div v-else-if="getFileInfo(msg)" class="file-card">
                <v-icon size="20" class="mr-2" color="primary">mdi-file-document-outline</v-icon>
                <div class="flex-grow-1">
                  <div class="text-body-2 font-weight-medium">{{ getFileInfo(msg)!.name }}</div>
                  <div class="text-caption" style="opacity: 0.6;">{{ getFileInfo(msg)!.size }}</div>
                </div>
                <v-btn v-if="getFileInfo(msg)!.href" icon size="x-small" variant="text" @click="openFile(getFileInfo(msg)!.href)">
                  <v-icon size="16">mdi-download</v-icon>
                </v-btn>
              </div>
              <!-- Sticker/Video/Voice/GIF -->
              <div v-else-if="getStickerUrl(msg)">
                <img :src="getStickerUrl(msg)!" alt="Sticker" class="chat-sticker" />
              </div>
              <div v-else-if="msg.contentType === 'sticker'">🏷️ Sticker</div>
              <div v-else-if="msg.contentType === 'video'">🎥 Video</div>
              <div v-else-if="msg.contentType === 'voice'">🎤 Tin nhắn thoại</div>
              <div v-else-if="msg.contentType === 'gif'">GIF</div>
              <!-- Reminder/Calendar -->
              <div v-else-if="isReminderMessage(msg)" class="reminder-card">
                <div class="d-flex align-center mb-1">
                  <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
                  <span class="text-caption font-weight-bold" style="color: #FFA726;">Nhắc hẹn</span>
                </div>
                <div class="text-body-2">{{ getReminderTitle(msg) }}</div>
                <div v-if="getReminderTime(msg)" class="text-caption mt-1" style="opacity: 0.7;">
                  <v-icon size="12" class="mr-1">mdi-clock-outline</v-icon>{{ getReminderTime(msg) }}
                </div>
                <v-btn size="x-small" variant="tonal" color="warning" class="mt-2" prepend-icon="mdi-calendar-sync" @click="syncAppointment(msg)">
                  Đồng bộ lịch
                </v-btn>
              </div>
              <!-- Default text -->
              <div v-else style="line-height: 1.5;">{{ parseDisplayContent(msg.content) }}</div>

              <!-- Timestamp + read status -->
              <div class="d-flex align-center mt-1" :class="msg.senderType === 'self' ? 'justify-end' : ''" style="gap: 4px;">
                <span class="msg-time" :class="msg.senderType === 'self' ? 'msg-time-self' : 'msg-time-contact'" style="font-size: 0.7rem;">
                  {{ formatMessageTime(msg.sentAt) }}
                </span>
                <v-icon v-if="msg.senderType === 'self'" size="14" :color="msg.senderType === 'self' ? 'rgba(255,255,255,0.7)' : 'primary'">mdi-check-all</v-icon>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!loading && messages.length === 0" class="text-center pa-8" style="color: #9CA3AF;">Chưa có tin nhắn</div>
      </div>

      <!-- Input area — Figma style: attachment icon, text field, send button -->
      <div class="pa-3 d-flex align-center chat-input-area" style="gap: 12px;">
        <v-btn icon variant="text" size="small" color="grey" :disabled="sending" @click="openStickerPicker">
          <v-icon>mdi-paperclip</v-icon>
        </v-btn>
        <v-textarea
          v-model="inputText"
          placeholder="Type your message here..."
          variant="solo-filled"
          density="compact"
          hide-details
          auto-grow
          rows="1"
          max-rows="3"
          @keydown.enter.exact.prevent="handleSend"
          class="flex-grow-1 msg-input"
        />
        <v-btn
          variant="text"
          color="primary"
          :loading="sending"
          :disabled="!inputText.trim()"
          @click="handleSend"
          class="text-none font-weight-medium"
        >
          Send message
        </v-btn>
      </div>
    </template>

    <!-- Image preview dialog -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);" />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>

    <!-- Sync snackbar -->
    <v-snackbar v-model="syncSnack.show" :color="syncSnack.color" timeout="3000">{{ syncSnack.text }}</v-snackbar>

    <!-- Sticker dialog -->
    <v-dialog v-model="showStickerDialog" max-width="720">
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>Chọn sticker</span>
          <v-spacer />
          <v-btn icon variant="text" @click="showStickerDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text>
          <div class="d-flex align-center mb-4">
            <v-text-field
              v-model="stickerKeyword"
              placeholder="Tìm sticker, ví dụ: hello"
              prepend-inner-icon="mdi-magnify"
              variant="solo-filled"
              density="compact"
              hide-details
              class="flex-grow-1 mr-2"
              @keydown.enter.prevent="handleStickerSearch"
            />
            <v-btn color="primary" :loading="loadingStickers" @click="handleStickerSearch">Tìm</v-btn>
          </div>

          <v-alert v-if="stickerError" type="error" density="compact" variant="tonal" class="mb-3">
            {{ stickerError }}
          </v-alert>

          <div v-if="loadingStickers" class="py-8">
            <v-progress-linear indeterminate color="primary" />
          </div>

          <div v-else-if="stickers.length > 0" class="sticker-grid">
            <button
              v-for="sticker in stickers"
              :key="`${sticker.id}-${sticker.cateId}-${sticker.type}`"
              type="button"
              class="sticker-option"
              @click="handleSelectSticker(sticker)"
            >
              <img
                v-if="getStickerPreviewUrl(sticker)"
                :src="getStickerPreviewUrl(sticker)!"
                :alt="sticker.text || 'Sticker'"
                class="sticker-option-image"
              />
              <span v-else class="text-caption">Sticker #{{ sticker.id }}</span>
            </button>
          </div>

          <div v-else class="text-center py-8" style="color: #9CA3AF;">
            {{ stickerKeyword ? 'Không tìm thấy sticker phù hợp' : 'Nhập từ khóa để tìm sticker' }}
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import type { Conversation, Message, StickerDetail } from '@/composables/use-chat';
import { api } from '@/api/index';

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  searchStickers: (keyword: string) => Promise<StickerDetail[]>;
}>();

const emit = defineEmits<{ send: [content: string]; 'send-sticker': [sticker: StickerDetail]; 'toggle-contact-panel': [] }>();

const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) previewImageUrl.value = ''; } });
const syncSnack = ref({ show: false, text: '', color: 'success' });
const showStickerDialog = ref(false);
const stickerKeyword = ref('');
const loadingStickers = ref(false);
const stickers = ref<StickerDetail[]>([]);
const stickerError = ref('');

function handleSend() { if (!inputText.value.trim()) return; emit('send', inputText.value); inputText.value = ''; }
function formatMessageTime(d: string) { return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }
function openFile(url: string) { window.open(url, '_blank'); }
function openStickerPicker() { showStickerDialog.value = true; if (!stickers.value.length && !stickerKeyword.value) stickerKeyword.value = 'hello'; void handleStickerSearch(); }

/** Extract image URL from JSON content */
function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

function getStickerUrl(msg: Message): string | null {
  if (msg.contentType !== 'sticker' || !msg.content) return null;
  try {
    const parsed = JSON.parse(msg.content);
    return parsed.stickerUrl || parsed.stickerSpriteUrl || parsed.uri || null;
  } catch {
    return null;
  }
}

function getStickerPreviewUrl(sticker: StickerDetail): string | null {
  return sticker.stickerUrl || sticker.stickerSpriteUrl || sticker.uri || null;
}

/** Extract file info from JSON content (PDF, docs, etc.) */
function getFileInfo(msg: Message): { name: string; size: string; href: string } | null {
  if (!msg.content?.startsWith('{')) return null;
  try {
    const p = JSON.parse(msg.content);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    if (params?.fileExt || params?.fType === 1) {
      const bytes = parseInt(params.fileSize || '0');
      const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
      return { name: p.title || `file.${params.fileExt || 'unknown'}`, size, href: p.href || '' };
    }
  } catch {}
  return null;
}

function parseDisplayContent(content: string | null): string {
  if (!content) return '';
  if (!content.startsWith('{')) return content;
  try {
    const p = JSON.parse(content);
    if (p.title && p.href) return `🔗 ${p.title}`;
    if (p.title) return p.title;
    if (p.href) return `🔗 ${p.description || p.href}`;
    return content;
  } catch { return content; }
}

function isReminderMessage(msg: Message): boolean {
  if (!msg.content) return false;
  try { const p = JSON.parse(msg.content); return p.action === 'msginfo.actionlist'; } catch { return false; }
}

function getReminderTitle(msg: Message): string {
  try { return JSON.parse(msg.content!).title || ''; } catch { return msg.content || ''; }
}

function getReminderTime(msg: Message): string | null {
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) return new Date(h.ts).toLocaleString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  } catch {}
  return null;
}

/** Sync Zalo reminder to CRM appointments via API */
async function syncAppointment(msg: Message) {
  if (!props.conversation?.contact?.id) { syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' }; return; }
  try {
    const p = JSON.parse(msg.content!);
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    let appointmentDate: string | null = null;
    for (const h of (params?.highLightsV2 || [])) {
      if (h.ts > 1e12) { appointmentDate = new Date(h.ts).toISOString(); break; }
    }
    if (!appointmentDate) { syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' }; return; }
    await api.post('/appointments', {
      contactId: props.conversation.contact.id,
      appointmentDate,
      appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      type: 'tai_kham',
      notes: `[Zalo] ${p.title || ''}`,
    });
    syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
  } catch (err: any) {
    syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
  }
}

async function handleStickerSearch() {
  if (!stickerKeyword.value.trim()) {
    stickers.value = [];
    return;
  }

  loadingStickers.value = true;
  stickerError.value = '';
  try {
    stickers.value = await props.searchStickers(stickerKeyword.value);
  } catch (err: any) {
    stickerError.value = err.response?.data?.error || 'Không tìm được sticker';
  } finally {
    loadingStickers.value = false;
  }
}

function handleSelectSticker(sticker: StickerDetail) {
  emit('send-sticker', sticker);
  showStickerDialog.value = false;
}

watch(() => props.messages.length, async () => { await nextTick(); if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight; });
</script>

<style scoped>
.msg-header {
  background: #FFFFFF;
  border-bottom: 1px solid #E5E7EB;
}

.chat-messages-area {
  background: #FFFFFF;
}

.message-bubble {
  box-shadow: none;
  font-size: 0.9rem;
}

.message-bubble.bg-primary {
  border-radius: 18px 18px 4px 18px;
}

.message-bubble:not(.bg-primary) {
  background: #F0F2F5;
  border-radius: 4px 18px 18px 18px;
  color: #1A1A2E;
}

.chat-input-area {
  background: #FFFFFF;
  border-top: 1px solid #E5E7EB;
}

.msg-input :deep(.v-field) {
  background: #F5F7FB !important;
  border-radius: 20px !important;
  border: none !important;
  box-shadow: none !important;
}

.reminder-card {
  padding: 8px 12px;
  border-left: 3px solid #FFA726;
  border-radius: 8px;
  background: rgba(255, 167, 38, 0.06);
}

.file-card {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(33, 150, 243, 0.05);
  border: 1px solid rgba(33, 150, 243, 0.1);
}

.chat-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: 12px;
  cursor: pointer;
  transition: transform 0.2s;
}

.chat-image:hover {
  transform: scale(1.02);
}

.chat-sticker {
  width: 120px;
  height: 120px;
  object-fit: contain;
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 12px;
}

.sticker-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  background: #F8F9FA;
  cursor: pointer;
  padding: 8px;
  transition: all 0.15s ease;
}

.sticker-option:hover {
  background: #E3F2FD;
  border-color: #2196F3;
}

.sticker-option-image {
  max-width: 72px;
  max-height: 72px;
  object-fit: contain;
}

/* Dark mode overrides */
.v-theme--dark .msg-header {
  background: rgba(17, 34, 64, 0.3);
  border-bottom-color: rgba(66, 165, 245, 0.1);
}

.v-theme--dark .chat-messages-area {
  background: rgba(10, 25, 47, 0.3);
}

.v-theme--dark .chat-input-area {
  background: rgba(17, 34, 64, 0.5);
  border-top-color: rgba(66, 165, 245, 0.1);
}

.v-theme--dark .msg-input :deep(.v-field) {
  background: rgba(17, 34, 64, 0.5) !important;
}

.v-theme--dark .message-bubble:not(.bg-primary) {
  background: rgba(66, 165, 245, 0.08);
  color: #E6F1FF;
}

.v-theme--dark .sticker-option {
  border-color: rgba(66, 165, 245, 0.12);
  background: rgba(66, 165, 245, 0.04);
}

.v-theme--dark .file-card {
  background: rgba(66, 165, 245, 0.05);
  border-color: rgba(66, 165, 245, 0.1);
}
</style>
