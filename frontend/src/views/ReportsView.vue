<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h4">Báo cáo</h1>
      <v-spacer />
      <v-text-field
        v-model="dateFrom"
        label="Từ ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-text-field
        v-model="dateTo"
        label="Đến ngày"
        type="date"
        density="compact"
        variant="outlined"
        style="max-width: 180px;"
        class="mr-2"
        hide-details
      />
      <v-btn color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="fetchReport">Xem</v-btn>
      <v-btn color="success" prepend-icon="mdi-file-excel" class="ml-2" :loading="exporting" @click="exportExcel">Xuất Excel</v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="messages">Tin nhắn</v-tab>
      <v-tab value="contacts">Khách hàng</v-tab>
      <v-tab value="appointments">Lịch hẹn</v-tab>
      <v-tab v-if="auth.isAdmin" value="staff">
        <v-icon size="18" class="mr-1">mdi-account-group</v-icon>
        Nhân viên
      </v-tab>
      <v-tab v-if="auth.isAdmin" value="zalo-accounts">
        <v-icon size="18" class="mr-1">mdi-cellphone-link</v-icon>
        Tài khoản Zalo
      </v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="messages">
        <v-data-table
          :headers="msgHeaders"
          :items="msgData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>

      <v-window-item value="contacts">
        <v-data-table
          :headers="contactHeaders"
          :items="contactData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>

      <v-window-item value="appointments">
        <v-data-table
          :headers="aptHeaders"
          :items="aptData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        />
      </v-window-item>

      <!-- ───── Staff report tab (Owner/Admin only) ───── -->
      <v-window-item value="staff">
        <!-- Summary cards -->
        <v-row dense class="mb-4">
          <v-col cols="12" sm="4">
            <v-card class="pa-4 kpi-card">
              <div class="text-caption text-medium-emphasis">Tổng tin gửi</div>
              <div class="text-h5 font-weight-bold mt-1">{{ staffTotalSent.toLocaleString() }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="4">
            <v-card class="pa-4 kpi-card kpi-accent">
              <div class="text-caption text-medium-emphasis">Nhân viên hoạt động</div>
              <div class="text-h5 font-weight-bold mt-1">{{ staffActive }} / {{ staffTotal }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="4">
            <v-card class="pa-4 kpi-card kpi-success">
              <div class="text-caption text-medium-emphasis">Trung bình / người</div>
              <div class="text-h5 font-weight-bold mt-1">
                {{ staffActive ? Math.round(staffTotalSent / staffActive).toLocaleString() : 0 }}
              </div>
            </v-card>
          </v-col>
        </v-row>

        <!-- Bar chart -->
        <v-card class="pa-4 mb-4" v-if="staffData.length > 0">
          <div class="text-subtitle-1 font-weight-medium mb-3">Số tin nhắn theo nhân viên</div>
          <div style="height: 320px;">
            <Bar v-if="chartData" :data="chartData" :options="chartOptions" />
          </div>
        </v-card>

        <!-- Detail table -->
        <v-data-table
          :headers="staffHeaders"
          :items="staffData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        >
          <template #item.role="{ value }">
            <v-chip size="x-small" :color="roleColor(value)">{{ roleLabel(value) }}</v-chip>
          </template>
          <template #item.sentCount="{ value }">
            <span class="font-weight-medium">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.sentFromCrm="{ value }">
            <span style="color: #1E40AF;">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.sentFromPhone="{ value }">
            <span style="color: #F97316;">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.lastSent="{ value }">
            {{ value ? new Date(value).toLocaleString('vi-VN') : '—' }}
          </template>
        </v-data-table>
      </v-window-item>

      <!-- ───── Zalo accounts report tab (Owner/Admin only) ───── -->
      <v-window-item value="zalo-accounts">
        <!-- Summary cards -->
        <v-row dense class="mb-4">
          <v-col cols="12" sm="3">
            <v-card class="pa-4 kpi-card">
              <div class="text-caption text-medium-emphasis">Tài khoản hoạt động</div>
              <div class="text-h5 font-weight-bold mt-1">{{ zaloActiveCount }} / {{ zaloTotalCount }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="3">
            <v-card class="pa-4 kpi-card kpi-accent">
              <div class="text-caption text-medium-emphasis">Tin đã gửi</div>
              <div class="text-h5 font-weight-bold mt-1">{{ zaloTotalSent.toLocaleString() }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="3">
            <v-card class="pa-4 kpi-card kpi-success">
              <div class="text-caption text-medium-emphasis">Tin đã nhận</div>
              <div class="text-h5 font-weight-bold mt-1">{{ zaloTotalReceived.toLocaleString() }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" sm="3">
            <v-card class="pa-4 kpi-card">
              <div class="text-caption text-medium-emphasis">Tổng tin nhắn</div>
              <div class="text-h5 font-weight-bold mt-1">{{ (zaloTotalSent + zaloTotalReceived).toLocaleString() }}</div>
            </v-card>
          </v-col>
        </v-row>

        <!-- Bar chart -->
        <v-card class="pa-4 mb-4" v-if="zaloChartData">
          <div class="text-subtitle-1 font-weight-medium mb-3">Lưu lượng tin nhắn theo tài khoản Zalo</div>
          <div style="height: 320px;">
            <Bar :data="zaloChartData" :options="zaloChartOptions" />
          </div>
        </v-card>

        <!-- Detail table -->
        <v-data-table
          :headers="zaloHeaders"
          :items="zaloData"
          :loading="loading"
          no-data-text="Không có dữ liệu"
        >
          <template #item.status="{ value }">
            <v-chip size="x-small" :color="value === 'connected' ? 'success' : 'default'">
              {{ value === 'connected' ? 'Đang kết nối' : 'Mất kết nối' }}
            </v-chip>
          </template>
          <template #item.sentCount="{ value }">
            <span style="color: #1E40AF; font-weight: 500;">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.receivedCount="{ value }">
            <span style="color: #16A34A; font-weight: 500;">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.totalMessages="{ value }">
            <span class="font-weight-bold">{{ value.toLocaleString() }}</span>
          </template>
          <template #item.lastAt="{ value }">
            {{ value ? new Date(value).toLocaleString('vi-VN') : '—' }}
          </template>
        </v-data-table>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const auth = useAuthStore();

// Date defaults: last 30 days
const today = new Date();
const prior = new Date(today);
prior.setDate(prior.getDate() - 30);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

const dateFrom = ref(fmt(prior));
const dateTo = ref(fmt(today));
const tab = ref('messages');
const loading = ref(false);
const exporting = ref(false);

const msgData = ref<{ date: string; sent: number; received: number }[]>([]);
const contactData = ref<{ label: string; count: number }[]>([]);
const aptData = ref<{ label: string; count: number }[]>([]);

interface StaffRow {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  sentCount: number;
  sentFromCrm: number;
  sentFromPhone: number;
  uniqueThreads: number;
  firstSent: string | null;
  lastSent: string | null;
}

interface ZaloAccountRow {
  accountId: string;
  displayName: string;
  zaloUid: string | null;
  phone: string | null;
  ownerName: string;
  status: string;
  sentCount: number;
  receivedCount: number;
  totalMessages: number;
  uniqueThreads: number;
  uniqueContacts: number;
  firstAt: string | null;
  lastAt: string | null;
}
const staffData = ref<StaffRow[]>([]);
const staffTotalSent = ref(0);
const staffActive = ref(0);
const staffTotal = ref(0);

const zaloData = ref<ZaloAccountRow[]>([]);
const zaloTotalSent = ref(0);
const zaloTotalReceived = ref(0);
const zaloActiveCount = ref(0);
const zaloTotalCount = ref(0);

const msgHeaders = [
  { title: 'Ngày', key: 'date' },
  { title: 'Đã gửi', key: 'sent' },
  { title: 'Đã nhận', key: 'received' },
];

const contactHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

const aptHeaders = [
  { title: 'Phân loại', key: 'label' },
  { title: 'Số lượng', key: 'count' },
];

const staffHeaders = [
  { title: 'Nhân viên', key: 'fullName' },
  { title: 'Vai trò', key: 'role' },
  { title: 'Tổng tin', key: 'sentCount', align: 'end' as const },
  { title: 'Từ CRM', key: 'sentFromCrm', align: 'end' as const },
  { title: 'Từ ĐT', key: 'sentFromPhone', align: 'end' as const },
  { title: 'Cuộc trò chuyện', key: 'uniqueThreads', align: 'end' as const },
  { title: 'Gửi gần nhất', key: 'lastSent' },
];

const zaloHeaders = [
  { title: 'Tài khoản', key: 'displayName' },
  { title: 'SĐT', key: 'phone' },
  { title: 'Chủ', key: 'ownerName' },
  { title: 'Trạng thái', key: 'status' },
  { title: 'Đã gửi', key: 'sentCount', align: 'end' as const },
  { title: 'Đã nhận', key: 'receivedCount', align: 'end' as const },
  { title: 'Tổng', key: 'totalMessages', align: 'end' as const },
  { title: 'Cuộc trò chuyện', key: 'uniqueThreads', align: 'end' as const },
  { title: 'Khách', key: 'uniqueContacts', align: 'end' as const },
  { title: 'Hoạt động cuối', key: 'lastAt' },
];

const zaloChartData = computed(() => {
  const active = zaloData.value.filter((z) => z.totalMessages > 0);
  if (active.length === 0) return null;
  return {
    labels: active.map((z) => z.displayName),
    datasets: [
      {
        label: 'Đã gửi',
        data: active.map((z) => z.sentCount),
        backgroundColor: '#1E40AF',
        borderRadius: 4,
      },
      {
        label: 'Đã nhận',
        data: active.map((z) => z.receivedCount),
        backgroundColor: '#16A34A',
        borderRadius: 4,
      },
    ],
  };
});

const zaloChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: false, ticks: { font: { size: 11 } } },
    y: { beginAtZero: true, ticks: { precision: 0 } },
  },
  plugins: {
    legend: { position: 'top' as const },
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}`,
      },
    },
  },
};

// Chart data — top 15 nhân viên gửi nhiều nhất
const chartData = computed(() => {
  const top = [...staffData.value]
    .filter((s) => s.sentCount > 0)
    .slice(0, 15);
  if (top.length === 0) return null;
  return {
    labels: top.map((s) => s.fullName),
    datasets: [
      {
        label: 'Tin nhắn đã gửi',
        data: top.map((s) => s.sentCount),
        backgroundColor: '#1E40AF',
        borderRadius: 6,
        barThickness: 24,
      },
    ],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  scales: {
    x: { beginAtZero: true, ticks: { precision: 0 } },
    y: { ticks: { font: { size: 12 } } },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ctx.parsed.x.toLocaleString()} tin nhắn`,
      },
    },
  },
};

