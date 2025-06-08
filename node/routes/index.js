const Router = require('koa-router');
const GroupConfig = require('../models/GroupConfig');
const GameType = require('../models/GameType');
const userLogs = require('./userLogs');
const userRoutes = require('./routes/user');
const pushRouter = require('./push');

const router = new Router();

router.get('/', async ctx => {
  const groups = await GroupConfig.find().sort({ isWatched: -1, groupName: 1 });
  const gameTypes = await GameType.find(); // ✅ 查询所有游戏类型
  await ctx.render('index', { groups, gameTypes, request: { path: '/' } }); // ✅ 传入模板
});

router.use('/group-configs', require('./groupConfigs').routes());
router.use(userRoutes.routes());
router.use(userLogs.routes());
router.use(pushRouter.routes());


module.exports = router;