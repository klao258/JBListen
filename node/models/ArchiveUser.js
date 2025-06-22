// 金貝用户数据模型
const { getArchiveConn } = require('./db');
const mongoose = require('mongoose');

const archiveUserSchema = new mongoose.Schema({
  tgname: { type: String, default: null },
  tgcode: { type: String, required: true },
  ucode: { type: String, required: true },
  uname: { type: String, default: null },
  upcode: { type: String, required: true },
  upname: { type: String, default: null },
  amount: { type: Number, default: 0 },
  createDate: { type: String, required: true },
  updateDate: { type: String, required: true },
  ads: { type: String, required: true },
  platform: { type: String, required: true }
});

archiveUserSchema.index({ ads: 1, ucode: 1 });
archiveUserSchema.index({ platform: 1 });

module.exports = () => getArchiveConn().model('ArchiveUser', archiveUserSchema);
