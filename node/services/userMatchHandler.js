const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length === 0) return 50.0;

  const totalLogs = logs.length;
  if (totalLogs < 500) return 50.0;

  const groupedByHour = {};
  const groupSet = new Set();
  const timestamps = [];

  for (const log of logs) {
    const ts = new Date(log.matchedAt).getTime();
    timestamps.push(ts);
    const hourKey = new Date(ts).getHours();
    if (!groupedByHour[hourKey]) groupedByHour[hourKey] = [];
    groupedByHour[hourKey].push(ts);

    if (log.groupId) groupSet.add(log.groupId);
  }

  timestamps.sort((a, b) => a - b);
  const durationMs = timestamps[timestamps.length - 1] - timestamps[0];
  const durationHours = durationMs / (1000 * 60 * 60);

  const groupCount = groupSet.size;

  // ----- ⬇️ 日志活跃时间评分（基于理论最少活跃时间） -----
  const realisticActiveHours = 12; // 假定人类每日最多活跃时间
  const expectedHours = (totalLogs * 3) / 60; // 按3分钟/条推算理论需要小时数
  const expectedSpan = Math.max(expectedHours / realisticActiveHours, 1); // 所需自然日跨度

  const actualSpan = Math.max(durationHours / 24, 1); // 实际跨越自然日数

  let activeScore = 50;
  if (actualSpan < expectedSpan) {
    activeScore -= 20 * ((expectedSpan - actualSpan) / expectedSpan); // 时间越短扣分越多
  } else if (actualSpan > expectedSpan * 1.5) {
    activeScore += 10 * ((actualSpan - expectedSpan) / expectedSpan); // 时间过长适度加分
  }
  activeScore = Math.max(10, Math.min(90, activeScore));

  // ----- ⬇️ 群组覆盖评分 -----
  let groupScore = 50;
  if (groupCount >= 3) groupScore += 15;
  else if (groupCount === 2) groupScore += 5;
  else if (groupCount === 1) groupScore -= 10;

  // ----- ⬇️ 操作频率（分桶）分析 -----
  let frequencyScore = 50;
  let totalBuckets = 0;
  let ultraFastBuckets = 0;
  let fastBuckets = 0;
  let moderateBuckets = 0;

  for (const hour in groupedByHour) {
    const timestamps = groupedByHour[hour].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
      const gapMin = (timestamps[i] - timestamps[i - 1]) / 60000;
      gaps.push(gapMin);
    }
    if (gaps.length === 0) continue;

    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;

    totalBuckets++;
    if (avgGap <= 2) ultraFastBuckets++;
    else if (avgGap <= 5) fastBuckets++;
    else moderateBuckets++;
  }

  if (totalBuckets > 0) {
    const ultraRatio = ultraFastBuckets / totalBuckets;
    const fastRatio = fastBuckets / totalBuckets;

    if (ultraRatio > 0.5) frequencyScore -= 25;
    else if (ultraRatio + fastRatio > 0.5) frequencyScore -= 15;
    else if (moderateBuckets / totalBuckets > 0.6) frequencyScore += 10;
  }

  // 权重计算
  const finalScore =
    0.4 * (100 - activeScore) +
    0.3 * (100 - groupScore) +
    0.3 * (100 - frequencyScore);

  return Math.max(0, Math.min(100, parseFloat(finalScore.toFixed(1))));
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
  const pr = calculateUserScore(logs)
  return pr
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