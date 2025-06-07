require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.PUSHBOT_TOKEN);

const TGPush = async(chatId, text) => {
    try {
        await bot.telegram.sendMessage(+chatId, text, {
            parse_mode: 'HTML'  // ✅ 支持加粗、链接等
        });
    } catch (err) {
        console.error('❌ bot推送失败:', chatId, err.response?.description || err.message);
    }
}

module.exports = TGPush;
