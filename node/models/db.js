const mongoose = require('mongoose');

let archiveConn = null;

const connectMongo = async () => {
  try {
    // 主库连接
    await mongoose.connect('mongodb://localhost:27017/jblisten', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ 主库 MongoDB 连接成功');

    // 辅库连接（第二个数据库）
    archiveConn = await mongoose.createConnection('mongodb://localhost:27017/jbjtads', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ 辅库 MongoDB 连接成功');
  } catch (err) {
    console.error('❌ MongoDB 连接失败', err);
    process.exit(1);
  }
};

const getArchiveConn = () => archiveConn;

module.exports = {
  connectMongo,
  getArchiveConn
};