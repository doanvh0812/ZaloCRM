<template>
  <div class="conversation-list d-flex flex-column" style="width: 100%; border-right: 1px solid var(--border-light, #E5E7EB); height: 100%;">
    <!-- Header -->
    <div class="pa-4 pb-2">
      <div class="d-flex align-center mb-3">
        <h2 class="text-h6 font-weight-bold" style="color: var(--text-primary, #1A1A2E);">Messages</h2>
        <v-spacer />
        <v-select
          v-model="selectedAccountId"
          :items="accountOptions"
          item-title="text"
          item-value="value"
          label="Tất cả Zalo"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 140px;"
          @update:model-value="$emit('filter-account', $event)"
        />
      </div>

      <!-- Search -->
      <v-text-field
        :model-value="search"
        @update:model-value="$emit('update:search', $event)"
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        variant="solo-filled"
        density="compact"
        hide-details
        clearable
        class="search-field"
      />

      <!-- Sort -->
      <div class="d-flex align-center mt-2">
        <span class="text-caption" style="color: var(--text-muted, #9CA3AF);">Sort by</span>
        <v-menu>
          <template #activator="{ props }">
            <v-btn variant="text" size="x-small" v-bind="props" class="ml-1 text-capitalize" color="primary">
              {{ sortLabel }}
              <v-icon size="14" class="ml-1">mdi-chevron-down</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click="sortBy = 'newest'" :active="sortBy === 'newest'">
              <v-list-item-title>Newest</v-list-item-title>
            </v-list-item>
            <v-list-item @click="sortBy = 'unread'" :active="sortBy === 'unread'">
              <v-list-item-title>Unread</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </div>

    <!-- Conversation list -->
    <v-list class="flex-grow-1 overflow-y-auto pa-0" density="compact">
      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <v-list-item
        v-for="conv in sortedConversations"
        :key="conv.id"
        :active="conv.id === selectedId"
        @click="$emit('select', conv.id)"
        class="conv-item py-3 px-4"
        :class="{
          'conv-item-active': conv.id === selectedId,
          'conv-item-unread': conv.unreadCount > 0 && conv.id !== selectedId,
        }"
      >
        <template #prepend>
          <div class="position-relative mr-3">
            <v-avatar size="44" color="grey-lighten-3">
              <v-icon v-if="conv.threadType === 'group'" icon="mdi-account-group" color="grey" />
              <v-img v-else-if="conv.contact?.avatarUrl" :src="conv.contact.avatarUrl" />
              <v-icon v-else icon="mdi-account" color="grey" />
            </v-avatar>
            <!-- Online indicator dot -->
            <span
              v-if="conv.id === selectedId"
              class="online-dot"
              style="position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; border-radius: 50%; background: #66BB6A; border: 2px solid #FFFFFF;"
            ></span>
          </div>
        </template>

        <v-list-item-title class="d-flex align-center">
          <span class="text-truncate conv-name" :class="{ 'font-weight-bold': conv.unreadCount > 0 }">
            {{ conv.threadType === 'group' ? (conv.contact?.fullName || 'Nhóm') : (conv.contact?.fullName || 'Unknown') }}
          </span>
          <v-chip v-if="conv.threadType === 'group'" size="x-small" color="info" variant="tonal" class="ml-1">Nhóm</v-chip>
          <v-spacer />
          <span class="conv-time text-caption">{{ formatTime(conv.lastMessageAt) }}</span>
        </v-list-item-title>

        <v-list-item-subtitle class="d-flex align-center mt-1">
          <span class="text-truncate conv-preview" :class="{ 'font-weight-medium': conv.unreadCount > 0 }" style="max-width: 200px;">
            {{ lastMessagePreview(conv) }}
          </span>
          <v-spacer />
          <!-- Read status / Unread badge -->
          <v-icon v-if="conv.unreadCount === 0 && conv.messages?.[0]?.senderType === 'self'" size="16" color="primary" class="ml-1">mdi-check-all</v-icon>
          <v-badge
            v-else-if="conv.unreadCount > 0"
            :content="conv.unreadCount"
            color="error"
            inline
          />
        </v-list-item-subtitle>

        <!-- Zalo account indicator -->
        <template #append>
          <span v-if="conv.zaloAccount?.displayName" class="conv-account-label">
            {{ conv.zaloAccount.displayName }}
          </span>
        </template>
      </v-list-item>

      <div v-if="!loading && conversations.length === 0" class="text-center pa-8" style="color: var(--text-muted, #9CA3AF);">
        Chưa có cuộc trò chuyện nào
      </div>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import { api } from '@/api/index';

