const Router = require('koa-router');
const GameType = require('../models/GameType');
const GroupConfig = require('../models/GroupConfig');

const router = new Router();

// ✅ 渲染游戏管理页面
router.get('/game-types', async ctx => {
    const games = await GameType.find().sort({ name: 1 });
    await ctx.render('game-types', {
        games,
        request: { path: '/game-types' }
    });
});

// ✅ 保存新增/编辑游戏
router.post('/game-types/save', async ctx => {
    const { mode, name, label, description, push } = ctx.request.body;
  
    const pushArray = (push || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
  
    if (mode === 'add') {
        const exists = await GameType.findOne({ name });
        if (exists) {
            ctx.body = '游戏类型已存在';
            return;
        }
  
        await GameType.create({ name, label, description, push: pushArray }); 
    } else if (mode === 'edit') {
        const game = await GameType.findOne({ name });
        if (!game) {
            ctx.status = 404;
            ctx.body = '未找到游戏';
            return;
        }
  
        game.description = description;
        game.push = pushArray;
        await game.save();
    }
  
    // ✅ 同步所有 GroupConfig 中的 gameConfigs
    const groups = await GroupConfig.find();
    for (const group of groups) {
        const existingIndex = group.gameConfigs.findIndex(cfg => cfg.gameType === name);
  
        if (existingIndex !== -1) {
            group.gameConfigs[existingIndex].gameLabel = label;
        } else {
            group.gameConfigs.push({
                gameType: name,
                gameLabel: label,
                keywords: []
            });
        }
  
        await group.save();
    }
  
    ctx.redirect('/game-types');
});

module.exports = router;