function roleColor(role: string) {
  return { owner: 'error', admin: 'primary', member: 'default' }[role] || 'default';
}
function roleLabel(role: string) {
  return { owner: 'Chủ', admin: 'Quản lý', member: 'Nhân viên' }[role] || role;
}

async function fetchReport() {
  loading.value = true;
  try {
    const params = { from: dateFrom.value, to: dateTo.value };
    if (tab.value === 'messages') {
      const res = await api.get('/reports/messages', { params });
      msgData.value = res.data.data || res.data;
    } else if (tab.value === 'contacts') {
      const res = await api.get('/reports/contacts', { params });
      const raw = res.data;
      const rows: { label: string; count: number }[] = [];
      const days = Array.isArray(raw.newPerDay) ? raw.newPerDay : [];
      for (const d of days) {
        rows.push({ label: `Mới ${d.date}`, count: Number(d.count ?? 0) });
      }
      for (const t of (raw.treatmentProgress ?? [])) {
        rows.push({ label: `Tiến triển: ${t.status}`, count: Number(t.count ?? 0) });
      }
      for (const m of (raw.medicationStatus ?? [])) {
        rows.push({ label: `Thuốc: ${m.status}`, count: Number(m.count ?? 0) });
      }
      contactData.value = rows;
    } else if (tab.value === 'appointments') {
      const res = await api.get('/reports/appointments', { params });
      const raw = res.data;
      const rows: { label: string; count: number }[] = [];
      for (const s of (raw.byStatus ?? [])) {
        rows.push({ label: `Trạng thái: ${s.status}`, count: Number(s.count ?? 0) });
      }
      for (const t of (raw.byType ?? [])) {
        rows.push({ label: `Loại: ${t.type ?? '—'}`, count: Number(t.count ?? 0) });
      }
      aptData.value = rows;
    } else if (tab.value === 'staff') {
      const res = await api.get('/reports/staff', { params });
      staffData.value = res.data.data || [];
      staffTotalSent.value = res.data.totalSent || 0;
      staffActive.value = res.data.activeStaff || 0;
      staffTotal.value = res.data.totalStaff || 0;
    } else if (tab.value === 'zalo-accounts') {
      const res = await api.get('/reports/zalo-accounts', { params });
      zaloData.value = res.data.data || [];
      zaloTotalSent.value = res.data.totalSent || 0;
      zaloTotalReceived.value = res.data.totalReceived || 0;
      zaloActiveCount.value = res.data.activeAccounts || 0;
      zaloTotalCount.value = res.data.totalAccounts || 0;
    }
  } catch (err) {
    console.error('Report fetch error:', err);
  } finally {
    loading.value = false;
  }
}

async function exportExcel() {
  exporting.value = true;
  try {
    const res = await api.get('/reports/export', {
      params: { type: tab.value, from: dateFrom.value, to: dateTo.value },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${tab.value}-${dateFrom.value}-${dateTo.value}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Export error:', err);
  } finally {
    exporting.value = false;
  }
}

// Auto-fetch when tab changes
watch(tab, () => fetchReport());

// Initial load
fetchReport();
</script>