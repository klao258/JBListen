import os
import sys
import asyncio
import json
import requests
from dotenv import load_dotenv
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from pathlib import Path
from pymongo import MongoClient
import threading
import time
from datetime import datetime, timedelta, timezone
from telethon.tl.types import User, Channel, Chat

# 加载 .env 环境变量
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
NODE_PUSH_URL = os.getenv("NODE_PUSH_URL")

# 账号信息
ACCOUNTS_FILE = "python/accounts.json"

# 初始化 MongoDB 客户端
mongo_client = MongoClient(MONGO_URI)
db = mongo_client["jblisten"]
users = db["userprofiles"]
collection = db["groupconfigs"]

# 全局缓存 watched 群 ID 列表
watched_group_ids = set()

# 初始化 watched 群列表
async def load_watched_groups():
    global watched_group_ids
    watched_group_ids.clear()
    for group in collection.find({"isWatched": True}, {"groupId": 1}):
        watched_group_ids.add(group["groupId"])

# 刷新群列表60秒一次
def refresh_watched_groups():
    global watched_group_ids
    while True:
        time.sleep(60)  # 每60秒刷新一次
        new_set = set(str(doc["groupId"]) for doc in collection.find({"isWatched": True}))
        watched_group_ids = new_set
        print(f"🔄 watched_group_ids 刷新完毕，共 {len(watched_group_ids)} 个群")

# 判断是否是监听群
def is_group_listen(group_id: int, watched_ids: set[str]) -> bool:
    # 转成字符串
    gid_str = str(group_id)

    # 直接查
    if gid_str in watched_ids:
        return True

    # 负号形式
    neg_gid_str = str(-group_id)
    if neg_gid_str in watched_ids:
        return True

    # -100 前缀封装（只针对正整数）
    if group_id > 0:
        gid_100_str = f"-100{group_id}"
        if gid_100_str in watched_ids:
            return True

    return False

# 推送Node到服务
def push_to_node(payload: dict):
    try:
        res = requests.post(NODE_PUSH_URL, json=payload, timeout=3)
        if res.status_code != 200:
            print(f"❌ 推送node失败，状态码: {res.status_code}，内容: {res.text}")
    except requests.RequestException as e:
        print(f"❌ 推送node失败: {e}")

# 所有消息监听
async def handler_all_messages(client):
    @client.on(events.NewMessage(chats=None))
    async def log_event(event):
        sender = await event.get_sender()
        chat = await event.get_chat()
        print(f"LOG | 群: {getattr(chat, 'title', '')} | 用户: {getattr(sender, 'username', '')} | 内容: {event.text}")

# 关键字监听
async def handler_keyword_reply(client):
    @client.on(events.NewMessage)
    async def listener(event):
        if not event.is_group:
            return # 不是群消息
        
        chat = await event.get_chat()
        groupId = str(event.chat_id) # 群ID负数形式
        groupName = str(getattr(chat, 'title', ''))  # 群组名称

        if not groupId in watched_group_ids:
            return  # 不在监控列表中，忽略
        
        message = str(event.raw_text or '')   # 消息内容
        if not (len(message) <= 16 and message.count('\n') <= 1):
            return # 字数超16 或 换行符超1的过滤
        
        user = users.find_one({ "userId": str(event.sender_id) })
        if user:
            if user.get("isTuo") is True:
                return  # ✅ 如果是托账号，直接跳过处理
            userId = user["userId"]
            username = user.get("username", "")
            nickname = user.get("nickname", "")
        else:
            sender = await event.get_sender()

            if not isinstance(sender, User):
                return  # 忽略非用户发言

            if not sender or getattr(sender, "bot", False):
                return  # 排除匿名管理员 或 机器人消息
        
            userId = str(sender.id) # 用户飞机ID
            username = str(sender.username or '') # 用户名
            nickname = f"{sender.first_name or ''} {sender.last_name or ''}".strip()   # 用户昵称

        if not username:
            return # 排除没有用户名的

        if any(kw in nickname for kw in ['财务', '客服']):
            return   # 排除昵称中带财务, 客服的用户
        
        # 获取消息时间，类型是 datetime.datetime，UTC 时间
        message_time = event.message.date

        # 如果你需要将其转换为东八区（中国时间）
        beijing_time = message_time.astimezone(timezone(timedelta(hours=8)))
        sendDateTime = beijing_time.strftime("%Y-%m-%d %H:%M:%S")
        
        # print(f'👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 群消息 | 群名: {groupName} | 群ID: {groupId}👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 👥 ')
        # print(f'🔥🔥🔥 {userId} | {nickname} | {username} | {sendDateTime}')

        push_to_node({ 
            "groupId": groupId, 
            "groupName": groupName, 
            "userId": userId, 
            "username": username, 
            "nickname": nickname, 
            "message": message,
            "sendDateTime": sendDateTime
        })

# 监听账号区分出来函数
async def listen_account(account):
    phone = account["phone"]
    session_file = account["session"]
    api_id = account["api_id"]
    api_hash = account["api_hash"]
    acc_type = account.get("type", "keywords")

    client = TelegramClient(session_file, api_id, api_hash)
    await client.start()
    print(f"✅ {phone} 登录并开始监听中...")

    # 根据 type 决定监听行为
    if acc_type == "keywords":
        await handler_keyword_reply(client)
    elif acc_type == "allMessages":
        await handler_all_messages(client)
    else:
        print(f"⚠️ 未知账号类型: {acc_type}")

    await client.run_until_disconnected()

# 主函数入口
async def main():
    await load_watched_groups()
    threading.Thread(target=refresh_watched_groups, daemon=True).start()
    with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
        accounts = json.load(f)

    tasks = []
    for acc in accounts:
        tasks.append(asyncio.create_task(listen_account(acc)))
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(main())
