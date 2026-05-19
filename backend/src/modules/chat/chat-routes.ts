/**
 * chat-routes.ts — REST API for conversations and messages.
 * All routes require JWT auth and are scoped to the user's org.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../zalo/zalo-rate-limiter.js';
import { logger } from '../../shared/utils/logger.js';
import { config } from '../../config/index.js';
import { randomUUID } from 'node:crypto';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Server } from 'socket.io';

type QueryParams = Record<string, string>;
type StickerPayload = {
  id: number;
  cateId: number;
  type: number;
  text?: string;
  uri?: string;
  stickerUrl?: string;
  stickerSpriteUrl?: string;
};

// File size limits (in bytes)
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── List conversations (paginated) ──────────────────────────────────────
  app.get('/api/v1/conversations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { page = '1', limit = '50', search = '', accountId = '' } = request.query as QueryParams;

    const where: any = { orgId: user.orgId };
    if (accountId) where.zaloAccountId = accountId;
    if (search) {
      where.contact = {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      };
    }

    // Members can only see conversations from:
    //  (a) Zalo accounts they have access to, OR
    //  (b) contacts they're assigned to or granted secondary access for
    if (user.role === 'member') {
      const [accessibleAccounts, accessibleContacts] = await Promise.all([
        prisma.zaloAccountAccess.findMany({
          where: { userId: user.id },
          select: { zaloAccountId: true },
        }),
        prisma.contactAccess.findMany({
          where: { userId: user.id },
          select: { contactId: true },
        }),
      ]);

      const accountIds = accessibleAccounts.map((a) => a.zaloAccountId);
      const contactIds = accessibleContacts.map((c) => c.contactId);

      where.OR = [
        { zaloAccountId: { in: accountIds } },
        { contactId: { in: contactIds } },
        { contact: { assignedUserId: user.id } },
      ];
    }

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        include: {
          contact: { select: { id: true, fullName: true, phone: true, avatarUrl: true, zaloUid: true } },
          zaloAccount: { select: { id: true, displayName: true, zaloUid: true } },
          messages: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { content: true, contentType: true, senderType: true, sentAt: true, isDeleted: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.conversation.count({ where }),
    ]);

    return { conversations, total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Get single conversation ──────────────────────────────────────────────
  app.get('/api/v1/conversations/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        contact: true,
        zaloAccount: { select: { id: true, displayName: true, zaloUid: true, status: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    return conversation;
  });

  // ── List messages for a conversation (paginated, newest first) ──────────
  app.get('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('read') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as QueryParams;

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        include: {
          reactions: {
            select: { id: true, reactorUid: true, reactorName: true, icon: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return { messages: messages.reverse(), total, page: parseInt(page), limit: parseInt(limit) };
  });

  // ── Send message ─────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { content, quoteMsgId } = request.body as { content: string; quoteMsgId?: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    // Rate limit check — prevent account blocking
    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    // If this is a reply, look up the original message and build quote payload
    let quotePayload: any = undefined;
    let quoteMeta: { msgId: string; senderName: string; content: string } | null = null;
    if (quoteMsgId) {
      const quotedMsg = await prisma.message.findFirst({
        where: { conversationId: id, OR: [{ id: quoteMsgId }, { zaloMsgId: quoteMsgId }] },
      });
      if (quotedMsg && quotedMsg.zaloMsgId) {
        // zca-js quote shape — mimics what listener.on('message') gives us in message.data
        quotePayload = {
          msgId: quotedMsg.zaloMsgId,
          cliMsgId: quotedMsg.zaloMsgId,
          uidFrom: quotedMsg.senderUid || '',
          idTo: conversation.externalThreadId || '',
          dName: quotedMsg.senderName || '',
          content: quotedMsg.content || '',
          ts: String(quotedMsg.sentAt.getTime()),
          msgType: 'webchat',
        };
        quoteMeta = {
          msgId: quotedMsg.zaloMsgId,
          senderName: quotedMsg.senderName || '',
          content: (quotedMsg.content || '').slice(0, 200),
        };
      }
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const sentAt = new Date();

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      const sendPayload: any = { msg: content };
      if (quotePayload) sendPayload.quote = quotePayload;
      await instance.api.sendMessage(sendPayload, threadId, threadType);

      // Embed quote metadata into content as JSON if this is a reply,
      // so the UI can render the quoted block above the message bubble.
      const storedContent = quoteMeta
        ? JSON.stringify({ type: 'reply', text: content, quote: quoteMeta })
        : content;
      const storedType = quoteMeta ? 'reply' : 'text';

      const message = await createOutgoingMessage({
        conversationId: id,
        zaloAccountId: conversation.zaloAccountId,
        senderUid: conversation.zaloAccount.zaloUid || '',
        content: storedContent,
        contentType: storedType,
        sentAt,
        repliedByUserId: user.id,
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send message error:', err);
      return reply.status(500).send({ error: 'Failed to send message' });
    }
  });

  // ── Upload + send image ─────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/upload-image', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    // @ts-ignore - file() comes from @fastify/multipart
    const data = await (request as any).file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const ext = path.extname(data.filename).slice(1).toLowerCase();
    if (!ALLOWED_IMAGE_EXTS.includes(ext)) {
      return reply.status(400).send({ error: 'Định dạng ảnh không hỗ trợ. Chỉ chấp nhận: ' + ALLOWED_IMAGE_EXTS.join(', ') });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    // Save uploaded file to disk first (zca-js needs a real file path)
    const savedPath = await saveUploadedFile(data, 'images', MAX_IMAGE_SIZE);
    if (!savedPath) return reply.status(413).send({ error: 'File quá lớn (tối đa 20 MB)' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const sentAt = new Date();

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      // zca-js v2: sendMessage with attachments (array of local file paths)
      await instance.api.sendMessage({ msg: '', attachments: [savedPath.fullPath] }, threadId, threadType);

      // Build content JSON so frontend can render the image
      const publicUrl = `/uploads/${savedPath.relativePath}`;
      const message = await createOutgoingMessage({
        conversationId: id,
        zaloAccountId: conversation.zaloAccountId,
        senderUid: conversation.zaloAccount.zaloUid || '',
        content: JSON.stringify({
          href: publicUrl,
          thumb: publicUrl,
          title: data.filename,
        }),
        contentType: 'image',
        sentAt,
        repliedByUserId: user.id,
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Upload image error:', err);
      return reply.status(500).send({ error: 'Gửi ảnh thất bại' });
    }
  });

  // ── Upload + send file/document ─────────────────────────────────────────
  app.post('/api/v1/conversations/:id/upload-file', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    // @ts-ignore
    const data = await (request as any).file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) return reply.status(429).send({ error: limits.reason });

    const savedPath = await saveUploadedFile(data, 'files', MAX_FILE_SIZE);
    if (!savedPath) return reply.status(413).send({ error: 'File quá lớn (tối đa 50 MB)' });

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const sentAt = new Date();
      const fileExt = path.extname(data.filename).slice(1).toLowerCase();

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      await instance.api.sendMessage({ msg: '', attachments: [savedPath.fullPath] }, threadId, threadType);

      const publicUrl = `/uploads/${savedPath.relativePath}`;
      const message = await createOutgoingMessage({
        conversationId: id,
        zaloAccountId: conversation.zaloAccountId,
        senderUid: conversation.zaloAccount.zaloUid || '',
        content: JSON.stringify({
          href: publicUrl,
          title: data.filename,
          params: JSON.stringify({
            fileExt,
            fileSize: String(savedPath.size),
            fType: 1,
          }),
        }),
        contentType: 'file',
        sentAt,
        repliedByUserId: user.id,
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Upload file error:', err);
      return reply.status(500).send({ error: 'Gửi file thất bại' });
    }
  });

  app.get('/api/v1/conversations/:id/stickers', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { keyword = '', max = '24' } = request.query as QueryParams;

    if (!keyword.trim()) return reply.status(400).send({ error: 'Missing keyword' });

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const stickerIds = await instance.api.getStickers(keyword.trim());
      const maxItems = Math.max(1, Math.min(48, parseInt(max) || 24));
      if (!stickerIds?.length) {
        return { stickers: [] };
      }

      const stickers = await instance.api.getStickersDetail(stickerIds.slice(0, maxItems));
      return { stickers };
    } catch (err) {
      logger.error('[chat] Sticker search error:', err);
      return reply.status(500).send({ error: 'Failed to search stickers' });
    }
  });

  app.post('/api/v1/conversations/:id/stickers', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const sticker = request.body as StickerPayload;

    if (!sticker?.id || !sticker?.cateId || typeof sticker.type !== 'number') {
      return reply.status(400).send({ error: 'Invalid sticker payload' });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
      include: { zaloAccount: true },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const limits = zaloRateLimiter.checkLimits(conversation.zaloAccountId);
    if (!limits.allowed) {
      return reply.status(429).send({ error: limits.reason });
    }

    try {
      const threadId = conversation.externalThreadId || '';
      const threadType = conversation.threadType === 'group' ? 1 : 0;
      const sentAt = new Date();
      const stickerPayload = {
        id: Number(sticker.id),
        cateId: Number(sticker.cateId),
        type: Number(sticker.type),
      };

      zaloRateLimiter.recordSend(conversation.zaloAccountId);
      await instance.api.sendSticker(stickerPayload, threadId, threadType);

      const message = await createOutgoingMessage({
        conversationId: id,
        zaloAccountId: conversation.zaloAccountId,
        senderUid: conversation.zaloAccount.zaloUid || '',
        content: JSON.stringify({
          ...stickerPayload,
          text: sticker.text || '',
          uri: sticker.uri || '',
          stickerUrl: sticker.stickerUrl || '',
          stickerSpriteUrl: sticker.stickerSpriteUrl || '',
        }),
        contentType: 'sticker',
        sentAt,
        repliedByUserId: user.id,
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message', { accountId: conversation.zaloAccountId, message, conversationId: id });

      return message;
    } catch (err) {
      logger.error('[chat] Send sticker error:', err);
      return reply.status(500).send({ error: 'Failed to send sticker' });
    }
  });

  // ── Add/update reaction on a message ─────────────────────────────────────
  app.post('/api/v1/messages/:msgId/reactions', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { msgId } = request.params as { msgId: string };
    const { icon } = request.body as { icon: string };

    if (!icon) return reply.status(400).send({ error: 'Thiếu icon' });

    // Lookup message + its conversation
    const message = await prisma.message.findFirst({
      where: { id: msgId, conversation: { orgId: user.orgId } },
      include: { conversation: { include: { zaloAccount: true } } },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const instance = zaloPool.getInstance(message.conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    const selfUid = message.conversation.zaloAccount.zaloUid || 'self';

    try {
      // Send reaction via zca-js if message has a Zalo msgId
      if (message.zaloMsgId) {
        const threadType = message.conversation.threadType === 'group' ? 1 : 0;
        await instance.api.addReaction(
          // Pass raw icon string — zca-js accepts both Reactions enum value
          // (which is the same string) and CustomReaction objects.
          icon,
          {
            data: {
              msgId: message.zaloMsgId,
              cliMsgId: message.zaloMsgId,
            },
            threadId: message.conversation.externalThreadId || '',
            type: threadType,
          },
        );
      }

      const reactor = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true },
      });

      // Upsert into DB — same user replacing their reaction
      const reaction = await prisma.messageReaction.upsert({
        where: { messageId_reactorUid: { messageId: msgId, reactorUid: selfUid } },
        create: {
          id: randomUUID(),
          messageId: msgId,
          reactorUid: selfUid,
          reactorName: reactor?.fullName || 'Staff',
          icon,
        },
        update: { icon, createdAt: new Date() },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:reaction', {
        accountId: message.conversation.zaloAccountId,
        conversationId: message.conversationId,
        messageId: msgId,
        reaction,
      });

      return { reaction };
    } catch (err) {
      logger.error('[chat] Add reaction error:', err);
      return reply.status(500).send({ error: 'Thả icon thất bại' });
    }
  });

  // ── Remove reaction ──────────────────────────────────────────────────────
  app.delete('/api/v1/messages/:msgId/reactions', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { msgId } = request.params as { msgId: string };

    const message = await prisma.message.findFirst({
      where: { id: msgId, conversation: { orgId: user.orgId } },
      include: { conversation: { include: { zaloAccount: true } } },
    });
    if (!message) return reply.status(404).send({ error: 'Message not found' });

    const instance = zaloPool.getInstance(message.conversation.zaloAccountId);
    const selfUid = message.conversation.zaloAccount.zaloUid || 'self';

    try {
      // Send empty reaction to Zalo to clear it
      if (instance?.api && message.zaloMsgId) {
        const threadType = message.conversation.threadType === 'group' ? 1 : 0;
        await instance.api.addReaction(
          '', // empty icon = remove
          {
            data: { msgId: message.zaloMsgId, cliMsgId: message.zaloMsgId },
            threadId: message.conversation.externalThreadId || '',
            type: threadType,
          },
        );
      }

      await prisma.messageReaction.deleteMany({
        where: { messageId: msgId, reactorUid: selfUid },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:reaction-removed', {
        accountId: message.conversation.zaloAccountId,
        conversationId: message.conversationId,
        messageId: msgId,
        reactorUid: selfUid,
      });

      return { success: true };
    } catch (err) {
      logger.error('[chat] Remove reaction error:', err);
      return reply.status(500).send({ error: 'Gỡ icon thất bại' });
    }
  });

  // ── Get group members (only for group conversations) ────────────────────
  app.get('/api/v1/conversations/:id/members', { preHandler: requireZaloAccess('chat') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conversation = await prisma.conversation.findFirst({
      where: { id, orgId: user.orgId },
    });
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    if (conversation.threadType !== 'group') {
      return reply.status(400).send({ error: 'Chỉ áp dụng cho nhóm' });
    }

    const instance = zaloPool.getInstance(conversation.zaloAccountId);
    if (!instance?.api) return reply.status(400).send({ error: 'Zalo account not connected' });

    try {
      const groupId = conversation.externalThreadId || '';
      // Step 1: get list of member UIDs from group info
      const groupInfo = await instance.api.getGroupInfo(groupId);
      const info = groupInfo?.gridInfoMap?.[groupId];
      if (!info) return reply.status(404).send({ error: 'Không lấy được thông tin nhóm' });

      const memberUids: string[] = Array.isArray(info.memVerList)
        ? info.memVerList.map((m: any) => String(m).split('_')[0])
        : [];

      if (memberUids.length === 0) {
        return {
          groupName: (info as any).name || '',
          totalMembers: 0,
          adminUids: (info as any).adminIds || [],
          ownerUid: (info as any).creatorId || '',
          members: [],
        };
      }

      // Step 2: get name + avatar for each member (in batches of 50)
      const profiles: Record<string, any> = {};
      const batchSize = 50;
      for (let i = 0; i < memberUids.length; i += batchSize) {
        const batch = memberUids.slice(i, i + batchSize);
        try {
          const result = await instance.api.getGroupMembersInfo(batch);
          Object.assign(profiles, result?.profiles || {});
        } catch (err) {
          logger.warn('[chat] Failed to fetch group members batch:', err);
        }
      }

      const adminSet = new Set<string>(((info as any).adminIds || []).map((s: any) => String(s)));
      const ownerId = String((info as any).creatorId || '');

      const members = memberUids.map((uid) => {
        const p = profiles[uid] || {};
        const role = uid === ownerId ? 'owner' : (adminSet.has(uid) ? 'admin' : 'member');
        return {
          uid,
          displayName: p.displayName || p.zaloName || '',
          zaloName: p.zaloName || '',
          avatar: p.avatar || '',
          role,
        };
      }).sort((a, b) => {
        // Owner first, then admins, then members alphabetically by name
        const order = { owner: 0, admin: 1, member: 2 };
        const diff = (order[a.role as keyof typeof order] ?? 3) - (order[b.role as keyof typeof order] ?? 3);
        if (diff !== 0) return diff;
        return (a.displayName || a.zaloName || a.uid).localeCompare(b.displayName || b.zaloName || b.uid);
      });

      return {
        groupName: (info as any).name || '',
        totalMembers: members.length,
        adminUids: Array.from(adminSet),
        ownerUid: ownerId,
        members,
      };
    } catch (err) {
      logger.error('[chat] Group members error:', err);
      return reply.status(500).send({ error: 'Không lấy được danh sách thành viên: ' + String(err) });
    }
  });

  // ── Mark conversation as read ────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/mark-read', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    await prisma.conversation.updateMany({
      where: { id, orgId: user.orgId },
      data: { unreadCount: 0 },
    });

    return { success: true };
  });
}

async function createOutgoingMessage(params: {
  conversationId: string;
  zaloAccountId: string;
  senderUid: string;
  content: string;
  contentType: string;
  sentAt: Date;
  repliedByUserId: string;
}) {
  const message = await prisma.message.create({
    data: {
      id: randomUUID(),
      conversationId: params.conversationId,
      senderType: 'self',
      senderUid: params.senderUid,
      senderName: 'Staff',
      content: params.content,
      contentType: params.contentType,
      sentAt: params.sentAt,
      repliedByUserId: params.repliedByUserId,
    },
  });

  await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { lastMessageAt: params.sentAt, isReplied: true, unreadCount: 0 },
  });

  return message;
}

/**
 * Saves a multipart-uploaded file to disk under UPLOAD_DIR/<subdir>/<uuid>.<ext>.
 * Returns null if size exceeds maxBytes.
 */
async function saveUploadedFile(
  data: any,
  subdir: 'images' | 'files',
  maxBytes: number,
): Promise<{ fullPath: string; relativePath: string; size: number } | null> {
  const ext = path.extname(data.filename).slice(1).toLowerCase() || 'bin';
  const safeName = `${randomUUID()}.${ext}`;
  const dir = path.join(config.uploadDir, subdir);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, safeName);

  let bytesWritten = 0;
  let aborted = false;
  const writeStream = createWriteStream(fullPath);

  data.file.on('data', (chunk: Buffer) => {
    bytesWritten += chunk.length;
    if (bytesWritten > maxBytes) {
      aborted = true;
      data.file.destroy();
    }
  });

  try {
    await pipeline(data.file, writeStream);
  } catch (err) {
    // Clean up partial file
    fs.unlink(fullPath).catch(() => {});
    if (aborted) return null;
    throw err;
  }

  if (aborted) {
    fs.unlink(fullPath).catch(() => {});
    return null;
  }

  return {
    fullPath,
    relativePath: `${subdir}/${safeName}`,
    size: bytesWritten,
  };
}