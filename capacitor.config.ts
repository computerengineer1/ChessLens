import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.chesslens.ar',
  appName: 'ChessLens AR',
  webDir: 'dist',
  server: {
    // Serve the WebView origin over https:// so the page is a secure context
    // and getUserMedia() is available inside the Android WebView.
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false
  }
};

export default config;
