import { getDb } from "./queries/connection";
import { settings } from "@db/schema";
import { eq } from "drizzle-orm";
import type { AppSettings } from "@contracts/types";

export const SETTINGS_KEY = "app";

export const DEFAULT_SETTINGS: AppSettings = {
  tokenPacks: [
    { id: "pack-100", tokens: 100, priceCents: 500, label: "100 tokens — $5" },
    { id: "pack-300", tokens: 300, priceCents: 1200, label: "300 tokens — $12" },
    { id: "pack-800", tokens: 800, priceCents: 2500, label: "800 tokens — $25" },
  ],
  prices: {
    perSlideBase: 2,
    perImageSlide: 2,
    perTts: 1,
    levelMultiplier: { beginner: 1.0, intermediate: 1.2, advanced: 1.5 },
  },
  googleSheetUrl: "https://docs.google.com/spreadsheets/d/REPLACE_ME",
  platformAiKeys: {},
  featureFlags: { coachEnabled: true, guestDemo: true },
};

/** Read app settings, merged over defaults (missing keys → defaults). */
export async function getSettings(): Promise<AppSettings> {
  try {
    const row = await getDb().query.settings.findFirst({
      where: eq(settings.key, SETTINGS_KEY),
    });
    if (!row) return DEFAULT_SETTINGS;
    const value = row.valueJson as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      prices: { ...DEFAULT_SETTINGS.prices, ...(value.prices ?? {}) },
      platformAiKeys: { ...(value.platformAiKeys ?? {}) },
      featureFlags: { ...DEFAULT_SETTINGS.featureFlags, ...(value.featureFlags ?? {}) },
    };
  } catch (err) {
    console.error("[settings] failed to read, using defaults:", err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(value: AppSettings): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key: SETTINGS_KEY, valueJson: value })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: value } });
}
