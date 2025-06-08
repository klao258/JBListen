const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length === 0) return 50; // 默认中性值

  const maxLogs = 1000;
  const totalLogs = logs.length;
  const baseScore = 50;

  let score = baseScore;

  // 1. 日志数量不足 500 条：中性处理
  if (totalLogs < 500) {
    score += 0; // 保持中性
  }

  // 2. 时间跨度评分
  const first = new Date(logs[logs.length - 1].matchedAt);
  const last = new Date(logs[0].matchedAt);
  const durationMs = last - first;
  const durationHours = durationMs / (1000 * 60 * 60);

  if (durationHours <= 24) {
    score -= 15;
  } else if (durationHours <= 72) {
    score += 0;
  } else {
    score += 10;
  }

  // 3. 群组评分
  const groupSet = new Set(logs.map(log => log.groupId));
  if (groupSet.size <= 2) {
    score += 0;
  } else {
    score += 15;
  }

  // 4. 操作频率评分（分桶：每小时统计）
  const bucketMap = {};
  for (const log of logs) {
    const time = new Date(log.matchedAt);
    const hourKey = `${time.getFullYear()}-${time.getMonth()}-${time.getDate()} ${time.getHours()}`;
    if (!bucketMap[hourKey]) bucketMap[hourKey] = [];
    bucketMap[hourKey].push(time.getTime());
  }

  let freqLow = 0, freqMid = 0, freqHigh = 0;
  const bucketKeys = Object.keys(bucketMap);
  for (const key of bucketKeys) {
    const times = bucketMap[key].sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push(times[i] - times[i - 1]);
    }

    const avgInterval = intervals.length
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : Infinity;

    const avgMin = avgInterval / 1000 / 60;
    if (avgMin < 2) freqHigh++;
    else if (avgMin <= 5) freqMid++;
    else freqLow++;
  }

  const totalBuckets = freqLow + freqMid + freqHigh;
  if (totalBuckets > 0) {
    const ratioHigh = freqHigh / totalBuckets;
    if (ratioHigh > 0.5) score -= 20;
    else if (freqMid / totalBuckets > 0.5) score -= 5;
    else if (freqLow / totalBuckets > 0.5) score += 10;
  }

  // 限制分数范围 0 - 100
  score = Math.max(0, Math.min(score, 100));

  // 返回“是托”的概率
  const probability = Math.round((100 - score) * 10) / 10; // 四舍五入到 1 位小数
  return probability; // 比如：66.7 表示“66.7%是托的概率”
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