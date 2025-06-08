const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  const scoreWeights = {
      multiGroup: 0.4,       // 跨群活跃权重
      multiGame: 0.2,        // 多游戏类型权重
      frequency: 0.4         // 高频行为权重（动态）
  };

  if (!Array.isArray(logs) || logs.length === 0) return 0;

  // --- 预处理：按时间排序
  logs.sort((a, b) => new Date(a.matchedAt) - new Date(b.matchedAt));

  // --- 1. 跨群评分（越多群活跃越真实）
  const groupSet = new Set(logs.map(log => log.groupId));
  const groupScore = Math.min(groupSet.size / 3, 1) * 100 * scoreWeights.multiGroup;

  // --- 2. 多类型评分（多游戏类型略加分）
  const gameSet = new Set(logs.map(log => log.gameType));
  const gameScore = Math.min(gameSet.size / 5, 1) * 100 * scoreWeights.multiGame;

  // --- 3. 触发间隔分析（动态频率判断）
  const intervals = [];
  for (let i = 1; i < logs.length; i++) {
    const prev = new Date(logs[i - 1].matchedAt).getTime();
    const curr = new Date(logs[i].matchedAt).getTime();
    intervals.push(curr - prev);
  }

  let short = 0, medium = 0, long = 0;
  for (const t of intervals) {
    if (t < 10_000) short++;
    else if (t < 60_000) medium++;
    else long++;
  }

  const total = intervals.length || 1;
  const shortRate = short / total;
  const mediumRate = medium / total;

  let freqScore = 0;
  if (shortRate > 0.4) freqScore += 50;
  else if (shortRate > 0.25) freqScore += 30;
  else if (shortRate > 0.1) freqScore += 10;
  if (mediumRate > 0.5 && shortRate < 0.1) freqScore += 10;
  freqScore = 100 - Math.min(freqScore, 100); // 高频 => 降分

  const finalScore = groupScore + gameScore + freqScore * scoreWeights.frequency;
  return Math.round(finalScore);
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
  const score = await insertUserLog({ userId,  username, nickname, groupId,  groupName, sendDateTime,  ...matchedGames })
  console.log('分值', score)

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
    score
  });
};