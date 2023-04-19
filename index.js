const token  = require('./connect/telegram_token.json')
const TelegramApi = require('node-telegram-bot-api')
const bot = new TelegramApi(token.telegram, { polling: true })
const mysql = require('mysql2')
const configdb = require('./connect/db.json')
const debug = require('./helpers')
const request = require('request')

// Подключение к базе
const mysqlPool = mysql.createPool({
    host: configdb.host,
    user: configdb.user,
    database: configdb.database,
    password: configdb.password,
    charset: 'utf8'
})

global.pool = mysqlPool.promise()

bot.on('message', async msg => {
if(msg.from.is_bot == true) return
// Записываем вfсех пользователей в табличку user по нажатию /start
if(msg.text === '/start'){
    bot.sendMessage(msg.chat.id, 'Привет')
    const [valid_user] = await global.pool.query("SELECT * FROM user WHERE telegram_id = ?", [msg.from.id])
    if(valid_user[0]) return console.log('Пользователь уже есть в Базе')
    global.pool.query("INSERT INTO user (telegram_id, first_name, username, language_code, is_premium) VALUES (?,?,?,?,?)", [msg.from.id, msg.from.first_name, msg.from.username, msg.from.language_code, msg.from.is_premium])
}
if(msg.document){
    global.pool.query("INSERT INTO file (telegram_id, file_name, file_id, message_id, type) VALUES (?,?,?,?,?)", [msg.from.id, msg.document.file_name, msg.document.file_id, msg.message_id, 'document'])
    bot.sendMessage(msg.chat.id, `Сохранить файл?`, {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Да', callback_data: JSON.stringify({"type": "yes", "message_id": msg.message_id})},
            {text: 'Нет', callback_data: `{"type": "no"}`}
          ]]
        }
      });
}
if(msg.text === '/get'){
    const [get] = await global.pool.query(`SELECT file_name, file_id FROM file WHERE save = ?`, [true]);
    if(!get[0]) return bot.sendMessage(msg.chat.id, 'У вас нет сохраненных файлов')

  request(`https://api.telegram.org/bot${token.telegram}/getFile?file_id=${get[0].file_id}`, function (error, response, body) {
    if(response.statusCode != 200) return bot.sendMessage(msg.chat.id, 'Произошла ошибка по запросу api.telegram.org')
    if(response.statusCode === 200){
        const obj = JSON.parse(body)
        const test = String(obj.result.file_path)
        bot.sendMessage(msg.chat.id, `Ваш файл: ${get[0].file_name}`, {
            reply_markup: {
              inline_keyboard: [[
                { text: "Скачать", url: `https://api.telegram.org/file/bot${token.telegram}/${test}`},
              ]]
            }
          });
    }
});

}

bot.on('callback_query', async query => {
    const data = JSON.parse(query.data);
try{
    if (data.type == 'yes') {
        bot.deleteMessage(query.message.chat.id, query.message.message_id)
        global.pool.query(`UPDATE file SET save = ? WHERE message_id = ?`, [true, data.message_id]);
         return
    }
    if(data.type = 'no'){
        await bot.answerCallbackQuery(query.id, {text: 'Отменил сохранение', show_alert: true})
        bot.deleteMessage(query.message.chat.id, query.message.message_id)
        return
    }
    }catch(e){
        console.log(e)
    }
})

})
