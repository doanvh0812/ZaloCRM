/**
 * report-routes.ts — Detailed reports for messages, contacts, appointments, and Excel export.
 * All routes require JWT auth, scoped to user's orgId.
 * Sheet builders are in excel-sheet-builders.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  buildMessagesSheet,
  buildContactsSheet,
  buildAppointmentsSheet,
  buildStaffSheet,
  buildZaloAccountsSheet,
} from './excel-sheet-builders.js';

type QueryParams = Record<string, string>;

function defaultDateRange() {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  return { from, to };
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/reports/messages?from=&to=
  app.get('/api/v1/reports/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const rows = await prisma.$queryRaw<
        Array<{ date: Date; sent: bigint; received: bigint; total: bigint }>
      >`
        SELECT
          DATE(m.sent_at) AS date,
          COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
          COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received,
          COUNT(*) AS total
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.org_id = ${orgId}
          AND m.sent_at >= ${from}::date
          AND m.sent_at < (${to}::date + interval '1 day')
        GROUP BY DATE(m.sent_at)
        ORDER BY date ASC
      `;

      const data = rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
        sent: Number(r.sent),
        received: Number(r.received),
        total: Number(r.total),
      }));

      return { from, to, data };
    } catch (err) {
      logger.error('[reports] Messages error:', err);
      return reply.status(500).send({ error: 'Failed to fetch message report' });
    }
  });

  // GET /api/v1/reports/contacts?from=&to= — contacts by status distribution
  app.get('/api/v1/reports/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const [newPerDay, statusDist] = await Promise.all([
        prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
          SELECT DATE(created_at) AS date, COUNT(*) AS count
          FROM contacts
          WHERE org_id = ${orgId}
            AND created_at >= ${from}::date
            AND created_at < (${to}::date + interval '1 day')
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `,
        prisma.contact.groupBy({
          by: ['status'],
          where: { orgId, status: { not: null } },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        newPerDay: newPerDay.map((r) => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          count: Number(r.count),
        })),
        byStatus: statusDist.map((s) => ({
          status: s.status,
          count: s._count,
        })),
      };
    } catch (err) {
      logger.error('[reports] Contacts error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact report' });
    }
  });

  // GET /api/v1/reports/appointments?from=&to=
  app.get('/api/v1/reports/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      const dateFilter = { gte: new Date(from), lte: new Date(to) };
      const [byStatus, byType] = await Promise.all([
        prisma.appointment.groupBy({
          by: ['status'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
        prisma.appointment.groupBy({
          by: ['type'],
          where: { orgId, appointmentDate: dateFilter },
          _count: true,
        }),
      ]);

      return {
        from,
        to,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
        byType: byType.map((t) => ({ type: t.type, count: t._count })),
      };
    } catch (err) {
      logger.error('[reports] Appointments error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointment report' });
    }
  });

  // GET /api/v1/reports/zalo-accounts?from=&to= — per-Zalo-account stats (Owner/Admin only)
  app.get(
    '/api/v1/reports/zalo-accounts',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const query = request.query as QueryParams;
        const { from: defaultFrom, to: defaultTo } = defaultDateRange();
        const from = query.from || defaultFrom;
        const to = query.to || defaultTo;

        const rows = await prisma.$queryRaw<
          Array<{
            account_id: string;
            display_name: string | null;
            zalo_uid: string | null;
            phone: string | null;
            owner_name: string | null;
            status: string;
            sent_count: bigint;
            received_count: bigint;
            unique_threads: bigint;
            unique_contacts: bigint;
            first_at: Date | null;
            last_at: Date | null;
          }>
        >`
          SELECT
            za.id AS account_id,
            za.display_name,
            za.zalo_uid,
            za.phone,
            u.full_name AS owner_name,
            za.status,
            COUNT(m.id) FILTER (WHERE m.sender_type = 'self') AS sent_count,
            COUNT(m.id) FILTER (WHERE m.sender_type = 'contact') AS received_count,
            COUNT(DISTINCT m.conversation_id) AS unique_threads,
            COUNT(DISTINCT conv.contact_id) AS unique_contacts,
            MIN(m.sent_at) AS first_at,
            MAX(m.sent_at) AS last_at
          FROM zalo_accounts za
          LEFT JOIN users u ON u.id = za.owner_user_id
          LEFT JOIN conversations conv ON conv.zalo_account_id = za.id
          LEFT JOIN messages m ON m.conversation_id = conv.id
            AND m.sent_at >= ${from}::date
            AND m.sent_at < (${to}::date + interval '1 day')
          WHERE za.org_id = ${orgId}
          GROUP BY za.id, za.display_name, za.zalo_uid, za.phone, u.full_name, za.status
          ORDER BY sent_count DESC, za.display_name ASC
        `;

        const data = rows.map((r) => ({
          accountId: r.account_id,
          displayName: r.display_name || r.phone || r.zalo_uid || '—',
          zaloUid: r.zalo_uid,
          phone: r.phone,
          ownerName: r.owner_name || '—',
          status: r.status,
          sentCount: Number(r.sent_count),
          receivedCount: Number(r.received_count),
          totalMessages: Number(r.sent_count) + Number(r.received_count),
          uniqueThreads: Number(r.unique_threads),
          uniqueContacts: Number(r.unique_contacts),
          firstAt: r.first_at ? r.first_at.toISOString() : null,
          lastAt: r.last_at ? r.last_at.toISOString() : null,
        }));

        const totalSent = data.reduce((sum, d) => sum + d.sentCount, 0);
        const totalReceived = data.reduce((sum, d) => sum + d.receivedCount, 0);
        const activeAccounts = data.filter((d) => d.totalMessages > 0).length;

        return {
          from,
          to,
          totalSent,
          totalReceived,
          activeAccounts,
          totalAccounts: data.length,
          data,
        };
      } catch (err) {
        logger.error('[reports] Zalo accounts error:', err);
        return reply.status(500).send({ error: 'Failed to fetch Zalo account report' });
      }
    },
  );

  // GET /api/v1/reports/staff?from=&to= — per-staff messaging stats (Owner/Admin only)
  app.get(
    '/api/v1/reports/staff',
    { preHandler: requireRole('owner', 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { orgId } = request.user!;
        const query = request.query as QueryParams;
        const { from: defaultFrom, to: defaultTo } = defaultDateRange();
        const from = query.from || defaultFrom;
        const to = query.to || defaultTo;

        // Per-user message stats: messages sent BY each user.
        // Two sources counted together:
        //   1. messages sent from CRM web (replied_by_user_id is set)
        //   2. messages sent from Zalo phone app — attributed to the Zalo account's owner
        const rows = await prisma.$queryRaw<
          Array<{
            user_id: string;
            full_name: string;
            email: string;
            role: string;
            sent_count: bigint;
            sent_from_crm: bigint;
            sent_from_phone: bigint;
            unique_threads: bigint;
            first_sent: Date | null;
            last_sent: Date | null;
          }>
        >`
          WITH attributed_msgs AS (
            SELECT
              m.id,
              m.conversation_id,
              m.sent_at,
              -- Attribution: explicit user when set, otherwise the Zalo account owner
              COALESCE(m.replied_by_user_id, za.owner_user_id) AS attributed_user_id,
              CASE WHEN m.replied_by_user_id IS NOT NULL THEN 1 ELSE 0 END AS from_crm
            FROM messages m
            JOIN conversations conv ON conv.id = m.conversation_id
            JOIN zalo_accounts za ON za.id = conv.zalo_account_id
            WHERE conv.org_id = ${orgId}
              AND m.sender_type = 'self'
              AND m.sent_at >= ${from}::date
              AND m.sent_at < (${to}::date + interval '1 day')
          )
          SELECT
            u.id AS user_id,
            u.full_name,
            u.email,
            u.role,
            COUNT(am.id) AS sent_count,
            COALESCE(SUM(am.from_crm), 0) AS sent_from_crm,
            COALESCE(SUM(1 - am.from_crm), 0) AS sent_from_phone,
            COUNT(DISTINCT am.conversation_id) AS unique_threads,
            MIN(am.sent_at) AS first_sent,
            MAX(am.sent_at) AS last_sent
          FROM users u
          LEFT JOIN attributed_msgs am ON am.attributed_user_id = u.id
          WHERE u.org_id = ${orgId}
            AND u.is_active = true
          GROUP BY u.id, u.full_name, u.email, u.role
          ORDER BY sent_count DESC, u.full_name ASC
        `;

        const data = rows.map((r) => ({
          userId: r.user_id,
          fullName: r.full_name,
          email: r.email,
          role: r.role,
          sentCount: Number(r.sent_count),
          sentFromCrm: Number(r.sent_from_crm),
          sentFromPhone: Number(r.sent_from_phone),
          uniqueThreads: Number(r.unique_threads),
          firstSent: r.first_sent ? r.first_sent.toISOString() : null,
          lastSent: r.last_sent ? r.last_sent.toISOString() : null,
        }));

        // Totals for summary card
        const totalSent = data.reduce((sum, d) => sum + d.sentCount, 0);
        const activeStaff = data.filter((d) => d.sentCount > 0).length;

        return {
          from,
          to,
          totalSent,
          activeStaff,
          totalStaff: data.length,
          data,
        };
      } catch (err) {
        logger.error('[reports] Staff error:', err);
        return reply.status(500).send({ error: 'Failed to fetch staff report' });
      }
    },
  );

  // GET /api/v1/reports/export?type=messages&from=&to=
  app.get('/api/v1/reports/export', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, role } = request.user!;
      const query = request.query as QueryParams;
      const { from: defaultFrom, to: defaultTo } = defaultDateRange();
      const type = query.type || 'messages';
      const from = query.from || defaultFrom;
      const to = query.to || defaultTo;

      // Staff/Zalo export restricted to Owner/Admin
      if ((type === 'staff' || type === 'zalo-accounts') && !['owner', 'admin'].includes(role)) {
        return reply.status(403).send({ error: 'Không có quyền xuất báo cáo này' });
      }

      const workbook = new ExcelJS.Workbook();

      if (type === 'messages') {
        await buildMessagesSheet(workbook, orgId, from, to);
      } else if (type === 'contacts') {
        await buildContactsSheet(workbook, orgId, from, to);
      } else if (type === 'appointments') {
        await buildAppointmentsSheet(workbook, orgId, from, to);
      } else if (type === 'staff') {
        await buildStaffSheet(workbook, orgId, from, to);
      } else if (type === 'zalo-accounts') {
        await buildZaloAccountsSheet(workbook, orgId, from, to);
      } else {
        return reply.status(400).send({ error: 'Invalid export type. Use: messages, contacts, appointments, staff, zalo-accounts' });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename=${type}-report.xlsx`);
      return reply.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err) {
      logger.error('[reports] Export error:', err);
      return reply.status(500).send({ error: 'Failed to export report' });
    }
  });
}