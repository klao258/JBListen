const Router = require('koa-router');
const GameType = require('../models/GameType');
const GroupConfig = require('../models/GroupConfig');

const router = new Router();

// ✅ 渲染游戏管理页面
router.get('/game-types', async ctx => {
    const games = await GameType.find().sort({ name: 1 });
    await ctx.render('game', {
        games,
        request: { path: ctx.path }
    });
});

// ✅ 保存新增/编辑游戏
router.post('/game-types/save', async ctx => {
    const { mode, name, label, description, push } = ctx.request.body;

    // 统一处理 push 字段：字符串 => 数组（去空格、过滤空值）
    const pushArray = (push || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    if (mode === 'add') {
        // 防止重复
        const exists = await GameType.findOne({ name });
        if (exists) {
        ctx.body = '游戏已存在';
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

        // ✅ 更新所有群组中引用该 game.name 的 label 或 push 映射
        await GroupConfig.updateMany(
        { 'games.name': name },
        {
            $set: {
            'games.$[elem].push': pushArray,
            'games.$[elem].description': description,
            }
        },
        {
            arrayFilters: [{ 'elem.name': name }]
        }
        );
    }

    ctx.redirect('/game-types');
});

module.exports = router;
