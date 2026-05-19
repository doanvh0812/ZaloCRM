<template>
  <div class="chat-container d-flex flex-column" style="height: calc(100vh - 64px);">
    <!-- Filter banner (when navigated from Dashboard) -->
    <div v-if="activeFilter" class="filter-banner pa-2 d-flex align-center" style="gap: 10px; background: #EFF6FF; border-bottom: 1px solid #E2E8F0;">
      <v-icon size="18" color="primary">mdi-filter-variant</v-icon>
      <span class="text-body-2 font-weight-medium" style="color: #1E40AF;">
        Đang lọc: <span style="text-transform: lowercase;">{{ filterLabel }}</span>
        <span class="text-caption ml-2" style="color: #64748B;">({{ filteredCount }} cuộc trò chuyện)</span>
      </span>
      <v-spacer />
      <v-btn size="small" variant="text" color="primary" @click="clearFilter">
        <v-icon size="16" class="mr-1">mdi-close</v-icon>
        Bỏ lọc
      </v-btn>
    </div>

    <div class="d-flex flex-grow-1" style="overflow: hidden;">
      <!-- Conversation list — resizable -->
      <div class="chat-panel-left" :style="{ width: leftWidth + 'px' }">
        <ConversationList
          :conversations="filteredConversations"
          :selected-id="selectedConvId"
          :loading="loadingConvs"
          v-model:search="searchQuery"
          @select="selectConversation"
          @filter-account="onFilterAccount"
        />
        <!-- Resize handle -->
        <div class="resize-handle" @mousedown="startResize('left', $event)" />
      </div>

      <!-- Message thread — flexible center -->
      <MessageThread
        :conversation="selectedConv"
        :messages="messages"
        :loading="loadingMsgs"
        :sending="sendingMsg"
        :upload-progress="uploadProgress"
        @send="handleSendMessage"
        @send-sticker="sendSticker"
        @send-image="handleSendImage"
        @send-file="handleSendFile"
        @add-reaction="handleAddReaction"
        @remove-reaction="handleRemoveReaction"
        @toggle-contact-panel="showContactPanel = !showContactPanel"
        :show-contact-panel="showContactPanel"
        :search-stickers="searchStickers"
        style="flex: 1; min-width: 300px;"
      />

      <!-- Contact panel — resizable -->
      <div v-if="showContactPanel && selectedConv?.contact" class="chat-panel-right" :style="{ width: rightWidth + 'px' }">
        <div class="resize-handle resize-handle-left" @mousedown="startResize('right', $event)" />
        <ChatContactPanel
          :contact-id="selectedConv.contact.id"
          :contact="selectedConv.contact"
          :conversation-id="selectedConv.id"
          :thread-type="selectedConv.threadType"
          @close="showContactPanel = false"
          @saved="fetchConversations()"
        />
      </div>
    </div>

    <v-snackbar v-model="errorSnack.show" :color="errorSnack.color" timeout="4000">
      {{ errorSnack.text }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, uploadProgress, searchQuery, accountFilter,
  fetchConversations, selectConversation, sendMessage, searchStickers, sendSticker,
  sendImage, sendFile, addReaction, removeReaction,
  initSocket, destroySocket,
} = useChat();

const route = useRoute();
const router = useRouter();
const errorSnack = ref({ show: false, text: '', color: 'error' });

// Active filter from URL query — e.g. ?filter=unread
const activeFilter = ref<string | null>(null);

const filterLabel = computed(() => {
  switch (activeFilter.value) {
    case 'unread': return 'Tin nhắn chưa đọc';
    case 'unreplied': return 'Cuộc trò chuyện chưa trả lời';
    case 'today': return 'Tin nhắn hôm nay';
    default: return '';
  }
});

