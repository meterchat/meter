import * as Sentry from "@sentry/nextjs";
import { delimiter } from "@delimiter/sdk";

delimiter.init("dlm_Y0d6BEpBNVVYwCD_U4qSRVuzUaBMeF9R");

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
