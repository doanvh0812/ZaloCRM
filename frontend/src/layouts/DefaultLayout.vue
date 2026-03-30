<template>
  <v-app :class="{ 'liquid-bg': isDark }">
    <!-- Top bar -->
    <v-app-bar density="comfortable" flat elevation="0">
      <v-app-bar-nav-icon @click="drawer = !drawer" />

      <!-- Logo + Title -->
      <div class="d-flex align-center" style="gap: 10px;">
        <div
          class="d-flex align-center justify-center rounded-circle"
          style="width: 32px; height: 32px; background: #2196F3;"
        >
          <v-icon size="18" color="white">mdi-message-text</v-icon>
        </div>
        <v-app-bar-title>
          <span class="font-weight-bold" style="font-size: 1.1rem;">Zalo</span><span style="color: #2196F3; font-weight: 600;">CRM</span>
        </v-app-bar-title>
      </div>

      <!-- Global search -->
      <GlobalSearch class="mx-4" />

      <v-spacer />

      <!-- Online status -->
      <div
        class="d-flex align-center mr-3 px-3 py-1 rounded-pill"
        style="background: rgba(76,175,80,0.08); border: 1px solid rgba(76,175,80,0.15);"
      >
        <span
          class="status-dot"
          style="width: 8px; height: 8px; border-radius: 50%; background: #66BB6A; display: inline-block; margin-right: 8px;"
        ></span>
        <span class="text-caption font-weight-medium" style="color: #66BB6A; letter-spacing: 0.5px;">ONLINE</span>
      </div>

      <span class="text-body-2 mr-2" v-if="authStore.user" style="font-weight: 500;">{{ authStore.user.fullName }}</span>
      <NotificationBell />
      <v-btn icon variant="text" size="small" @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon variant="text" size="small" @click="logout">
        <v-icon>mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar navigation — icon rail style like Figma -->
    <v-navigation-drawer v-model="drawer" :rail="rail" permanent @click="rail = false" :width="220">
      <v-list density="compact" nav class="mt-2">
        <v-list-item
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :prepend-icon="item.icon"
          :title="item.title"
          :value="item.path"
          rounded="xl"
          class="mb-1 mx-2 nav-item"
          active-class="nav-item-active"
        />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-chevron-left"
            title="Thu gọn"
            @click.stop="rail = !rail"
            rounded="xl"
            class="mx-2"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();

const drawer = ref(true);
const rail = ref(true);
const isDark = ref(localStorage.getItem('theme') === 'dark');

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
});

const menuItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/' },
  { title: 'Tin nhắn', icon: 'mdi-message-text-outline', path: '/chat' },
  { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts' },
  { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts' },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments' },
  { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports' },
  { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings' },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings' },
];

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.nav-item {
  font-weight: 500;
  font-size: 0.875rem;
  color: #6B7280;
}
.nav-item-active {
  background: #E3F2FD !important;
  color: #2196F3 !important;
}
.nav-item-active .v-icon {
  color: #2196F3 !important;
}
</style>
