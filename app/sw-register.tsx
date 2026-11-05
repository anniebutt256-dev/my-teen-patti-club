"use client";
import { useEffect } from "react";

/** Registers the PWA service worker (app shell caching). */
export default function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Install prompts are a progressive enhancement; ignore failures.
      });
    }
  }, []);
  return null;
}
