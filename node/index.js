require("dotenv").config({ path: '../.env' })
const Koa = require('koa');
const views = require('koa-views');
const bodyParser = require('koa-bodyparser');
const serve = require('koa-static');
const mongoose = require('mongoose');
const path = require('path');
const telegramService = require('./services/telegramService');
const GameType = require('./models/GameType');
const { connectMongo } = require('./models/db.js');

const app = new Koa();

const initGameTypes = async () => {
  const defaults = [
    { name: 'dz', label: '电子', description: '综合电子、体育等', push: [ "-1002584327379" ] },
    { name: 'bjl', label: '百家乐', description: '百家乐、真人视讯等', push: [ "-1002872015837" ] },
    { name: 'pc', label: 'PC', description: 'PC2.0、PC2.8、满赔PC、网盘PC、PC牛牛等', push: [ "-1002824040406" ] },
    { name: 'sz', label: '骰子', description: '骰子、极速骰子、鱼虾蟹等', push: [ "-1002844111397" ] },
    { name: 'hb', label: '红包', description: '16倍红包牛牛、极速红包牛牛、哈希红包扫雷、红包扫雷、红包六合彩等', push: [ "-1002583063348" ] },
    { name: 'other', label: '其他', description: '游戏、余额、流水、返水', push: [ "-1002503927242" ] },
  ];

  for (const gt of defaults) {
    const exists = await GameType.findOne({ name: gt.name });
    if (!exists) {
      await GameType.create(gt);
      console.log(`✅ 新增 GameType：${gt.label}`);
    }
  }
}

(async () => {
  await connectMongo();
  await initGameTypes();   // 仅初始化 GameType（只补不删）
  await telegramService.start();  // 登录 + 初始化群组 + 启动监听

  app.use(bodyParser());
  app.use(serve(path.join(__dirname, 'public')));
  app.use(views(path.join(__dirname, 'views'), { extension: 'ejs' }));
  app.use(require('./routes/index').routes());
  console.log('端口', process.env.PORT)

  app.use(async (ctx, next) => {
    console.log(`${ctx.method} ${ctx.url} - ${new Date().toISOString()}`);
    await next();
  });

  
  app.listen(process.env.PORT, () => console.log(`🚀 已启动服务, ${process.env.PORT} 端口`));
})();