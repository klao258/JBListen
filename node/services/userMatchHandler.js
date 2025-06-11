const { Api } = require('telegram');
const GroupConfig = require('../models/GroupConfig');
const UserProfile = require('../models/UserProfile');
const GameMatchLog = require('../models/GameMatchLog');
const { dispatchPush } = require('./pushDispatcher');
const moment = require('moment');

const whiteKeys = ['游戏', '余额', '流水', '返水', '反水']

// 用户评分函数
const calculateUserScore = (logs, userId) => {
  if (!logs || logs.length < 20) return { score: 50, reason: '日志不足20条，保持中性' };

  const groupIds = new Set(logs.map(l => l.groupId));
  const groupCount = groupIds.size;

  // 1. 群组数量评分，越少越可疑（10）
  let groupScore = 0;
  if (groupCount <= 1) groupScore = 10
  else if (groupCount === 2) groupScore = -5;
  else if (groupCount === 3) groupScore = -25;
  else if (groupCount >= 4) groupScore = -50;


  // 2. 平均操作间隔评分（20）
  const timestamps = logs.map(l => new Date(l.matchedAt).getTime()).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push((timestamps[i] - timestamps[i - 1]) / 60000);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let intervalScore = 0;
  if (avgInterval < 3) intervalScore = +20;
  else if (avgInterval < 5) intervalScore = +12;
  else if (avgInterval < 8) intervalScore = +8;
  else if (avgInterval < 12) intervalScore = +2;
  else if (avgInterval > 12) intervalScore = 0;

  // 3. 日活跃度（35）
  let timeScore = 0
  let daySlotMap = {}; // 结构: { '2025-06-10': Set('08:00', '08:30', ...) }
  for (const log of logs) {
    if (!log.matchedAt) continue;

    const utc = new Date(log.matchedAt);
    if (isNaN(utc.getTime())) continue;

    // ✅ 将 UTC 时间转换为东八区时间（北京时间）
    const local = new Date(utc.getTime() + 8 * 60 * 60 * 1000);

    const yyyy = local.getFullYear();
    const mm = String(local.getMonth() + 1).padStart(2, '0');
    const dd = String(local.getDate()).padStart(2, '0');
    const hh = String(local.getHours()).padStart(2, '0');
    const minute = local.getMinutes();
    const slotMinute = minute < 30 ? '00' : '30';

    const dayKey = `${yyyy}-${mm}-${dd}`;
    const slotKey = `${hh}:${slotMinute}`;

    // 用于统计跨越的天数
    const dayTime = new Date(Date.UTC(yyyy, Number(mm) - 1, Number(dd)));

    if (!daySlotMap[dayKey]) daySlotMap[dayKey] = new Set();
    daySlotMap[dayKey].add(slotKey);
  }
  const activeDays = Object.keys(daySlotMap).sort();  // 默认按 YYYY-MM-DD 排序
  let totalDays = activeDays.length > 2 ? activeDays.length - 2 : 0;  // 除去首尾后跨天数
  let totalActive = 0
  if (activeDays.length > 2) {
    const firstDay = activeDays[0];
    const lastDay = activeDays[activeDays.length - 1];

    // 2. 删除首尾两天
    delete daySlotMap[firstDay];
    delete daySlotMap[lastDay];

    // 统计总活跃度
    totalActive = Object.values(daySlotMap).map(set => set.size).reduce((sum, val) => sum + val, 0)
  } else {
    daySlotMap = {}
  }
  const avgPercent = (totalActive && totalDays) ? (totalActive / totalDays).toFixed(0) : 0; // 日活平均值
  if (totalDays > 0) {
    // 中心点设为 16，靠近 30% 最安全，偏离就加分（越偏离越可疑）
    const diff = avgPercent - 16; // 与“正常”活跃度的偏离程度
    timeScore = ((diff / 16) * 35).toFixed(0);
  
    // 限制最高得分
    if (timeScore < -35) timeScore = -35;
    if (timeScore > 35) timeScore = 35;
  } else {
    timeScore = 18; // 数据不足，轻微打分但不判定为刷
  }

  // 4. 每小时分桶频率分析（35）
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
    freqScore = (ratio * 35).toFixed(2);
  }

  const score = (Math.max(0, Math.min(100, (+groupScore) + (+intervalScore) + (+timeScore) + (+freqScore)))).toFixed(2);

  return {
    score,
    reason: `跨群：${ groupCount } 个，得分：（${groupScore}）
            触发间隔均值：${ avgInterval.toFixed(1) }min，得分：（${ intervalScore }）
            活跃度均值：跨${totalDays}天, 均值${avgPercent}， 得分：${ timeScore }）
            高频桶占比：${ frequentBuckets }/${ totalBuckets }，得分：（ ${ freqScore }）`
  };
}

// 记录日志, 单用户最大记录 1000 条日志
const insertUserLog = async (logData) => {
  const { userId, username, nickname, groupId, groupName, sendDateTime, ...matchedGames } = logData;
  await GameMatchLog.create({ userId, username, nickname, groupId, groupName, sendDateTime, ...matchedGames });
  const count = await GameMatchLog.countDocuments({ userId });
  if (count > 1000) {
    const oldest = await GameMatchLog.find({ userId })
      .sort({ matchedAt: 1 }) // 最早的日志
      .limit(10)
      .select('_id');

    const ids = oldest.map(doc => doc._id);
    await GameMatchLog.deleteMany({ _id: { $in: ids } });
  }

  const logs = await GameMatchLog.find({ userId }).sort({ matchedAt: -1 }).limit(1000);
  const pr = calculateUserScore(logs, userId)
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