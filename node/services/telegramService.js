require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession, StoreSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const GameType = require('../models/GameType');
const input = require('input');
const fs = require('fs');
const GroupConfig = require('../models/GroupConfig');
const userMatchHandler = require('./userMatchHandler');

let client;

// 记录群组保存本地
const saveGroups = (allGroups) => {
  fs.writeFileSync("groups.json", JSON.stringify(allGroups, null, 2));
  console.log("📁 已保存群组到 groups.json（不包含频道）");
}

// 初始化群组到数据库
const initGroupsFromTelegram = async () => {
  const dialogs = await client.getDialogs({ limit: 100 });
  const allGroups = dialogs
    .filter(d => d.isGroup && d.id && d.title)
    .map(g => {
      const groupId = g.id?.toString?.();
      const groupName = g.title?.trim();
      if (!groupId || !groupName) return null;
      return { groupId, groupName };
    })
    .filter(Boolean);

  const gameTypes = await GameType.find();

  // 可自定义排除的群组 ID
  const blacklist = [
    "-4765924067",    // 推广小组
    "-1002349989107", // 推广小组
    // "-1002565000622", // 转发测试
    "-1002630105898", // 积分测试
    "-4714300774",    // 积分测试
  ]; 

  saveGroups(allGroups)

  for (const dialog of allGroups) {
    if(!dialog?.groupId) continue;
   
    const groupId = dialog.groupId.toString();
    const groupName = dialog.groupName;

    if (blacklist.includes(groupId)) continue;

    let group = await GroupConfig.findOne({ groupId });
    if (!group) {
      group = new GroupConfig({
        groupId,
        groupName,
        isWatched: true,
        gameConfigs: gameTypes.map(gt => ({ gameType: gt.name, gameLabel: gt.label,  keywords: [] }))
      });
      await group.save();
      console.log(`✅ 插入新群：${groupName} (${groupId})`);
    } else {
      const existTypes = new Set(group.gameConfigs.map(gc => gc.gameType));
      let updated = false;
      for (const gt of gameTypes) {
        if (!existTypes.has(gt.name)) {
          group.gameConfigs.push({ gameType: gt.name, gameLabel: gt.label, keywords: [] });
          updated = true;
        }
      }
      if (updated) {
        await group.save();
        console.log(`🔧 补全群：${ group.groupName } 的游戏配置`);
      }
    }
  }
}

// 初始化
const session = new StoreSession(process.env.NODE_SESSION_FILE); // 自动保存文件
const start = async () => {
  client = new TelegramClient(session, parseInt(process.env.API_ID), process.env.API_HASH,{ 
    connectionRetries: 5 
  });

  await client.start({
    phoneNumber: async () => process.env.PHONE_NUMBER,
    password: async () => process.env.PASSWORD,
    phoneCode: async () => await input.text('node服务启动 - Code: '),
    onError: err => console.log(err),
  });

  console.log('✅ TG 登录成功');  // 👈 关键输出标志

  await initGroupsFromTelegram(); // 登录成功后初始化群组

  // client.addEventHandler(async event => {
  //   const msg = event.message;

  //   // 正确地从 message 获取 chat 和 sender
  //   const chat = await msg.getChat();       // ✅ 获取群或频道信息
  //   const sender = await msg.getSender();   // ✅ 获取发消息的用户信息
  //   const groupId = chat?.id?.toString();   // 群ID（可能是chatId或channelId）
  //   const senderId = sender?.id?.toString();
  //   const message = msg.message;

  //   // 消息、群id、发送者信息、机器人发送 直接return
  //   if (!msg || !groupId || !sender || sender.bot || !senderId || !message) return;
  //   await userMatchHandler.handleMessage({ client, event, chat, sender, groupId, senderId, message });
  // }, new NewMessage({}));
};

const getClient = () => {
  if (!client) throw new Error('Telegram 实例为空');
  return client;
}

module.exports = {
  start,
  getClient
};
