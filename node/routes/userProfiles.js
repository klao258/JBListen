const Router = require('koa-router');
const UserProfile = require('../models/UserProfile');

const router = new Router();

// GET: 用户列表展示页
router.get('/user-profiles', async ctx => {
  const { userId, username, nickname, isTuo='', page = 1, pageSize = 50 } = ctx.query;

  const currentPage = Math.max(parseInt(page), 1);
  const size = Math.max(parseInt(pageSize), 1);
  const filter = {};

  if (userId) filter.userId = userId;
  if (username) filter.username = { $regex: new RegExp(username, 'i') };
  if (nickname) filter.nickname = { $regex: new RegExp(nickname, 'i') };
  
  if(isTuo !== ""){
    filter.isTuo = +isTuo === 1 ? true : false
  }

  const total = await UserProfile.countDocuments(filter);
  const users = await UserProfile.find(filter)
    .sort({ userId: 1 })
    .skip((currentPage - 1) * size)
    .limit(size);

  await ctx.render('user-profiles', {
    users,
    query: ctx.query,
    total,
    currentPage,
    pageSize: size,
    request: { path: '/user-profiles' }
  });
});

// POST: 切换是否为托
router.post('/user-profiles/toggle-tuo', async ctx => {
  const { userId } = ctx.request.body;
  if (!userId) {
    ctx.status = 400;
    ctx.body = 'Missing userId';
    return;
  }

  const user = await UserProfile.findOne({ userId });
  if (!user) {
    ctx.status = 404;
    ctx.body = 'User not found';
    return;
  }

  const newStatus = !user.isTuo;
  user.isTuo = newStatus;
  await user.save();

  ctx.redirect('/user-profiles');
});

module.exports = router;
