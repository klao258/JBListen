import os
import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from pathlib import Path
from telethon.errors import SessionPasswordNeededError


ACCOUNTS_FILE = "python/accounts.json"

# 登陆方法
async def login_account(account):
    phone = account["phone"]
    session_file = account["session"]
    api_id = account["api_id"]
    api_hash = account["api_hash"]
    password = account.get("password", None)

    # 确保 session 文件夹存在
    session_dir = os.path.dirname(session_file)
    if session_dir and not os.path.exists(session_dir):
        os.makedirs(session_dir)

    client = TelegramClient(session_file, api_id, api_hash)

    try:
        await client.connect()

        if await client.is_user_authorized():
            print(f"✅ 已登录，跳过：{phone}")
            return

        print(f"\n=== 🔐 准备登录账号: {phone} ===")
        await client.start(phone=phone, password=password)
        print(f"✅ 登录成功: {phone}")

    except SessionPasswordNeededError:
        print(f"⚠️ 需要 2FA 密码: {phone}")
    except Exception as e:
        print(f"❌ 登录失败 {phone}: {e}")
    finally:
        await client.disconnect()
        await asyncio.sleep(1)  # 防止 SQLite 锁定

# 异步主函数
async def main():
    print("python 准备登陆")
    if not os.path.exists(ACCOUNTS_FILE):
        print(f"❌ 未找到 {ACCOUNTS_FILE}")
        sys.exit(1)

    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        accounts = json.load(f)

    for account in accounts:
        await login_account(account)
    
    print("READY", flush=True)

if __name__ == "__main__":
    asyncio.run(main())