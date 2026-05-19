<template>
  <v-row>
    <v-col v-for="card in cards" :key="card.title" cols="6" sm="4" md="2">
      <v-card
        variant="outlined"
        :class="{ 'kpi-clickable': card.action }"
        @click="card.action && handleClick(card.action)"
      >
        <v-card-text class="text-center pa-3">
          <v-icon :icon="card.icon" :color="card.color" size="32" class="mb-1" />
          <div class="text-h5 font-weight-bold">{{ card.value }}</div>
          <div class="text-caption text-grey">{{ card.title }}</div>
          <div v-if="card.action" class="text-caption mt-1" style="color: #1E40AF; font-weight: 500;">
            Xem →
          </div>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

interface KpiData {
  messagesToday: number;
  messagesUnreplied: number;
  messagesUnread: number;
  appointmentsToday: number;
  newContactsThisWeek: number;
  totalContacts: number;
}

const props = defineProps<{
  kpi: KpiData | null;
}>();

const router = useRouter();

const cards = computed(() => [
  {
    title: 'Tin nhắn hôm nay',
    value: props.kpi?.messagesToday ?? '—',
    icon: 'mdi-chat',
    color: 'primary',
    action: { path: '/chat', query: { filter: 'today' } },
  },
  {
    title: 'Chưa trả lời',
    value: props.kpi?.messagesUnreplied ?? '—',
    icon: 'mdi-chat-alert',
    color: 'warning',
    action: { path: '/chat', query: { filter: 'unreplied' } },
  },
  {
    title: 'Chưa đọc',
    value: props.kpi?.messagesUnread ?? '—',
    icon: 'mdi-email-outline',
    color: 'orange',
    action: { path: '/chat', query: { filter: 'unread' } },
  },
  {
    title: 'Lịch hẹn hôm nay',
    value: props.kpi?.appointmentsToday ?? '—',
    icon: 'mdi-calendar-today',
    color: 'success',
    action: { path: '/appointments', query: { filter: 'today' } },
  },
  {
    title: 'KH mới tuần này',
    value: props.kpi?.newContactsThisWeek ?? '—',
    icon: 'mdi-account-plus',
    color: 'info',
    action: { path: '/contacts', query: { filter: 'new-week' } },
  },
  {
    title: 'Tổng khách hàng',
    value: props.kpi?.totalContacts ?? '—',
    icon: 'mdi-account-group',
    color: 'secondary',
    action: { path: '/contacts' },
  },
]);

function handleClick(action: { path: string; query?: Record<string, string> }) {
  router.push({ path: action.path, query: action.query });
}
</script>

<style scoped>
.kpi-clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.kpi-clickable:hover {
  border-color: #1E40AF !important;
  box-shadow: 0 4px 12px rgba(30, 64, 175, 0.12);
  transform: translateY(-2px);
}
</style>