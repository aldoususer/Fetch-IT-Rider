import { db } from "./db";
import { defaultPlatformSettings, validatePlatformSettings } from "./platform-policy";
// Read live configuration on the server; never silently ignore a failed read.
export async function platformSettings() {
  const record = await db.platformConfig.findUnique({ where: { id: "platform" } });
  return { version: record?.version ?? 0, settings: record ? validatePlatformSettings(record.settings) : defaultPlatformSettings() };
}
