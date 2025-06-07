const Router = require('koa-router');
const ctrl = require('../controllers/groupConfigController');
const router = new Router();

router.get('/', ctrl.getAll); // 可保留，也可不需要
router.get('/:groupId', ctrl.detail);
router.post('/save', ctrl.save);
router.post('/:groupId/toggle', ctrl.toggleWatch); // ✅ 新增切换监听

module.exports = router;
