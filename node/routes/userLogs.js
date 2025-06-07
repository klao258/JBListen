// routes/userLogs.js
const Router = require('koa-router');
const GameMatchLog = require('../models/GameMatchLog');
const GameType = require('../models/GameType');
const UserProfile = require('../models/UserProfile');

const router = new Router();

router.get('/user-logs', async ctx => {
    const { userId, username, groupName, gameType, page = 1, pageSize = 100 } = ctx.query;
  
    const currentPage = Math.max(parseInt(page), 1);
    const size = Math.max(parseInt(pageSize), 1);
  
    const filter = {};
    if (userId) filter.userId = userId.toString();  // 强制字符串
    if (username) filter.username = { $regex: new RegExp(username, 'i') }; // 不区分大小写
    if (groupName) filter.groupName = groupName;
    if (gameType) filter.gameType = gameType;
  
    const total = await GameMatchLog.countDocuments(filter);
    const rawLogs = await GameMatchLog.find(filter)
      .sort({ matchedAt: -1 })
      .skip((currentPage - 1) * size)
      .limit(size);

    // 格式化 matchedAt 为北京时间字符串
    const logs = rawLogs.map(log => {
      const date = new Date(log.matchedAt).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
      const d = new Date(date);
      const pad = n => n.toString().padStart(2, '0');
      const formattedTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return ({...log.toObject(), formattedTime})
    })

    const gameTypes = await GameType.find();
    let groups = [];
    if (userId) {
      const profile = await UserProfile.findOne({ userId });
      if (profile?.groups?.length) {
        groups = profile.groups.map(g => g.groupName || g.groupId);
      }
    }
    await ctx.render('user-logs', {
      logs,
      total,
      pageSize: size,
      currentPage,
      gameTypes,
      groups,
      query: ctx.query
    });
});

module.exports = router;