/**
 * zalo-listener-factory.ts — sets up zca-js listener events for one Zalo account.
 * Handles message routing, user-info caching, group detection, and undo events.
 * Extracted from ZaloAccountPool to keep zalo-pool.ts under 200 lines.
 */
import type { Server } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { handleIncomingMessage, handleMessageUndo } from '../chat/message-handler.js';
import { detectContentType, updateContactAvatar } from './zalo-message-helpers.js';

// Cached user info entry with 5-minute TTL
export interface UserInfoCacheEntry {
  zaloName: string;
  avatar: string;
  phone?: string;
  cachedAt: number;
}

const USER_INFO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Fetch zaloName + avatar from API with a per-pool in-memory cache
async function resolveZaloName(
  api: any,
  uid: string,
  cache: Map<string, UserInfoCacheEntry>,
): Promise<{ zaloName: string; avatar: string }> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.cachedAt < USER_INFO_CACHE_TTL_MS) {
    return { zaloName: cached.zaloName, avatar: cached.avatar };
  }

  try {
    const result = await api.getUserInfo(uid);
    const profiles = result?.changed_profiles || {};
    const profile = profiles[uid] || profiles[`${uid}_0`];
    if (profile) {
      const entry: UserInfoCacheEntry = {
        zaloName:
          profile.zaloName ||
          profile.zalo_name ||
          profile.displayName ||
          profile.display_name ||
          '',
        avatar: profile.avatar || '',
        phone: profile.phoneNumber || '',
        cachedAt: Date.now(),
      };
      cache.set(uid, entry);
      return { zaloName: entry.zaloName, avatar: entry.avatar };
    }
  } catch (err) {
    logger.warn(`[zalo] getUserInfo failed for ${uid}:`, err);
  }
  return { zaloName: '', avatar: '' };
}

// Fetch group display name from the zca-js API
async function resolveGroupName(api: any, groupId: string): Promise<string> {
  try {
    const result = await api.getGroupInfo(groupId);
    const info = result?.gridInfoMap?.[groupId];
    return info?.name || '';
  } catch (err) {
    logger.warn(`[zalo] getGroupInfo failed for ${groupId}:`, err);
    return '';
  }
}

export interface ListenerContext {
  accountId: string;
  api: any;
  io: Server | null;
  userInfoCache: Map<string, UserInfoCacheEntry>;
  onDisconnected: (accountId: string) => void;
}

/**
 * Attach all zca-js listener events for the given account.
 * Calls listener.start() with retryOnClose at the end.
 */
export function attachZaloListener(ctx: ListenerContext): void {
  const { accountId, api, io, userInfoCache, onDisconnected } = ctx;
  const listener = api.listener;

  listener.on('connected', () => {
    logger.info(`[zalo:${accountId}] Listener connected`);
  });

  listener.on('message', async (message: any) => {
    try {
      // ThreadType in zca-js: 0 = User, 1 = Group
      const isGroup = message.type === 1;
      const senderUid = String(message.data?.uidFrom || '');

      // Resolve display name — prefer zaloName from API over dName
      let senderName: string = message.data?.dName || '';
      if (!message.isSelf && senderUid && api.getUserInfo) {
        const userInfo = await resolveZaloName(api, senderUid, userInfoCache);
        if (userInfo.zaloName) senderName = userInfo.zaloName;
        if (userInfo.avatar) updateContactAvatar(senderUid, userInfo.avatar);
      }

      // Resolve group name for group threads
      let groupName: string | undefined;
      if (isGroup && message.threadId) {
        groupName = await resolveGroupName(api, message.threadId);
      }

      const rawContent = message.data?.content;
      const contentType = detectContentType(message.data?.msgType, rawContent);
      const content = await normalizeMessageContent(api, rawContent, contentType);

      const result = await handleIncomingMessage({
        accountId,
        senderUid,
        senderName,
        content,
        contentType,
        msgId: String(message.data?.msgId || ''),
        timestamp: parseInt(message.data?.ts || String(Date.now())),
        isSelf: message.isSelf || false,
        threadId: message.threadId || '',
        threadType: isGroup ? 'group' : 'user',
        groupName,
        attachments: [],
      });

      if (result) {
        io?.emit('chat:message', {
          accountId,
          message: result.message,
          conversationId: result.conversationId,
        });
      }
    } catch (err) {
      logger.error(`[zalo:${accountId}] Message handler error:`, err);
    }
  });

  listener.on('undo', async (data: any) => {
    const msgId = data.data?.msgId || data.msgId;
    if (msgId) {
      await handleMessageUndo(accountId, String(msgId));
      io?.emit('chat:deleted', { accountId, msgId: String(msgId) });
    }
  });

  listener.on('closed', (code: number, reason: string) => {
    logger.warn(`[zalo:${accountId}] Listener closed: ${code} ${reason}`);
    onDisconnected(accountId);
    io?.emit('zalo:disconnected', { accountId, code, reason });
  });

  listener.on('error', (err: any) => {
    logger.error(`[zalo:${accountId}] Listener error:`, err);
  });

  listener.start({ retryOnClose: true });
}

async function normalizeMessageContent(api: any, rawContent: any, contentType: string): Promise<string> {
  if (contentType !== 'sticker') {
    return typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
  }

  const stickerPayload = parseStickerPayload(rawContent);
  if (!stickerPayload) {
    return typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
  }

  if (!stickerPayload.stickerUrl && api.getStickersDetail) {
    try {
      const details = await api.getStickersDetail(stickerPayload.id);
      const detail = Array.isArray(details) ? details[0] : details;
      if (detail) {
        stickerPayload.text ||= detail.text || '';
        stickerPayload.uri ||= detail.uri || '';
        stickerPayload.stickerUrl ||= detail.stickerUrl || '';
        stickerPayload.stickerSpriteUrl ||= detail.stickerSpriteUrl || '';
      }
    } catch (err) {
      logger.warn('[zalo] getStickersDetail failed:', err);
    }
  }

  return JSON.stringify(stickerPayload);
}

function parseStickerPayload(rawContent: any): {
  id: number;
  cateId: number;
  type: number;
  text?: string;
  uri?: string;
  stickerUrl?: string;
  stickerSpriteUrl?: string;
} | null {
  let parsed = rawContent;

  if (typeof rawContent === 'string') {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return null;
    }
  }

  const id = Number(parsed?.id);
  const cateId = Number(parsed?.cateId);
  const type = Number(parsed?.type);
  if (!Number.isFinite(id) || !Number.isFinite(cateId) || !Number.isFinite(type)) {
    return null;
  }

  return {
    id,
    cateId,
    type,
    text: typeof parsed?.text === 'string' ? parsed.text : '',
    uri: typeof parsed?.uri === 'string' ? parsed.uri : '',
    stickerUrl: typeof parsed?.stickerUrl === 'string' ? parsed.stickerUrl : '',
    stickerSpriteUrl: typeof parsed?.stickerSpriteUrl === 'string' ? parsed.stickerSpriteUrl : '',
  };
}
