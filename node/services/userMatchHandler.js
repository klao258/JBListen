const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs) => {
  if (!logs || logs.length === 0) return 50;

  const MINUTES_PER_DAY_ACTIVE = 16 * 60;
  const MIN_INTERVAL = 2;

  function getExpectedMinDuration(logCount) {
    return logCount * MIN_INTERVAL;
  }

  function scoreTimeSpanScore(logs) {
    if (logs.length < 100) return 0.5; // 数据量不足，可信度低

    const sorted = [...logs].sort((a, b) => new Date(a.matchedAt) - new Date(b.matchedAt));
    const actualMinutes = (new Date(sorted[sorted.length - 1].matchedAt) - new Date(sorted[0].matchedAt)) / 60000;
    const expectedMinutes = getExpectedMinDuration(logs.length);

    if (actualMinutes >= expectedMinutes) return 1.0;
    if (actualMinutes >= expectedMinutes * 0.7) return 0.7;
    if (actualMinutes >= expectedMinutes * 0.5) return 0.4;
    return 0.2;
  }

  function scoreGroupDiversity(logs) {
    const groupSet = new Set(logs.map(log => log.groupId));
    const count = groupSet.size;
    if (count >= 3) return 1.0;
    if (count === 2) return 0.6;
    return 0.3;
  }

  function scoreFrequency(logs) {
    const hourlyBuckets = {};
    logs.forEach(log => {
      const h = new Date(log.matchedAt).toISOString().slice(0, 13); // YYYY-MM-DDTHH
      if (!hourlyBuckets[h]) hourlyBuckets[h] = [];
      hourlyBuckets[h].push(new Date(log.matchedAt).getTime());
    });

    let shortCount = 0, mediumCount = 0, longCount = 0, total = 0;
    for (const times of Object.values(hourlyBuckets)) {
      const sorted = times.sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        const diff = (sorted[i] - sorted[i - 1]) / 60000;
        total++;
        if (diff <= 2) shortCount++;
        else if (diff <= 5) mediumCount++;
        else longCount++;
      }
    }

    if (total === 0) return 0.5;
    const shortRatio = shortCount / total;
    const mediumRatio = mediumCount / total;

    if (shortRatio > 0.5) return 0.2;
    if (mediumRatio > 0.5) return 0.5;
    return 1.0;
  }

  const score1 = scoreTimeSpanScore(logs);
  const score2 = scoreGroupDiversity(logs);
  const score3 = scoreFrequency(logs);

  const averageScore = (score1 + score2 + score3) / 3;
  const tuoProbability = Math.round((1 - averageScore) * 1000) / 10; // 保留1位小数
  return tuoProbability; // 例如：33.2 表示托的概率为33.2%
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