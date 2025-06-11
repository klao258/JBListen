const Router = require('koa-router');
const GameMatchLog = require('../models/GameMatchLog');
const UserProfile = require('../models/UserProfile');
const userMatchHandler = require('../services/userMatchHandler');

const router = new Router();

// gameType, gameLabel, matchedKeyword, matchedAt 
router.post('/api/push', async ctx => {
  try {
    const { groupId='', groupName='', userId='', username='', nickname='', message='', sendDateTime = '' } = ctx.request.body;
    console.log(`node接收到消息: ${groupName} - （${userId}）${nickname}：${message}\n`)

    if (!userId || !groupId) {
      ctx.status = 400;
      ctx.body = { success: false, message: '缺少必要参数' };
      return;
    }

    await userMatchHandler.handleMessage({  groupId, groupName, userId, username, nickname, message, sendDateTime });
    ctx.status = 200;
    ctx.body = { success: true, message: '推送处理成功' };
  } catch (error) {
    console.error('node处理失败', error);
    ctx.sendStatus(500);
  }
});

module.exports = router;