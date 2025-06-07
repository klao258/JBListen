const mongoose = require('mongoose');

const GameConfigSchema = new mongoose.Schema({
  gameType: { type: String, required: true },
  gameLabel: { type: String, required: true },
  keywords: { type: [String], default: [] }
});

const GroupConfigSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  groupName: { type: String, required: true },
  isWatched: { type: Boolean, default: true },
  gameConfigs: [GameConfigSchema]
});

module.exports = mongoose.model('GroupConfig', GroupConfigSchema);