import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// ────────────────────────────────────────────────────────────────────────
// ZaloCRM — Navy Blue + Warm Orange theme
// Navy blue = trust, professionalism (primary actions, headers, links)
// Warm orange = energy, alerts (badges, CTAs, "new" indicators)
// ────────────────────────────────────────────────────────────────────────
export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          background: '#F8FAFC',
          surface: '#FFFFFF',
          'surface-variant': '#F1F5F9',
          'surface-light': '#F8FAFC',
          primary: '#1E40AF',          // Navy blue 800
          'primary-darken-1': '#1E3A8A', // Navy 900
          'primary-lighten-1': '#3B82F6', // Blue 500
          secondary: '#475569',          // Slate 600
          accent: '#F97316',             // Warm orange 500
          'accent-darken-1': '#EA580C',  // Orange 600
          'accent-lighten-1': '#FB923C', // Orange 400
          error: '#DC2626',              // Red 600
          warning: '#F97316',            // Orange (same as accent)
          success: '#16A34A',            // Green 600
          info: '#0284C7',               // Sky 600
          'on-background': '#0F172A',
          'on-surface': '#0F172A',
          'on-primary': '#FFFFFF',
          'on-accent': '#FFFFFF',
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#0F172A',
          surface: '#1E293B',
          'surface-variant': '#334155',
          'surface-light': '#1E293B',
          primary: '#3B82F6',            // Lighter navy for dark mode
          'primary-darken-1': '#1E40AF',
          'primary-lighten-1': '#60A5FA',
          secondary: '#94A3B8',
          accent: '#FB923C',
          'accent-darken-1': '#F97316',
          'accent-lighten-1': '#FDBA74',
          error: '#EF4444',
          warning: '#FB923C',
          success: '#22C55E',
          info: '#38BDF8',
          'on-background': '#F1F5F9',
          'on-surface': '#F1F5F9',
          'on-primary': '#FFFFFF',
          'on-accent': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 'lg' },
    VSelect: { variant: 'outlined', density: 'compact', rounded: 'lg' },
    VAutocomplete: { variant: 'outlined', density: 'compact', rounded: 'lg' },
    VTextarea: { variant: 'outlined', density: 'compact', rounded: 'lg' },
    VCard: { rounded: 'lg', variant: 'flat' },
    VChip: { rounded: 'md', size: 'small' },
    VDialog: { maxWidth: 600 },
  },
});