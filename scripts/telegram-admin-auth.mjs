import { createHmac, timingSafeEqual } from "node:crypto";

export function parseAdminTelegramIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean)
  );
}

export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 900) {
  const raw = String(initData || "").trim();
  const token = String(botToken || "").trim();
  if (!raw || !token) return { ok: false, reason: "missing_init_data" };

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const actualBuffer = Buffer.from(hash, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: "invalid_hash" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "invalid_auth_date" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - authDate) > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  let user = null;
  try {
    const rawUser = params.get("user");
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return { ok: false, reason: "invalid_user" };
  }

  if (!user?.id) return { ok: false, reason: "missing_user" };

  return {
    ok: true,
    user: {
      id: String(user.id),
      first_name: String(user.first_name || ""),
      last_name: String(user.last_name || ""),
      username: String(user.username || "")
    }
  };
}

export function isTelegramAdmin(userId, allowedIds) {
  return Boolean(userId && allowedIds?.has(String(userId)));
}
