/**
 * dashboard-routes.ts — KPI, message volume, pipeline, sources, and appointment stats.
 * All routes require JWT auth, scoped to user's orgId.
 * Members see only data for contacts they're assigned to (assignedUserId)
 * or granted secondary access for (ContactAccess).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

type QueryParams = Record<string, string>;

function todayRange() {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  const todayVN = new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate());
  const today = new Date(todayVN.getTime() - vnOffset);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { today, tomorrow };
}

function weekAgoDate(from: Date) {
  const d = new Date(from);
  d.setDate(d.getDate() - 7);
  return d;
}

/**
 * Returns the list of contact IDs a member can see, or null for owner/admin (no restriction).
 */
async function getVisibleContactIds(user: { id: string; role: string; orgId: string }): Promise<string[] | null> {
  if (user.role !== 'member') return null;

  const [assigned, granted] = await Promise.all([
    prisma.contact.findMany({
      where: { orgId: user.orgId, assignedUserId: user.id },
      select: { id: true },
    }),
    prisma.contactAccess.findMany({
      where: { userId: user.id },
      select: { contactId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const c of assigned) ids.add(c.id);
  for (const a of granted) ids.add(a.contactId);
  return Array.from(ids);
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/dashboard/kpi
  app.get('/api/v1/dashboard/kpi', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { orgId } = user;
      const { today, tomorrow } = todayRange();
      const weekAgo = weekAgoDate(today);

      const visibleIds = await getVisibleContactIds(user);

      const conversationFilter: any = { orgId };
      const contactFilter: any = { orgId };
      const appointmentFilter: any = { orgId };

      if (visibleIds !== null) {
        conversationFilter.contactId = { in: visibleIds };
        contactFilter.id = { in: visibleIds };
        appointmentFilter.contactId = { in: visibleIds };
      }

      const [messagesToday, unreplied, unread, aptsToday, newContacts, totalContacts] =
        await Promise.all([
          prisma.message.count({
            where: {
              conversation: conversationFilter,
              sentAt: { gte: today, lt: tomorrow },
            },
          }),
          prisma.conversation.count({
            where: { ...conversationFilter, isReplied: false, unreadCount: { gt: 0 } },
          }),
          prisma.conversation.count({
            where: { ...conversationFilter, unreadCount: { gt: 0 } },
          }),
          prisma.appointment.count({
            where: {
              ...appointmentFilter,
              appointmentDate: { gte: today, lt: tomorrow },
              status: 'scheduled',
            },
          }),
          prisma.contact.count({ where: { ...contactFilter, createdAt: { gte: weekAgo } } }),
          prisma.contact.count({ where: contactFilter }),
        ]);

      return {
        messagesToday,
        messagesUnreplied: unreplied,
        messagesUnread: unread,
        appointmentsToday: aptsToday,
        newContactsThisWeek: newContacts,
        totalContacts,
      };
    } catch (err) {
      logger.error('[dashboard] KPI error:', err);
      return reply.status(500).send({ error: 'Failed to fetch KPI data' });
    }
  });

  // GET /api/v1/dashboard/message-volume?from=&to=
  app.get('/api/v1/dashboard/message-volume', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { orgId } = user;
      const query = request.query as QueryParams;
      const from = query.from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      const to = query.to || new Date().toISOString().split('T')[0];

      const visibleIds = await getVisibleContactIds(user);

      let rows: Array<{ date: Date; sent: bigint; received: bigint }>;
      if (visibleIds === null) {
        rows = await prisma.$queryRaw`
          SELECT
            DATE(m.sent_at) AS date,
            COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
            COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE c.org_id = ${orgId}
            AND m.sent_at >= ${from}::date
            AND m.sent_at < (${to}::date + interval '1 day')
          GROUP BY DATE(m.sent_at)
          ORDER BY date ASC
        `;
      } else if (visibleIds.length === 0) {
        rows = [];
      } else {
        rows = await prisma.$queryRaw`
          SELECT
            DATE(m.sent_at) AS date,
            COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
            COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_id
          WHERE c.org_id = ${orgId}
            AND c.contact_id = ANY(${visibleIds}::text[])
            AND m.sent_at >= ${from}::date
            AND m.sent_at < (${to}::date + interval '1 day')
          GROUP BY DATE(m.sent_at)
          ORDER BY date ASC
        `;
      }

      const data = rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        sent: Number(r.sent),
        received: Number(r.received),
      }));

      return { data };
    } catch (err) {
      logger.error('[dashboard] Message volume error:', err);
      return reply.status(500).send({ error: 'Failed to fetch message volume' });
    }
  });

  // GET /api/v1/dashboard/pipeline
  app.get('/api/v1/dashboard/pipeline', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const visibleIds = await getVisibleContactIds(user);

      const where: any = { orgId: user.orgId, status: { not: null } };
      if (visibleIds !== null) where.id = { in: visibleIds };

      const pipeline = await prisma.contact.groupBy({
        by: ['status'],
        where,
        _count: true,
      });
      return { data: pipeline.map((p) => ({ status: p.status, count: p._count })) };
    } catch (err) {
      logger.error('[dashboard] Pipeline error:', err);
      return reply.status(500).send({ error: 'Failed to fetch pipeline data' });
    }
  });

  // GET /api/v1/dashboard/sources
  app.get('/api/v1/dashboard/sources', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const visibleIds = await getVisibleContactIds(user);

      const where: any = { orgId: user.orgId, source: { not: null } };
      if (visibleIds !== null) where.id = { in: visibleIds };

      const sources = await prisma.contact.groupBy({
        by: ['source'],
        where,
        _count: true,
      });
      return { data: sources.map((s) => ({ source: s.source, count: s._count })) };
    } catch (err) {
      logger.error('[dashboard] Sources error:', err);
      return reply.status(500).send({ error: 'Failed to fetch source data' });
    }
  });

  // GET /api/v1/dashboard/appointments?from=&to=
  app.get('/api/v1/dashboard/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const query = request.query as QueryParams;
      const visibleIds = await getVisibleContactIds(user);

      const where: Record<string, any> = { orgId: user.orgId };
      if (visibleIds !== null) where.contactId = { in: visibleIds };
      if (query.from || query.to) {
        where.appointmentDate = {};
        if (query.from) where.appointmentDate.gte = new Date(query.from);
        if (query.to) where.appointmentDate.lte = new Date(query.to);
      }

      const stats = await prisma.appointment.groupBy({
        by: ['status'],
        where,
        _count: true,
      });

      return { data: stats.map((s) => ({ status: s.status, count: s._count })) };
    } catch (err) {
      logger.error('[dashboard] Appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment stats' });
    }
  });
}