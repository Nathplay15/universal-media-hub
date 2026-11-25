import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.universalmediahub',
  appName: 'MediaHub',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0b0b0f',
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#0b0b0f',
      launchShowDuration: 800,
    },
  },
};

export default config;
