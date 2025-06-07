const mongoose = require('mongoose');

const GameTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  description: { type: String },
  push: { type: [String], default: [] }
});

module.exports = mongoose.model('GameType', GameTypeSchema);