require('dotenv').config();
const { Api } = require('telegram');
const GameType = require('../models/GameType');
const UserProfile = require('../models/UserProfile');
const TGPush = require('./bot');
const CryptoJS = require('crypto-js');
const getArchiveUserModel = require('../models/ArchiveUser');
const ArchiveUser = getArchiveUserModel();

// 加密
const encryptAES = (text, keyStr = 'JBJT', ivStr = '0000000000000000') => {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
  
    const encrypted = CryptoJS.AES.encrypt(text, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
  
    return encrypted.toString(); // Base64 string
}

// 解密
const decryptAES = (text, keyStr = 'JBJT', ivStr = '0000000000000000') => {
    const key = CryptoJS.enc.Utf8.parse(keyStr);
    const iv = CryptoJS.enc.Utf8.parse(ivStr);
  
    const decrypted = CryptoJS.AES.decrypt(text, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
  
    return decrypted.toString(CryptoJS.enc.Utf8);
}


/**
 * 推送关键词命中信息
 * @param {Object} param0
 * @param {String} param0.gameType        游戏类型英文标识
 * @param {String} param0.originalMessage 消息文本
 * @param {String} param0.groupName       当前消息触发的群组名称
 * @param {Object} param0.user            用户对象 { id, nickname, username }
 */
exports.dispatchPush = async ({ gameType, gameLabel, originalMessage, groupName, user, pr }) => {
    const game = await GameType.findOne({ name: gameType });
    if (!game || !Array.isArray(game.push) || game.push.length === 0) return;

    // 是否有在金貝玩过
    const JBRow = await ArchiveUser.findOne({ tgcode: encryptAES(user.id) });
    if (JBRow) {
        console.log('查到数据', JBRow)
    }

    const profile = await UserProfile.findOne({ userId: user.id });
    let gameHistoryText = '无记录';

    if (profile && Array.isArray(profile.groups)) {
        gameHistoryText = profile.groups
        .map(g => {
            const games = g.gameTypes && g.gameTypes.length ? g.gameTypes.join('、') : '暂无';
            return `${g.groupName || g.groupId}：${games}`;
        })
        .join('\n    ');
    }

    const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3001';
    const recordLink = `${baseUrl}/user-logs?userId=${user.id}`;

    // 托概率：${pr.score}%
    // 分析：${pr.reason}
    // console.log(`托概率：${pr.score}%，分析：${pr.reason}`)

    const content = `
🎯 关键词命中通知${ JBRow ? '（' + JBRow?.platform + '用户，ID：'+ JBRow?.ucode +'）' : '' }
用户ID：<code>${user.id}</code>
昵称：<b>${user.nickname || '未知'}</b>
用户名：${user.username ? '@' + user.username : '无'}
托概率：${pr.score}%
触发群组：<b>${groupName}</b>
游戏类型：<b>${gameLabel}</b>
消息内容：${originalMessage}

📊 游戏记录（${profile?.groups?.length || 0}个群）：
${gameHistoryText}
    
🔗 投注记录：${recordLink}`;

    for (const receiverId of game.push) {
        TGPush(receiverId, content)
    }
};