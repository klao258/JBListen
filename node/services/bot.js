require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot1 = new Telegraf(process.env.PUSHBOT_TOKEN);
const bot2 = new Telegraf('7603105476:AAE1yQBSMgYdY3MBg-8GnTtTskLHRx3akSU');

const TGPush = async(chatId, text) => {
    try {
        const random = Math.floor(Math.random() * 2) + 1;
        const bot = +chatId === -4815235248 ? bot1 : random === 1 ? bot1 : bot2
        await bot.telegram.sendMessage(+chatId, text, {
            parse_mode: 'HTML'  // ✅ 支持加粗、链接等
        });
    } catch (err) {
        console.error('❌ bot推送失败:', chatId, err.response?.description || err.message);
    }
}

module.exports = TGPush;
