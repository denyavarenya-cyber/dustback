import { useColorScheme } from 'react-native';

export interface Theme {
  bg: string;
  surface: string;
  accent: string;
  onAccent: string;
  text: string;
  textSecondary: string;
  border: string;
  successTint: string;
  danger: string;
  dangerBg: string;
}

export const light: Theme = {
  bg: '#F4F7F6',
  surface: '#FFFFFF',
  accent: '#0F7A80',
  onAccent: '#F2F7F5',
  text: '#14201D',
  textSecondary: '#64726E',
  border: '#DCE5E2',
  successTint: '#DFF0F1',
  danger: '#B4453A',
  dangerBg: '#F7E9E7',
};

export const dark: Theme = {
  bg: '#0B1211',
  surface: '#131D1B',
  accent: '#2FA9B0',
  onAccent: '#0B1211',
  text: '#EDF3F1',
  textSecondary: '#94A39F',
  border: '#263330',
  successTint: '#123234',
  danger: '#D97C72',
  dangerBg: '#3A211E',
};

/** Fixed brand colors (share card, splash) — never theme-dependent. */
export const brand = {
  teal: '#0F7A80',
  paper: '#F2F7F5',
};

export const radius = 14;
export const screenPad = 20;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
