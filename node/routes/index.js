const Router = require('koa-router');
const GroupConfig = require('../models/GroupConfig');
const GameType = require('../models/GameType');
const groupConfigsRoute = require('./groupConfigs');
const userProfilesRoute = require('./userProfiles');
const gameTypesRoute = require('./gameTypes');
const userLogsRoute = require('./userLogs');
const pushRoute = require('./push');

const router = new Router();

router.get('/', async ctx => {
  const groups = await GroupConfig.find().sort({ isWatched: -1, groupName: 1 });
  const gameTypes = await GameType.find(); // ✅ 查询所有游戏类型
  await ctx.render('index', { groups, gameTypes, request: { path: '/' } }); // ✅ 传入模板
});

router.use(groupConfigsRoute.routes());
router.use(userProfilesRoute.routes());
router.use(gameTypesRoute.routes());
router.use(userLogsRoute.routes());
router.use(pushRoute.routes());

module.exports = router;