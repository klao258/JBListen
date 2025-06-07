const mongoose = require('mongoose');

const GroupGameSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  groupName: { type: String },
  gameTypes: { type: [String], default: [] }
}, { _id: false });

const UserProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String },
  nickname: { type: String },
  groups: [GroupGameSchema]
});

module.exports = mongoose.model('UserProfile', UserProfileSchema);
