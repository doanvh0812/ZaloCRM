import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          background: '#F5F7FB',
          surface: '#FFFFFF',
          'surface-variant': '#F0F2F5',
          'surface-light': '#F8F9FA',
          primary: '#2196F3',
          secondary: '#607D8B',
          accent: '#42A5F5',
          error: '#EF5350',
          warning: '#FFA726',
          success: '#66BB6A',
          info: '#42A5F5',
          'on-background': '#1A1A2E',
          'on-surface': '#1A1A2E',
          'on-primary': '#FFFFFF',
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#0A192F',
          surface: '#112240',
          'surface-variant': '#1D2D50',
          'surface-light': '#1a3050',
          primary: '#42A5F5',
          secondary: '#E6F1FF',
          accent: '#42A5F5',
          error: '#FF5252',
          warning: '#FFB74D',
          success: '#4CAF50',
          info: '#42A5F5',
          'on-background': '#E6F1FF',
          'on-surface': '#E6F1FF',
          'on-primary': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'xl' },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VSelect: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VAutocomplete: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VTextarea: { variant: 'outlined', density: 'compact', rounded: 'xl' },
    VCard: { rounded: 'xl', variant: 'flat' },
    VChip: { rounded: 'lg', size: 'small' },
    VDialog: { maxWidth: 600 },
  },
});
