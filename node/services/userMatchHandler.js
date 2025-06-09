const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length === 0) return 50;

  const totalLogs = logs.length;
  if (totalLogs < 20) return 50;

  const groupSet = new Set(logs.map(l => l.groupId));
  const groupCount = groupSet.size;

  // 1. 群组数评分
  let groupScore = 0;
  if (groupCount === 1) {
    groupScore = 0; 
  } else if (groupCount === 2) {
    groupScore = -15;
  } else if (groupCount === 3) {
    groupScore = -30;
  } else {
    return 0
  }

  // 2. 时间跨度评分（按5分钟频率 & 每日活跃10小时预估）
  const sortedLogs = logs.slice().sort((a, b) => new Date(a.matchedAt) - new Date(b.matchedAt));
  const start = new Date(sortedLogs[0].matchedAt);
  const end = new Date(sortedLogs[sortedLogs.length - 1].matchedAt);
  const durationHours = (end - start) / 1000 / 60 / 60;

  const expectedMaxLogs = (durationHours / 5); // 每5分钟一条
  const diffRatio = logs.length / expectedMaxLogs;
  let timeScore = 0;

  if (diffRatio > 1.5) {
    timeScore = +25;
  } else if (diffRatio > 1.3) {
    timeScore = +18;
  } else if (diffRatio > 1.2) {
    timeScore = +10;
  } else if (diffRatio > 1.0) {
    timeScore = -8;
  } else if (diffRatio > 0.8) {
    timeScore = -16;
  } else {
    timeScore = -25;
  }


  // 3. 分桶频率分析（每小时一个桶）
  let frequentBuckets = 0;
  let totalBuckets = 0;

  for (const times of Object.values(buckets)) {
    if (times.length < 2) continue;
    totalBuckets++;

    times.sort((a, b) => a - b);
    const intervals = times.slice(1).map((t, i) => (t - times[i]) / 1000 / 60);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    if (avgInterval <= 3) {
      frequentBuckets++;
    }
  }

  let freqScore = 0;
  if (totalBuckets > 0) {
    const frequentRatio = frequentBuckets / totalBuckets;

    if (frequentRatio > 0.75) {
      freqScore = +25;
    } else if (frequentRatio > 0.5) {
      freqScore = +15;
    } else if (frequentRatio > 0.3) {
      freqScore = +8;
    } else if (frequentRatio > 0.15) {
      freqScore = -8;
    } else if (frequentRatio > 0) {
      freqScore = -15;
    } else {
      freqScore = -25;
    }
  }

  // 最终评分（越高越像托）
  let score = 50 + groupScore + timeScore + freqScore;
  score = Math.max(0, Math.min(100, score));
  return `基础：50 + 群：${groupScore} + 跨度：${timeScore} + 行为：${freqScore} = ${score}`;
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