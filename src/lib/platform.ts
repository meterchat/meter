import { Capacitor } from "@capacitor/core";

/** True when running inside the native iOS/Android shell */
export const isNative = Capacitor.isNativePlatform();

/** Current platform: "ios" | "android" | "web" */
export const platform = Capacitor.getPlatform() as "ios" | "android" | "web";
