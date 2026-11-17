// Entry point for the browser bundle: exposes the anonymization engine to the page as window.Engine.
// Everything runs locally; nothing is sent anywhere.
import { check, DEFAULT_POLICY, extract, forgetUpload, preview, readUpload, setColumnKind, suggest } from "./engine.ts";

// crypto.randomUUID is missing in some older browsers and non-secure contexts.
if (!globalThis.crypto.randomUUID) {
  (globalThis.crypto as { randomUUID: () => string }).randomUUID = () =>
    "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
}

(globalThis as Record<string, unknown>).Engine = { check, suggest, preview, extract, readUpload, setColumnKind, forgetUpload, DEFAULT_POLICY };
