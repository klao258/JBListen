const GroupConfig = require('../models/GroupConfig');
const GameType = require('../models/GameType');

exports.getAll = async ctx => {
  const groups = await GroupConfig.find();
  await ctx.render('group-configs', { groups });
};

exports.detail = async ctx => {
  const group = await GroupConfig.findOne({ groupId: ctx.params.groupId });
  const gameTypes = await GameType.find();
  await ctx.render('group-detail', { group, gameTypes });
};

exports.save = async ctx => {
  const { groupId, groupName } = ctx.request.body;
  let gameConfigs = [];

  try {
    gameConfigs = JSON.parse(ctx.request.body.gameConfigs); // ✅ 解析成对象数组
  } catch (err) {
    return ctx.body = { success: false, message: 'gameConfigs 数据格式错误' };
  }

  await GroupConfig.updateOne(
    { groupId },
    { groupName, gameConfigs },
    { upsert: true }
  );

  ctx.redirect('/');
};

exports.toggleWatch = async ctx => {
  const { groupId } = ctx.params;
  const group = await GroupConfig.findOne({ groupId });
  if (group) {
    group.isWatched = !group.isWatched;
    await group.save();
    ctx.set('Content-Type', 'application/json'); // ✅ 设置为 JSON
    ctx.body = { success: true, isWatched: group.isWatched };
  } else {
    ctx.status = 404;
    ctx.body = { success: false, message: '群组不存在' };
  }
};

// 切换是否显示配置
exports.toggleConfigurable = async ctx => {
  const { groupId } = ctx.params;
  const group = await GroupConfig.findOne({ groupId });
  if (group) {
    group.configurable = !group.configurable;
    await group.save();
    ctx.set('Content-Type', 'application/json'); // ✅ 设置为 JSON
    ctx.body = { success: true, configurable: group.configurable };
  } else {
    ctx.status = 404;
    ctx.body = { success: false, message: '群组不存在' };
  }
};
