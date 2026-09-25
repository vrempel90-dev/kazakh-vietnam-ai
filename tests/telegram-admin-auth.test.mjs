import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isTelegramAdmin,
  parseAdminTelegramIds,
  verifyTelegramInitData
} from "../scripts/telegram-admin-auth.mjs";

const botToken = "123456:TEST_TOKEN";
const authDate = Math.floor(Date.now() / 1000);
const user = JSON.stringify({
  id: 16815689,
  first_name: "Admin",
  username: "admin_user"
});

const params = new URLSearchParams({
  auth_date: String(authDate),
  query_id: "AAEAAAE",
  user
});
const dataCheckString = [...params.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, value]) => key + "=" + value)
  .join("\n");
const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
params.set("hash", hash);

const verified = verifyTelegramInitData(params.toString(), botToken, 900);
assert.equal(verified.ok, true);
assert.equal(verified.user.id, "16815689");

const admins = parseAdminTelegramIds("16815689, 42");
assert.equal(isTelegramAdmin("16815689", admins), true);
assert.equal(isTelegramAdmin("99", admins), false);

const tampered = new URLSearchParams(params);
tampered.set("user", JSON.stringify({ id: 99, first_name: "Intruder" }));
assert.equal(verifyTelegramInitData(tampered.toString(), botToken, 900).ok, false);

console.log("Telegram Mini App admin signature and allowlist verification: passed");
