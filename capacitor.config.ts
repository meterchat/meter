import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "chat.meter.app",
  appName: "Meter",
  webDir: "out",
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#111a14",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#111a14",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
  ios: {
    scheme: "Meter",
    contentInset: "automatic",
  },
  android: {
    backgroundColor: "#111a14",
  },
};

export default config;
