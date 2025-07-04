const mongoose = require('mongoose');

const GameConfigSchema = new mongoose.Schema({
  gameType: { type: String, required: true },
  gameLabel: { type: String, required: true },
  keywords: { type: [String], default: [] }
});

const GroupConfigSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  groupName: { type: String, required: true },
  groupLink: { type: String },
  isWatched: { type: Boolean, default: true },  // 是否监听
  configurable: { type: Boolean, default: true }, // 是否可配置
  gameConfigs: [GameConfigSchema]
});

module.exports = mongoose.model('GroupConfig', GroupConfigSchema);