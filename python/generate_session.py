import os
import sys
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from dotenv import load_dotenv
from pathlib import Path

load_dotenv()

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")
PHONE_NUMBER = os.getenv("PHONE_NUMBER")
PASSWORD = os.getenv("PASSWORD", None)
PYTHON_SESSION_FILE = os.getenv("PYTHON_SESSION_FILE", "python/python")

client = TelegramClient(PYTHON_SESSION_FILE, API_ID, API_HASH)

async def main():
    try:
        await client.start(phone=PHONE_NUMBER, password=PASSWORD)

        # string_session = StringSession.save(client.session)

        print("READY", flush=True)
        await client.disconnect()
    except Exception as e:
        print(f"❌ 登录失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
