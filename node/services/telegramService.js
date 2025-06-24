require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const GameType = require('../models/GameType');
const input = require('input');
const fs = require('fs');
const GroupConfig = require('../models/GroupConfig');

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
        configurable: true,
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

  // 当前还在的群组 ID 列表
  const activeGroupIds = new Set(
    allGroups
      .filter(dialog => dialog?.groupId)
      .map(dialog => dialog.groupId.toString())
  );

  // 设置所有“已不在”的群组, 不监听, 不显示在配置列表中
  const result = await GroupConfig.updateMany(
    { groupId: { $nin: Array.from(activeGroupIds) } },
    { $set: { isWatched: false } }
  );
}

// 获取session
const ensureClient = async () => {
  const sessionPath = process.env.NODE_SESSION_FILE;
  const apiId = parseInt(process.env.API_ID);
  const apiHash = process.env.API_HASH;

  let stringSession;

  if (fs.existsSync(sessionPath)) {
    const sessionStr = fs.readFileSync(sessionPath, "utf8").trim();
    stringSession = new StringSession(sessionStr);
    client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    console.log("🔌 已连接 Telegram（使用已有 session）");

    if (!await client.checkAuthorization()) {
      console.error("❌ 现有 session 无效，请删除后重新登录！");
      process.exit(1);
    }
  } else {
    stringSession = new StringSession("");
    client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

    console.log("📲 初次登录 Telegram，等待验证码...");
    await client.start({
      phoneNumber: async () => process.env.PHONE_NUMBER,
      password: async () => process.env.PASSWORD,
      phoneCode: async () => await input.text("node 登陆验证码："),
      onError: err => console.error("❌ 登录错误:", err),
    });

    const sessionStr = client.session.save();
    fs.writeFileSync(sessionPath, sessionStr, "utf8");
  }

  return client;
};

const start = async () => {
  client = await ensureClient();  // 已连接 + 已授权的 client

  console.log('✅ Node TG 登录成功');  // 👈 关键输出标志

  await initGroupsFromTelegram(); // 登录成功后初始化群组
};

module.exports = {
  start
};
