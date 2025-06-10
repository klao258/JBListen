const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length < 20) return { score: 50, reason: '日志不足20条，保持中性' };

  const groupIds = new Set(logs.map(l => l.groupId));
  const groupCount = groupIds.size;

  // 1. 群组数量评分（越少越可疑）
  let groupScore = 0;
  if (groupCount >= 4) groupScore = -25;
  else if (groupCount === 3) groupScore = -10;
  else if (groupCount === 2) groupScore = -5;
  else if (groupCount <= 1) groupScore = +10;

  // 2. 平均操作间隔评分
  const timestamps = logs.map(l => new Date(l.matchedAt).getTime()).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] - timestamps[i - 1]) / 60000);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let intervalScore = 0;
  if (avgInterval < 2) intervalScore = +25;
  else if (avgInterval < 3) intervalScore = +15;
  else if (avgInterval < 5) intervalScore = +8;
  else if (avgInterval > 10) intervalScore = -10;
  else intervalScore = 0;

  // 3. 日活跃度
  let timeScore = 0
  const daySlotMap = {};  // { '2025-06-09': Set('08:00', '08:30', ...) }
  for (const log of logs) {
    const date = moment(log.createdAt);
    const dayKey = date.format('YYYY-MM-DD');
    const slot = `${date.format('HH')}:${date.minutes() < 30 ? '00' : '30'}`;
    if (!daySlotMap[dayKey]) {
      daySlotMap[dayKey] = new Set();
    }
    daySlotMap[dayKey].add(slot);
  }
  const dayKeys = Object.keys(daySlotMap);
  const dailyActives = dayKeys.map(day => daySlotMap[day].size / 48);
  const avgActive = dailyActives.reduce((sum, val) => sum + val, 0) / dailyActives.length;
  const dayRang = dailyActives.length // 跨天
  const avgActiveRo = Number((avgActive * 100).toFixed(2)); // 活跃度百分比
  if(dayRang > 1){
    if(avgActiveRo > 80) timeScore = +25
    else if (avgActiveRo > 70) timeScore = +15
    else if (avgActiveRo > 60) timeScore = +5
    else if (avgActiveRo > 50) timeScore = +0
    else if (avgActiveRo > 40) timeScore = -5
    else if (avgActiveRo > 30) timeScore = -10
    else timeScore = -25
  } else {
    timeScore = +10
  }

  // 4. 分桶频率分析（每小时）
  const buckets = {};
  logs.forEach(log => {
    const hourKey = new Date(log.matchedAt).toISOString().slice(0, 13);
    if (!buckets[hourKey]) buckets[hourKey] = [];
    buckets[hourKey].push(new Date(log.matchedAt).getTime());
  });
  let frequentBuckets = 0;
  let totalBuckets = 0;
  for (const times of Object.values(buckets)) {
    if (times.length < 2) continue;
    totalBuckets++;
    times.sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < times.length; i++) {
      gaps.push((times[i] - times[i - 1]) / 60000);
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg <= 3) frequentBuckets++;
  }

  let freqScore = 0;
  if (totalBuckets > 0) {
    const ratio = frequentBuckets / totalBuckets;
    if (ratio > 0.75) freqScore = +25;
    else if (ratio > 0.5) freqScore = +15;
    else if (ratio > 0.3) freqScore = +8;
    else if (ratio > 0.15) freqScore = -8;
    else if (ratio > 0) freqScore = -15;
    else freqScore = -25;
  }

  const score = Math.max(0, Math.min(100, 50 + groupScore + intervalScore + timeScore + freqScore));

  return {
    score,
    reason: `跨群：${ groupCount } 个
                触发间隔均值：${ avgInterval.toFixed(1) }min
                活跃度均值：${dayRang}天, ${ avgActive }/48
                高频桶占比：${ frequentBuckets }/${ totalBuckets }`
  };
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