const filteredConversations = computed(() => {
  if (!activeFilter.value) return conversations.value;
  const list = conversations.value;
  switch (activeFilter.value) {
    case 'unread':
      return list.filter((c) => (c.unreadCount || 0) > 0);
    case 'unreplied':
      // Last incoming message not replied — heuristic: unreadCount > 0 AND latest msg from contact
      return list.filter((c) => {
        if (!c.unreadCount) return false;
        const lastMsg = c.messages?.[0];
        return lastMsg && lastMsg.senderType === 'contact';
      });
    case 'today': {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return list.filter((c) => {
        if (!c.lastMessageAt) return false;
        return new Date(c.lastMessageAt) >= startOfToday;
      });
    }
    default:
      return list;
  }
});

const filteredCount = computed(() => filteredConversations.value.length);

function clearFilter() {
  activeFilter.value = null;
  router.replace({ path: '/chat', query: {} });
}

// Read filter from query on mount + on route change
watch(
  () => route.query.filter,
  (filter) => {
    activeFilter.value = (filter as string) || null;
  },
  { immediate: true },
);

function handleSendMessage(content: string, quoteMsgId?: string) {
  sendMessage(content, quoteMsgId);
}

async function handleAddReaction(messageId: string, icon: string) {
  try {
    await addReaction(messageId, icon);
  } catch (err: any) {
    errorSnack.value = {
      show: true,
      text: err.response?.data?.error || 'Thả icon thất bại',
      color: 'error',
    };
  }
}

async function handleRemoveReaction(messageId: string) {
  try {
    await removeReaction(messageId);
  } catch (err: any) {
    errorSnack.value = {
      show: true,
      text: err.response?.data?.error || 'Gỡ icon thất bại',
      color: 'error',
    };
  }
}

async function handleSendImage(file: File) {
  try {
    await sendImage(file);
  } catch (err: any) {
    errorSnack.value = {
      show: true,
      text: err.response?.data?.error || 'Gửi ảnh thất bại',
      color: 'error',
    };
  }
}

async function handleSendFile(file: File) {
  try {
    await sendFile(file);
  } catch (err: any) {
    errorSnack.value = {
      show: true,
      text: err.response?.data?.error || 'Gửi file thất bại',
      color: 'error',
    };
  }
}

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

const showContactPanel = ref(false);

// Resizable panel widths (restored from localStorage)
const leftWidth = ref(parseInt(localStorage.getItem('chat-left-width') || '320'));
const rightWidth = ref(parseInt(localStorage.getItem('chat-right-width') || '320'));

let resizing: 'left' | 'right' | null = null;
let startX = 0;
let startWidth = 0;

function startResize(panel: 'left' | 'right', e: MouseEvent) {
  resizing = panel;
  startX = e.clientX;
  startWidth = panel === 'left' ? leftWidth.value : rightWidth.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onResize(e: MouseEvent) {
  if (!resizing) return;
  const diff = e.clientX - startX;
  if (resizing === 'left') {
    leftWidth.value = Math.max(200, Math.min(500, startWidth + diff));
  } else {
    rightWidth.value = Math.max(250, Math.min(500, startWidth - diff));
  }
}

function stopResize() {
  if (resizing) {
    localStorage.setItem('chat-left-width', String(leftWidth.value));
    localStorage.setItem('chat-right-width', String(rightWidth.value));
  }
  resizing = null;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onMounted(() => { fetchConversations(); initSocket(); });
onUnmounted(() => { destroySocket(); });

let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});
</script>

<style scoped>
.chat-container {
  margin: -12px;
}

.chat-panel-left {
  position: relative;
  flex-shrink: 0;
  min-width: 200px;
  max-width: 500px;
}

.chat-panel-right {
  position: relative;
  flex-shrink: 0;
  min-width: 250px;
  max-width: 500px;
}

/* Resize handle — thin vertical line on the edge */
.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.2s;
}

.resize-handle:hover,
.resize-handle:active {
  background: rgba(33, 150, 243, 0.3);
}

.resize-handle-left {
  right: auto;
  left: -2px;
}
</style>