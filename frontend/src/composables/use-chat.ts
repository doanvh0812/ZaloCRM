import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { io, Socket } from 'socket.io-client';
import type { Contact } from '@/composables/use-contacts';

interface ZaloAccount {
  id: string;
  displayName: string | null;
}

interface ConversationMessage {
  content: string | null;
  contentType: string;
  senderType: string;
  sentAt: string;
  isDeleted: boolean;
}

export interface Conversation {
  id: string;
  threadType: 'user' | 'group';
  contact: Contact | null;
  zaloAccount: ZaloAccount | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  messages?: ConversationMessage[];
}

export interface Message {
  id: string;
  content: string | null;
  contentType: string;
  senderType: string;
  senderName: string | null;
  sentAt: string;
  isDeleted: boolean;
  zaloMsgId: string | null;
}

export interface StickerDetail {
  id: number;
  cateId: number;
  type: number;
  text?: string;
  uri?: string;
  stickerUrl?: string;
  stickerSpriteUrl?: string;
}

export function useChat() {
  const conversations = ref<Conversation[]>([]);
  const selectedConvId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const loadingConvs = ref(false);
  const loadingMsgs = ref(false);
  const sendingMsg = ref(false);
  const searchQuery = ref('');
  const accountFilter = ref<string | null>(null);
  let socket: Socket | null = null;

  const selectedConv = computed(() =>
    conversations.value.find(c => c.id === selectedConvId.value) || null,
  );

  function getMessageTimestamp(msg: Message) {
    return new Date(msg.sentAt).getTime();
  }

  function findDuplicateMessageIndex(list: Message[], incoming: Message) {
    const exactIndex = list.findIndex((msg) => msg.id === incoming.id);
    if (exactIndex !== -1) return exactIndex;

    if (incoming.zaloMsgId) {
      const zaloMsgIndex = list.findIndex((msg) => msg.zaloMsgId && msg.zaloMsgId === incoming.zaloMsgId);
      if (zaloMsgIndex !== -1) return zaloMsgIndex;
    }

    return list.findIndex((msg) => {
      if (msg.senderType !== 'self' || incoming.senderType !== 'self') return false;
      if (msg.contentType !== incoming.contentType) return false;
      if (!isSameMessageContent(msg, incoming)) return false;

      const timeDiff = Math.abs(getMessageTimestamp(msg) - getMessageTimestamp(incoming));
      return timeDiff <= 15000;
    });
  }

  function isSameMessageContent(existing: Message, incoming: Message) {
    if (existing.contentType !== 'sticker') {
      return existing.content === incoming.content;
    }

    return getStickerSignature(existing.content) === getStickerSignature(incoming.content);
  }

  function getStickerSignature(content: string | null) {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      if (
        typeof parsed?.id === 'number'
        && typeof parsed?.cateId === 'number'
        && typeof parsed?.type === 'number'
      ) {
        return `${parsed.id}:${parsed.cateId}:${parsed.type}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  function parseStickerContent(content: string | null) {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      if (
        typeof parsed?.id === 'number'
        && typeof parsed?.cateId === 'number'
        && typeof parsed?.type === 'number'
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  function mergeStickerContent(existingContent: string | null, incomingContent: string | null) {
    const existing = parseStickerContent(existingContent);
    const incoming = parseStickerContent(incomingContent);

    if (!existing) return incomingContent ?? existingContent;
    if (!incoming) return existingContent ?? incomingContent;

    return JSON.stringify({
      ...existing,
      ...incoming,
      text: incoming.text || existing.text || '',
      uri: incoming.uri || existing.uri || '',
      stickerUrl: incoming.stickerUrl || existing.stickerUrl || '',
      stickerSpriteUrl: incoming.stickerSpriteUrl || existing.stickerSpriteUrl || '',
    });
  }

  function mergeMessages(existing: Message, incoming: Message): Message {
    const content = existing.contentType === 'sticker'
      ? mergeStickerContent(existing.content, incoming.content)
      : (incoming.content ?? existing.content);

    return {
      ...existing,
      ...incoming,
      content,
      zaloMsgId: incoming.zaloMsgId || existing.zaloMsgId,
    };
  }

  function sortMessages(list: Message[]) {
    list.sort((a, b) => getMessageTimestamp(a) - getMessageTimestamp(b));
  }

  function upsertMessage(list: Message[], incoming: Message) {
    const duplicateIndex = findDuplicateMessageIndex(list, incoming);
    if (duplicateIndex === -1) {
      list.push(incoming);
      sortMessages(list);
      return;
    }

    list[duplicateIndex] = mergeMessages(list[duplicateIndex], incoming);
    sortMessages(list);
  }

  function dedupeMessages(list: Message[]) {
    const deduped: Message[] = [];
    for (const msg of list) {
      upsertMessage(deduped, msg);
    }
    return deduped;
  }

  async function fetchConversations() {
    loadingConvs.value = true;
    try {
      const res = await api.get('/conversations', {
        params: { limit: 100, search: searchQuery.value, accountId: accountFilter.value || undefined },
      });
      conversations.value = res.data.conversations;
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      loadingConvs.value = false;
    }
  }

  async function selectConversation(convId: string) {
    selectedConvId.value = convId;
    await fetchMessages(convId);
    // Fetch full conversation detail to populate contact CRM fields
    try {
      const convDetail = await api.get(`/conversations/${convId}`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv && convDetail.data.contact) {
        conv.contact = convDetail.data.contact;
      }
    } catch {
      // Non-critical — panel will show partial data from list
    }
    // Mark as read
    try {
      await api.post(`/conversations/${convId}/mark-read`);
      const conv = conversations.value.find(c => c.id === convId);
      if (conv) conv.unreadCount = 0;
    } catch {
      // Ignore mark-read errors
    }
  }

  async function fetchMessages(convId: string) {
    loadingMsgs.value = true;
    try {
      const res = await api.get(`/conversations/${convId}/messages`, {
        params: { limit: 100 },
      });
      messages.value = dedupeMessages(res.data.messages);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      loadingMsgs.value = false;
    }
  }

  async function sendMessage(content: string) {
    if (!selectedConvId.value || !content.trim()) return;
    sendingMsg.value = true;
    try {
      const res = await api.post(`/conversations/${selectedConvId.value}/messages`, { content });
      upsertMessage(messages.value, res.data);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      sendingMsg.value = false;
    }
  }

  async function searchStickers(keyword: string) {
    if (!selectedConvId.value || !keyword.trim()) return [];

    const res = await api.get(`/conversations/${selectedConvId.value}/stickers`, {
      params: { keyword: keyword.trim(), limit: 24 },
    });
    return (res.data.stickers || []) as StickerDetail[];
  }

  async function sendSticker(sticker: StickerDetail) {
    if (!selectedConvId.value) return;
    sendingMsg.value = true;
    try {
      const res = await api.post(`/conversations/${selectedConvId.value}/stickers`, sticker);
      upsertMessage(messages.value, res.data);
    } catch (err) {
      console.error('Failed to send sticker:', err);
      throw err;
    } finally {
      sendingMsg.value = false;
    }
  }

  function initSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('chat:message', (data: { message: Message; conversationId: string }) => {
      // Add to messages if viewing this conversation
      if (data.conversationId === selectedConvId.value) {
        upsertMessage(messages.value, data.message);
      }
      // Refresh conversation list to update last message / unread count
      fetchConversations();
    });

    socket.on('chat:deleted', (data: { msgId: string }) => {
      const msg = messages.value.find(m => m.zaloMsgId === data.msgId);
      if (msg) {
        msg.isDeleted = true;
      }
    });
  }

  function destroySocket() {
    socket?.disconnect();
    socket = null;
  }

  return {
    conversations,
    selectedConvId,
    selectedConv,
    messages,
    loadingConvs,
    loadingMsgs,
    sendingMsg,
    searchQuery,
    accountFilter,
    fetchConversations,
    selectConversation,
    sendMessage,
    searchStickers,
    sendSticker,
    initSocket,
    destroySocket,
  };
}
