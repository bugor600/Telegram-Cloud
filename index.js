const token  = require('./connect/telegram_token.json')
const TelegramApi = require('node-telegram-bot-api')
const bot = new TelegramApi(token.telegram, { polling: true })
const mysql = require('mysql2')
const configdb = require('./connect/db.json')
const debug = require('./helpers')
const request = require('request')
const moment = require('moment')

// Подключение к базе
const mysqlPool = mysql.createPool({
    host: configdb.host,
    user: configdb.user,
    database: configdb.database,
    password: configdb.password,
    charset: 'utf8'
})

global.pool = mysqlPool.promise()

const start = async () => {

bot.on('message', async msg => {
if(msg.from.is_bot == true) return
// Записываем вfсех пользователей в табличку user по нажатию /start
if(msg.text === '/start'){
  const [valid_user] = await global.pool.query("SELECT * FROM user WHERE telegram_id = ?", [msg.from.id])
  if(valid_user[0]){
    bot.sendMessage(msg.chat.id, `Добро пожаловать в облачное хранилище Telegram-Cloud`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Профиль', callback_data: JSON.stringify({"type": "profile", "message": msg.message_id, "chat": msg.chat.id})}, {text: 'Поддержка', callback_data: JSON.stringify({"type": "help"})}],
          [{text: 'Мои файлы', callback_data: JSON.stringify({"type": "files"})}]
        ]
      }
    });
  }
  if(!valid_user[0]){
    global.pool.query("INSERT INTO user (telegram_id, first_name, username, language_code, is_premium) VALUES (?,?,?,?,?)", [msg.from.id, msg.from.first_name, msg.from.username, msg.from.language_code, msg.from.is_premium])
    bot.sendMessage(msg.chat.id, `Добро пожаловать в облачное хранилище Telegram-Cloud`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Профиль', callback_data: JSON.stringify({"type": "profile", "message": msg.message_id, "chat": msg.chat.id})}, {text: 'Поддержка', callback_data: JSON.stringify({"type": "help"})}],
          [{text: 'Мои файлы', callback_data: JSON.stringify({"type": "files"})}]
        ]
      }
    });
  }
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
  if (!query.data) return
    const data = JSON.parse(query.data);
    console.log(data)
try{
    if (data.type == 'yes') {
        bot.deleteMessage(query.message.chat.id, query.message.message_id)
        global.pool.query(`UPDATE file SET save = ? WHERE message_id = ?`, [true, data.message_id]);
         return
    }
    if(data.type == 'no'){
        await bot.answerCallbackQuery(query.id, {text: 'Отменил сохранение', show_alert: true})
        bot.deleteMessage(query.message.chat.id, query.message.message_id)
        return
    }
    if(data.type == 'profile'){
        bot.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: 'Информация', callback_data: (JSON.stringify({"type": "info"})) }, {text: 'Подписка', callback_data: 'podpiska'}],
            [{text: '<', callback_data: (JSON.stringify({"type": "profile_return"}))}],
          ]
          
        }, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id
        });
        return
      }
    if(data.type == 'profile_return'){
      bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: 'Профиль', callback_data: JSON.stringify({"type": "profile", "message": msg.message_id, "chat": msg.chat.id})}, {text: 'Поддержка', callback_data: JSON.stringify({"type": "help"})}],
          [{text: 'Мои файлы', callback_data: JSON.stringify({"type": "files"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
    if(data.type == 'info'){
      const [info] = await global.pool.query(`SELECT user.telegram_id, user.first_name, user.username, user.language_code, user.createdAt, (SELECT count(save) AS save FROM file) AS save FROM user
      LEFT JOIN file f on user.telegram_id = f.telegram_id
      WHERE user.telegram_id = ?`, [msg.from.id]);
      const time_info = (moment(info[0].createdAt).format('YYYY-MM-DD HH:mm:ss'))
      bot.sendMessage(msg.chat.id, `Telegram_id:  ${info[0].telegram_id}\nUsername:  ${info[0].username}\nFirst_name:  ${info[0].first_name}\nLanguage_code:  ${info[0].language_code}\nДата регистрации:  ${time_info}\nСохранено файлов:  ${info[0].save}`)
      return
    }
    if(data.type == 'files'){
      const [files] = await global.pool.query(`SELECT file_name FROM file WHERE telegram_id = ? AND save = ?`, [msg.from.id, true]);
        bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: `${files[0].file_name}`, callback_data: JSON.stringify({"type": "unfile", "file_name": files[0].file_name})}],
          [{ text: '<', callback_data: JSON.stringify({"type": "files_return"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
    if(data.type == 'unfile'){
      const [infos] = await global.pool.query(`SELECT file_name, file_id FROM file WHERE telegram_id = ? AND save = ? AND file_name = ?`, [msg.from.id, true, data.file_name]);
      console.log(infos[0])
      request(`https://api.telegram.org/bot${token.telegram}/getFile?file_id=${infos[0].file_id}`, function (error, response, body) {
      if(response.statusCode != 200) return bot.sendMessage(msg.chat.id, 'Произошла ошибка по запросу api.telegram.org')
      if(response.statusCode === 200){
      const obj = JSON.parse(body)
      const test = String(obj.result.file_path)
      bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: "Скачать", url: `https://api.telegram.org/file/bot${token.telegram}/${test}`}],
          [{ text: '<', callback_data: JSON.stringify({"type": "download_return"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
  })
    }
    if(data.type == 'download_return'){
      const [files] = await global.pool.query(`SELECT file_name FROM file WHERE telegram_id = ? AND save = ?`, [msg.from.id, true]);
        bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: `${files[0].file_name}`, callback_data: JSON.stringify({"type": "unfile", "file_name": files[0].file_name})}],
          [{ text: '<', callback_data: JSON.stringify({"type": "files_return"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
    if(data.type == 'files_return'){
      bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: 'Профиль', callback_data: JSON.stringify({"type": "profile", "message": msg.message_id, "chat": msg.chat.id})}, {text: 'Поддержка', callback_data: JSON.stringify({"type": "help"})}],
          [{text: 'Мои файлы', callback_data: JSON.stringify({"type": "files"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
    if(data.type == 'help'){
      console.log('test')
      bot.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: 'Telegram', url: 'https://t.me/bugor600'}, {text: 'VK', url: 'https://vk.com/bugor600'}],
          [{text: '<', callback_data: JSON.stringify({"type": "help_return"})}]
        ]
      }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      return
    }
      if(data.type == 'help_return'){
        bot.editMessageReplyMarkup({
          inline_keyboard: [
            [{ text: 'Профиль', callback_data: JSON.stringify({"type": "profile", "message": msg.message_id, "chat": msg.chat.id})}, {text: 'Поддержка', callback_data: JSON.stringify({"type": "help"})}],
            [{text: 'Мои файлы', callback_data: JSON.stringify({"type": "files"})}]
          ]
        }, {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id
        });
        return
      }
    }catch(e){
        console.log(e)
    }
})

})
}
start()