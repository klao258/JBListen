// models/GameMatchLog.js
const mongoose = require('mongoose');

const GameMatchLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String },
  nickname: { type: String },
  groupId: { type: String, required: true },
  groupName: { type: String },
  gameType: { type: String, required: true },
  gameLabel: { type: String, required: true },
  matchedKeywords: { type: String },
  originalMessage: { type: String },
  sendDateTime: { type: String },
  matchedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('GameMatchLog', GameMatchLogSchema);
