"""Telegram user-session message collector for charter sources.

This collector intentionally does only transport/authentication. Parsing, pricing,
deduplication and publication stay in the existing Node aggregation pipeline.

Required environment variables:
  TG_API_ID
  TG_API_HASH
  TG_SESSION

Optional:
  TELEGRAM_SESSION_SOURCES_PATH (default: config/telegram-session-sources.json)
  TELEGRAM_SESSION_POSTS_PATH   (default: /tmp/telegram-session-posts.json)
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.tl.types import ChatInviteAlready


def required_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def load_config(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text("utf-8"))
    sources = [s for s in payload.get("sources", []) if s.get("enabled", True)]
    if not sources:
        raise RuntimeError("No enabled Telegram session sources")
    payload["sources"] = sources
    return payload


def normalized_channel_id(raw: str) -> int | None:
    value = str(raw or "").strip()
    if value.startswith("-100"):
        value = value[4:]
    return int(value) if value.isdigit() else None


async def find_dialog(client: TelegramClient, channel_id: int | None, title: str | None):
    title_key = (title or "").strip().casefold()
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not (getattr(entity, "broadcast", False) or getattr(entity, "megagroup", False)):
            continue
        if channel_id is not None and getattr(entity, "id", None) == channel_id:
            return entity
        if channel_id is None and title_key and title_key in (dialog.name or "").casefold():
            return entity
    return None


async def resolve_source(client: TelegramClient, source: dict[str, Any]):
    telegram = str(source.get("telegram") or "").strip()
    title = str(source.get("title") or source.get("name") or "").strip()

    channel_id = normalized_channel_id(telegram)
    if channel_id is not None:
        entity = await find_dialog(client, channel_id, None)
        if entity is None:
            raise RuntimeError("channel id is not present in the account dialogs")
        return entity

    if title:
        entity = await find_dialog(client, None, title)
        if entity is not None:
            return entity

    invite_match = re.search(r"(?:t\.me/\+|t\.me/joinchat/|^\+)([\w-]+)", telegram)
    if invite_match:
        invite = await client(CheckChatInviteRequest(invite_match.group(1)))
        if isinstance(invite, ChatInviteAlready):
            return invite.chat
        raise RuntimeError("account is not joined to the invite channel")

    if telegram:
        return await client.get_entity(telegram)

    raise RuntimeError("source has neither a resolvable title nor telegram identifier")


async def collect() -> int:
    config_path = Path(os.environ.get("TELEGRAM_SESSION_SOURCES_PATH") or "config/telegram-session-sources.json")
    output_path = Path(os.environ.get("TELEGRAM_SESSION_POSTS_PATH") or "/tmp/telegram-session-posts.json")

    config = load_config(config_path)
    ttl_hours = max(1.0, float(config.get("ttlHours") or 24))
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=ttl_hours)

    api_id = int(required_env("TG_API_ID"))
    api_hash = required_env("TG_API_HASH")
    session = "".join(required_env("TG_SESSION").split()).strip("\"'")

    client = TelegramClient(StringSession(session), api_id, api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        await client.disconnect()
        raise RuntimeError("TG_SESSION is no longer authorized")

    posts: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []

    try:
        for source in config["sources"]:
            source_id = str(source.get("id") or source.get("name") or "telegram-session").strip()
            source_label = str(source.get("name") or source_id).strip()
            try:
                entity = await resolve_source(client, source)
                scanned = 0
                accepted = 0

                async for message in client.iter_messages(entity, limit=300):
                    if message.date and message.date < since:
                        break
                    scanned += 1
                    text = (message.message or "").strip()
                    if not text:
                        continue
                    posts.append({
                        "sourceId": f"telegram-session:{source_id}",
                        "sourceLabel": source_label,
                        "postId": int(message.id),
                        "postedAt": message.date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "text": text,
                    })
                    accepted += 1

                statuses.append({
                    "id": f"telegram-session:{source_id}",
                    "status": "ok",
                    "postsScanned": scanned,
                    "postsAccepted": accepted,
                })
            except Exception as exc:  # one unavailable source must not block the others
                statuses.append({
                    "id": f"telegram-session:{source_id}",
                    "status": "error",
                    "reason": str(exc),
                })
    finally:
        await client.disconnect()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "ttlHours": ttl_hours,
        "statuses": statuses,
        "posts": posts,
    }, ensure_ascii=False, indent=2) + "\n", "utf-8")

    print(f"Telegram session collector: {len(posts)} posts from {len(config['sources'])} source(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(collect()))
    except Exception as exc:
        print(f"Telegram session collector failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
