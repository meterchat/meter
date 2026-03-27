import * as Sentry from "@sentry/nextjs";
import { delimiter } from "@delimiter/sdk";

delimiter.init("dlm_yAz61dOixa_V3xWP0hjlK8VrnWoLN5O6", { debug: true });

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