const props = defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
}>();

defineEmits<{
  select: [id: string];
  'update:search': [value: string];
  'filter-account': [accountId: string | null];
}>();

const accountOptions = ref<{ text: string; value: string }[]>([]);
const selectedAccountId = ref<string | null>(null);
const sortBy = ref<'newest' | 'unread'>('newest');

const sortLabel = computed(() => sortBy.value === 'newest' ? 'Newest' : 'Unread');

const sortedConversations = computed(() => {
  const list = [...props.conversations];
  if (sortBy.value === 'unread') {
    list.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0));
  }
  return list;
});

onMounted(async () => {
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts || [];
    accountOptions.value = accounts.map((a: any) => ({
      text: a.displayName || a.zaloUid || a.id,
      value: a.id,
    }));
  } catch {
    // Non-critical — filter just won't show accounts
  }
});

function lastMessagePreview(conv: Conversation): string {
  const msg = conv.messages?.[0];
  if (!msg) return '';
  if (msg.isDeleted) return '(đã thu hồi)';
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';

  switch (msg.contentType) {
    case 'image': return prefix + '📷 Hình ảnh';
    case 'sticker': return prefix + '🏷️ Sticker';
    case 'video': return prefix + '🎥 Video';
    case 'voice': return prefix + '🎤 Tin nhắn thoại';
    case 'gif': return prefix + 'GIF';
    case 'file': return prefix + '📎 Tệp đính kèm';
    case 'link': return prefix + '🔗 Liên kết';
  }

  // Reminder/calendar messages
  if (msg.content) {
    try {
      const p = JSON.parse(msg.content);
      if (p.action === 'msginfo.actionlist' && p.title) {
        return prefix + '📅 ' + p.title.slice(0, 50);
      }
    } catch { /* not JSON */ }
  }

  const text = msg.content || '';
  return prefix + (text.length > 50 ? text.slice(0, 50) + '...' : text);
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays} ngày`;

  return date.toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.conversation-list {
  background: #FFFFFF;
}

.search-field :deep(.v-field) {
  background: #F5F7FB !important;
  border-radius: 10px !important;
  border: none !important;
  box-shadow: none !important;
}

.conv-item {
  border-bottom: 1px solid #F0F0F0;
  cursor: pointer;
  transition: background 0.15s ease;
}

.conv-item:hover {
  background: #F8F9FA !important;
}

.conv-item-active {
  background: #E3F2FD !important;
  border-left: 3px solid #2196F3;
}

.conv-item-unread {
  background: #FAFBFF;
}

.conv-name {
  font-size: 0.9rem;
  color: #1A1A2E;
}

.conv-time {
  color: #9CA3AF;
  font-size: 0.75rem;
  white-space: nowrap;
}

.conv-preview {
  color: #6B7280;
  font-size: 0.8rem;
}

.conv-account-label {
  font-size: 0.6rem;
  color: #9CA3AF;
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Dark mode overrides */
.v-theme--dark .conversation-list {
  background: rgba(17, 34, 64, 0.3);
}

.v-theme--dark .conv-item {
  border-bottom-color: rgba(66, 165, 245, 0.08);
}

.v-theme--dark .conv-item:hover {
  background: rgba(66, 165, 245, 0.05) !important;
}

.v-theme--dark .conv-item-active {
  background: rgba(66, 165, 245, 0.1) !important;
  border-left-color: #42A5F5;
}

.v-theme--dark .conv-name {
  color: #E6F1FF;
}

.v-theme--dark .conv-preview {
  color: #8892a6;
}

.v-theme--dark .search-field :deep(.v-field) {
  background: rgba(17, 34, 64, 0.5) !important;
}
</style>
