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
  const groupedByHour = {};
  const groupSet = new Set();
  const gameSet = new Set();

  const timestamps = logs.map(log => new Date(log.matchedAt).getTime()).sort((a, b) => a - b);
  const startTime = timestamps[0];
  const endTime = timestamps[timestamps.length - 1];
  const spanHours = (endTime - startTime) / (1000 * 60 * 60);

  // 1. 统计群组和游戏种类数
  logs.forEach(log => {
    groupSet.add(log.groupName);
    gameSet.add(log.gameType);

    const hour = new Date(log.matchedAt).getHours();
    groupedByHour[hour] = groupedByHour[hour] || [];
    groupedByHour[hour].push(log);
  });

  const groupCount = groupSet.size;
  const gameCount = gameSet.size;

  // 2. 按小时分桶计算相邻间隔时间
  let shortIntervals = 0;
  let mediumIntervals = 0;
  let longIntervals = 0;
  let totalPairs = 0;

  for (const hourLogs of Object.values(groupedByHour)) {
    const sorted = hourLogs.map(l => new Date(l.matchedAt).getTime()).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const diffMin = (sorted[i] - sorted[i - 1]) / 1000 / 60;
      totalPairs++;
      if (diffMin <= 2) shortIntervals++;
      else if (diffMin <= 5) mediumIntervals++;
      else longIntervals++;
    }
  }

  const shortRate = shortIntervals / totalPairs;
  const mediumRate = mediumIntervals / totalPairs;
  const longRate = longIntervals / totalPairs;
  
  // 3. 日志量太少时，趋向中性
  let baseScore = 50;
  if (totalLogs < 500) baseScore = 50;

  // 4. 时间跨度影响（动态判断）
  const idealActiveHoursPerDay = 10; // 高活跃容错
  const idealLogRate = 60 / 2; // 每小时最多触发数（2分钟一次）
  const expectedHours = totalLogs / idealLogRate;
  const expectedDays = expectedHours / idealActiveHoursPerDay;
  const actualDays = spanHours / 24;

  if (actualDays < expectedDays * 0.6) baseScore += 15;
  else if (actualDays > expectedDays * 1.2) baseScore -= 10;

  // 5. 群组权重
  if (groupCount >= 3) baseScore -= 15;
  else if (groupCount <= 1) baseScore += 10;

  // 6. 操作频率
  if (shortRate > 0.5) baseScore += 15;
  else if (mediumRate > 0.5) baseScore += 5;
  else baseScore -= 10;

  // 范围限制
  baseScore = Math.min(100, Math.max(0, baseScore));
  return baseScore;
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