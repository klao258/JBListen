const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length === 0) return 0;

  // 1. 用户涉及群组和游戏类型数量
  const groupSet = new Set();
  const gameSet = new Set();
  const timeDiffs = [];

  logs.forEach((log, idx) => {
    groupSet.add(log.groupId);
    gameSet.add(log.gameType);

    if (idx > 0) {
      const prev = new Date(logs[idx - 1].matchedAt).getTime();
      const curr = new Date(log.matchedAt).getTime();
      const diffSec = Math.abs(curr - prev) / 1000;
      timeDiffs.push(diffSec);
    }
  });

  const isSingleGroup = groupSet.size === 1;
  const isSingleGame = gameSet.size === 1;

  // 2. 高频触发比例（小于3分钟间隔）
  const highFreqRatio = timeDiffs.filter(d => d < 180).length / timeDiffs.length;

  // 3. 评分模型
  let score = 50; // 中性分

  if (isSingleGroup) score -= 10;
  if (isSingleGame) score -= 10;
  if (highFreqRatio >= 0.7) score -= 20;
  if (logs.length >= 1000) score -= 10; // 满库惩罚

  // 加分项：多群多游戏
  score += Math.min(10, groupSet.size * 2 + gameSet.size);

  // 限制范围 [0, 100]
  score = Math.max(0, Math.min(100, score));

  // 4. 映射为概率（Sigmoid函数压缩）
  const probability = 1 / (1 + Math.exp((score - 50) / 6));
  const percent = parseFloat((probability * 100).toFixed(1));

  return percent; // 例如 84.3 表示“84.3% 可能是托”
}

// 计算概率
const calculateTuoProbability = (score) => {
  // score: 0~100（越低越可能是托）
  // 将评分标准化到 [-6, 6] 区间
  const normalized = (50 - score) / 10;

  // 使用 sigmoid 平滑转换为概率（0~1）
  const probability = 1 / (1 + Math.exp(-normalized));

  // 返回百分比，保留一位小数
  return +(probability * 100).toFixed(1);
}

// 记录日志, 单用户最大记录 1000 条日志
const insertUserLog = async (logData) => {
  const { userId, username, nickname, groupId, groupName, sendDateTime, ...matchedGames } = logData;

  // Step 1: 插入新日志（matchedAt 会自动写入）
  await GameMatchLog.create({ userId, username, nickname, groupId, groupName, sendDateTime, ...matchedGames });

  // Step 2: 查询该用户日志总条数
  const count = await GameMatchLog.countDocuments({ userId });

  // Step 3: 如果超过 1000，删除最早的 10 条
  if (count > 1000) {
    const oldest = await GameMatchLog.find({ userId })
      .sort({ matchedAt: 1 }) // 最早的日志
      .limit(10)
      .select('_id');

    const ids = oldest.map(doc => doc._id);
    await GameMatchLog.deleteMany({ _id: { $in: ids } });
  }

  const logs = await GameMatchLog.find({ userId }).sort({ matchedAt: -1 }).limit(1000);
  const score = calculateUserScore(logs)
  return score
}

/** 文本不超16，换行符不超1个，必须包含大于0的数字 */
const isValidMessage = (text) => {
  const isLengthValid = text.length <= 16;
  const newLineCount = (text.match(/\n/g) || []).length <= 1;

  // 匹配一个大于 0 的数字（整数或小数）
  const containsPositiveNumber = /(?:^|[^\d])([1-9]\d*(?:\.\d+)?|0*\.\d*[1-9])(?:[^\d]|$)/.test(text);
  return whiteKeys?.includes(text) || (isLengthValid && newLineCount && containsPositiveNumber)
}

// 处理消息
exports.handleMessage = async ({ groupId, groupName,  userId, username, nickname, message, sendDateTime }) => {
  // 从消息中提取的 groupId 都为正数, 数据库中存取的是负数
  let group = await GroupConfig.findOne({ groupId });
  if (!group || !group.isWatched) return;
  if(!isValidMessage(message)) return false

  let matchedGames = {};
  for (const gc of group.gameConfigs) {
    const matched = gc.keywords.filter(k => {
      if(whiteKeys?.includes(k)){
        if(k === message) return true
        return false
      }
      return message?.toLowerCase?.()?.includes(k?.toLowerCase()); // 有英文是转小写来匹配
    })
    if (matched.length > 0) {
      matchedGames = {
        gameType: gc.gameType,
        gameLabel: gc.gameLabel,
        matchedKeywords: matched[0],
        originalMessage: message
      };
    }
  }

  if (JSON.stringify(matchedGames) === '{}') return;

  // Step 1: 写入日志
  const pr = await insertUserLog({ userId,  username, nickname, groupId,  groupName, sendDateTime,  ...matchedGames })

  // Step 2: 写入用户信息表
  let profile = await UserProfile.findOne({ userId });
  if (!profile) profile = new UserProfile({ userId, groups: [] });
      profile.nickname = nickname
      profile.username = username
  let groupRecord = profile.groups.find(g => g?.groupId === groupId);
  if (!groupRecord) {
    groupRecord = { groupId, groupName, gameTypes: [matchedGames.gameLabel] };
    profile.groups.push(groupRecord);
  } else {
    if(!groupRecord.gameTypes.includes(matchedGames.gameLabel)){
      groupRecord.gameTypes.push(matchedGames.gameLabel);
    }
  }
  await profile.save();

  // Step 3: 推送对应游戏客服
  await dispatchPush({
    user: {
      id: userId,
      nickname: nickname,
      username: username
    },
    groupName,
    gameType: matchedGames.gameType,
    gameLabel: matchedGames.gameLabel,
    originalMessage: message,
    pr
  });
};