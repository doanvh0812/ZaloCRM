<template>
  <div
    class="chat-contact-panel d-flex flex-column"
    style="width: 320px; border-left: 1px solid #E5E7EB; height: 100%; overflow-y: auto; flex-shrink: 0; background: #FFFFFF;"
  >
    <!-- Header -->
    <div class="pa-3 d-flex align-center" style="border-bottom: 1px solid #E5E7EB;">
      <v-icon :icon="isGroup ? 'mdi-account-group' : 'mdi-account-details'" class="mr-2" color="primary" />
      <span class="font-weight-medium" style="color: var(--text-primary, #1A1A2E);">
        {{ isGroup ? 'Thông tin nhóm' : 'Thông tin khách hàng' }}
      </span>
      <v-spacer />
      <v-btn icon size="small" variant="text" @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Form -->
    <div class="pa-3">
      <v-text-field v-model="form.fullName" :label="isGroup ? 'Tên nhóm' : 'Họ tên'" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-if="!isGroup" v-model="form.phone" label="Số điện thoại" density="compact" variant="outlined" class="mb-2" hide-details />
      <v-text-field v-if="!isGroup" v-model="form.email" label="Email" type="email" density="compact" variant="outlined" class="mb-2" hide-details />

      <v-select v-model="form.source" label="Nguồn" :items="SOURCE_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-select v-model="form.status" label="Trạng thái" :items="STATUS_OPTIONS" item-title="text" item-value="value"
        density="compact" variant="outlined" clearable class="mb-2" hide-details />

      <v-text-field v-if="!isGroup" v-model="form.firstContactDate" label="Ngày tiếp nhận" type="date"
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-text-field v-if="!isGroup" v-model="form.nextAppointmentDate" label="Hẹn tái khám" type="date"
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-combobox v-model="form.tags" label="Tags" multiple chips closable-chips
        density="compact" variant="outlined" class="mb-2" hide-details />

      <v-textarea v-model="form.notes" label="Ghi chú" rows="2" auto-grow
        density="compact" variant="outlined" class="mb-3" hide-details />

      <v-btn color="primary" block :loading="saving" @click="saveContact">Lưu thông tin</v-btn>

      <v-alert v-if="saveSuccess" type="success" density="compact" class="mt-2" closable @click:close="saveSuccess = false">
        Đã lưu thành công!
      </v-alert>
      <v-alert v-if="saveError" type="error" density="compact" class="mt-2" closable @click:close="saveError = false">
        Lưu thất bại, thử lại!
      </v-alert>

      <!-- ───── Group members section (only for groups) ───── -->
      <div v-if="isGroup" class="mt-4">
        <div class="d-flex align-center mb-2">
          <v-icon size="18" class="mr-1">mdi-account-multiple</v-icon>
          <span class="text-subtitle-2 font-weight-medium">Thành viên</span>
          <span v-if="membersInfo" class="text-caption ml-1" style="color: #64748B;">
            ({{ membersInfo.totalMembers }})
          </span>
          <v-spacer />
          <v-btn icon size="x-small" variant="text" :loading="loadingMembers" @click="loadMembers">
            <v-icon size="18">mdi-refresh</v-icon>
          </v-btn>
        </div>

        <v-text-field
          v-if="membersInfo && membersInfo.members.length > 0"
          v-model="memberSearch"
          placeholder="Tìm tên..."
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="mdi-magnify"
          class="mb-2"
          clearable
        />

        <div v-if="loadingMembers && !membersInfo" class="text-center py-3">
          <v-progress-circular indeterminate size="24" color="primary" />
        </div>

        <div v-else-if="membersError" class="text-caption pa-2" style="color: #DC2626;">
          {{ membersError }}
        </div>

        <div v-else-if="membersInfo" class="members-list">
          <div
            v-for="m in filteredMembers"
            :key="m.uid"
            class="member-row d-flex align-center"
          >
            <v-avatar size="32" class="mr-2">
              <v-img v-if="m.avatar" :src="m.avatar" />
              <span v-else style="font-size: 13px; color: #475569;">{{ initial(m.displayName || m.zaloName) }}</span>
            </v-avatar>
            <div style="min-width: 0; flex: 1;">
              <div class="text-body-2 font-weight-medium text-truncate" :title="m.displayName || m.zaloName">
                {{ m.displayName || m.zaloName || 'Thành viên' }}
              </div>
              <div v-if="m.role !== 'member'" class="text-caption" style="color: #64748B;">
                {{ m.role === 'owner' ? '👑 Trưởng nhóm' : '⭐ Phó nhóm' }}
              </div>
            </div>
          </div>

          <div v-if="filteredMembers.length === 0" class="text-caption text-center py-2" style="color: #94A3B8;">
            Không tìm thấy
          </div>
        </div>

        <div v-else class="text-caption text-center py-2" style="color: #94A3B8;">
          Bấm <v-icon size="16">mdi-refresh</v-icon> để tải danh sách
        </div>
      </div>

      <!-- Appointments sub-component (not for groups) -->
      <ChatAppointments
        v-if="props.contactId && !isGroup"
        :contact-id="props.contactId"
        :appointments="contactAppointments"
        @refresh="reloadAppointments"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';
import { api } from '@/api';

interface GroupMember {
  uid: string;
  displayName: string;
  zaloName: string;
  avatar: string;
  role: 'owner' | 'admin' | 'member';
}

interface GroupMembersInfo {
  groupName: string;
  totalMembers: number;
  adminUids: string[];
  ownerUid: string;
  members: GroupMember[];
}

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  conversationId: string | null;
  threadType: string | null;
}>();

const emit = defineEmits<{ close: []; saved: [] }>();

const {
  form, saving, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

const isGroup = computed(() => props.threadType === 'group');

// Group members state
const membersInfo = ref<GroupMembersInfo | null>(null);
const loadingMembers = ref(false);
const membersError = ref('');
const memberSearch = ref('');

const filteredMembers = computed(() => {
  if (!membersInfo.value) return [];
  const q = memberSearch.value.trim().toLowerCase();
  if (!q) return membersInfo.value.members;
  return membersInfo.value.members.filter((m) =>
    (m.displayName || m.zaloName || '').toLowerCase().includes(q)
  );
});

async function loadMembers() {
  if (!props.conversationId || !isGroup.value) return;
  loadingMembers.value = true;
  membersError.value = '';
  try {
    const res = await api.get(`/conversations/${props.conversationId}/members`);
    membersInfo.value = res.data;
  } catch (err: any) {
    membersError.value = err.response?.data?.error || 'Không tải được danh sách';
  } finally {
    loadingMembers.value = false;
  }
}

function initial(name: string) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

// Auto-load members when switching to a group conversation
watch(
  () => [props.conversationId, isGroup.value] as const,
  ([convId, group]) => {
    membersInfo.value = null;
    memberSearch.value = '';
    membersError.value = '';
    if (group && convId) {
      loadMembers();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.members-list {
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  padding: 4px;
}

.member-row {
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.15s ease;
}

.member-row:hover {
  background: #F8FAFC;
}
</style>