/**
 * excel-sheet-builders.ts — ExcelJS worksheet builders for each report type.
 * Each function adds a worksheet to the provided workbook and populates it with data.
 */
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';

export async function buildMessagesSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Tin nhắn');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Đã gửi', key: 'sent', width: 12 },
    { header: 'Đã nhận', key: 'received', width: 12 },
    { header: 'Tổng', key: 'total', width: 12 },
  ];

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

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      sent: Number(r.sent),
      received: Number(r.received),
      total: Number(r.total),
    });
  }
}

export async function buildContactsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Liên hệ');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Liên hệ mới', key: 'count', width: 15 },
  ];

  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM contacts
    WHERE org_id = ${orgId}
      AND created_at >= ${from}::date
      AND created_at < (${to}::date + interval '1 day')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      count: Number(r.count),
    });
  }
}

export async function buildAppointmentsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Lịch hẹn');
  sheet.columns = [
    { header: 'Trạng thái', key: 'status', width: 20 },
    { header: 'Số lượng', key: 'count', width: 12 },
  ];

  const dateFilter = { gte: new Date(from), lte: new Date(to) };
  const stats = await prisma.appointment.groupBy({
    by: ['status'],
    where: { orgId, appointmentDate: dateFilter },
    _count: true,
  });

  for (const s of stats) {
    sheet.addRow({ status: s.status, count: s._count });
  }
}

export async function buildStaffSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Nhân viên');
  sheet.columns = [
    { header: 'Họ và tên', key: 'fullName', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Vai trò', key: 'role', width: 12 },
    { header: 'Tổng tin gửi', key: 'sentCount', width: 14 },
    { header: 'Từ CRM web', key: 'sentFromCrm', width: 14 },
    { header: 'Từ điện thoại', key: 'sentFromPhone', width: 14 },
    { header: 'Số cuộc trò chuyện', key: 'uniqueThreads', width: 20 },
    { header: 'Gửi lần đầu', key: 'firstSent', width: 20 },
    { header: 'Gửi lần cuối', key: 'lastSent', width: 20 },
  ];

  // Bold header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };

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

  const fmtDate = (d: Date | null) =>
    d ? d.toISOString().replace('T', ' ').slice(0, 19) : '—';

  for (const r of rows) {
    sheet.addRow({
      fullName: r.full_name,
      email: r.email,
      role: r.role,
      sentCount: Number(r.sent_count),
      sentFromCrm: Number(r.sent_from_crm),
      sentFromPhone: Number(r.sent_from_phone),
      uniqueThreads: Number(r.unique_threads),
      firstSent: fmtDate(r.first_sent),
      lastSent: fmtDate(r.last_sent),
    });
  }

  // Add summary row at bottom
  const totalSent = rows.reduce((sum, r) => sum + Number(r.sent_count), 0);
  const totalCrm = rows.reduce((sum, r) => sum + Number(r.sent_from_crm), 0);
  const totalPhone = rows.reduce((sum, r) => sum + Number(r.sent_from_phone), 0);
  sheet.addRow({});
  const summaryRow = sheet.addRow({
    fullName: 'TỔNG',
    sentCount: totalSent,
    sentFromCrm: totalCrm,
    sentFromPhone: totalPhone,
  });
  summaryRow.font = { bold: true };
}

export async function buildZaloAccountsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Tài khoản Zalo');
  sheet.columns = [
    { header: 'Tên hiển thị', key: 'displayName', width: 25 },
    { header: 'SĐT/Zalo UID', key: 'phone', width: 20 },
    { header: 'Chủ tài khoản', key: 'ownerName', width: 22 },
    { header: 'Trạng thái', key: 'status', width: 14 },
    { header: 'Tin đã gửi', key: 'sentCount', width: 12 },
    { header: 'Tin đã nhận', key: 'receivedCount', width: 12 },
    { header: 'Tổng tin', key: 'totalMessages', width: 12 },
    { header: 'Số cuộc trò chuyện', key: 'uniqueThreads', width: 20 },
    { header: 'Số khách hàng', key: 'uniqueContacts', width: 16 },
    { header: 'Hoạt động lần cuối', key: 'lastAt', width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };

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

  const fmtDate = (d: Date | null) =>
    d ? d.toISOString().replace('T', ' ').slice(0, 19) : '—';

  for (const r of rows) {
    sheet.addRow({
      displayName: r.display_name || '—',
      phone: r.phone || r.zalo_uid || '—',
      ownerName: r.owner_name || '—',
      status: r.status === 'connected' ? 'Đang kết nối' : 'Mất kết nối',
      sentCount: Number(r.sent_count),
      receivedCount: Number(r.received_count),
      totalMessages: Number(r.sent_count) + Number(r.received_count),
      uniqueThreads: Number(r.unique_threads),
      uniqueContacts: Number(r.unique_contacts),
      lastAt: fmtDate(r.last_at),
    });
  }

  // Totals
  const totalSent = rows.reduce((s, r) => s + Number(r.sent_count), 0);
  const totalReceived = rows.reduce((s, r) => s + Number(r.received_count), 0);
  sheet.addRow({});
  const summaryRow = sheet.addRow({
    displayName: 'TỔNG',
    sentCount: totalSent,
    receivedCount: totalReceived,
    totalMessages: totalSent + totalReceived,
  });
  summaryRow.font = { bold: true };
}