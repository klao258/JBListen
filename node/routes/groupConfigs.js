const Router = require('koa-router');
const ctrl = require('../controllers/groupConfigController');
const router = new Router();

router.get('/', ctrl.getAll); // 可保留，也可不需要
router.get('/:groupId', ctrl.detail);
router.post('/save', ctrl.save);
router.post('/:groupId/toggleWatch', ctrl.toggleWatch); // 切换监听
router.post('/:groupId/toggleConfigurable', ctrl.toggleConfigurable); // 切换显示配置

module.exports = router;
