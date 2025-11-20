const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const app = express();
const axios = require('axios');
const { buildPayload, headers, API_URL } = require('./api-cekpayment-orkut');
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'bot-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'bot-combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const fs = require('fs');
const path = require('path');
const totalip = './total.db';
const resselFilePath = path.join(__dirname, 'ressel.db');

function isUserReseller(userId) {
  if (!fs.existsSync(resselFilePath)) return false;
  const list = fs.readFileSync(resselFilePath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  return list.includes(String(userId));
}

function updateTotalCreateAkun(ctx) {
  let total = 0;

  // Baca isi file kalau sudah ada
  if (fs.existsSync(totalip)) {
    const isi = fs.readFileSync(totalip, 'utf-8');
    total = parseInt(isi) || 0;
  }

  total += 1;

  // Simpan kembali ke file
  fs.writeFile(totalip, total.toString(), (err) => {
    if (err) {
      return ctx.reply('❌ *Gagal update total akun (file).*', { parse_mode: 'Markdown' });
    }

    // Berhasil update total
    console.log('✅ Total akun berhasil ditambahkan:', total);
  });
}

function getTotalAkunTerdaftar() {
  if (fs.existsSync(totalip)) {
    const isi = fs.readFileSync(totalip, 'utf-8');
    const total = parseInt(isi) || 0;
    return total;
  } else {
    return 0;
  }
}

const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

const BOT_TOKEN = vars.BOT_TOKEN;
const port = vars.PORT || 6969;
const ADMIN = vars.USER_ID; 
const NAMA_STORE = vars.NAMA_STORE || '@ARI_VPN_STORE';
const DATA_QRIS = vars.DATA_QRIS;
const MERCHANT_ID = vars.MERCHANT_ID;
const API_KEY = vars.API_KEY;
const GROUP_ID = vars.GROUP_ID;

const bot = new Telegraf(BOT_TOKEN);
let ADMIN_USERNAME = '';
const adminIds = ADMIN;
logger.info('Bot initialized');

(async () => {
  try {
    const adminId = Array.isArray(adminIds) ? adminIds[0] : adminIds;
    const chat = await bot.telegram.getChat(adminId);
    ADMIN_USERNAME = chat.username ? `@${chat.username}` : 'Admin';
    logger.info(`Admin username detected: ${ADMIN_USERNAME}`);
  } catch (e) {
    ADMIN_USERNAME = 'Admin';
    logger.warn('Tidak bisa ambil username admin otomatis.');
  }
})();

const db = new sqlite3.Database('./sellsc.db', (err) => {
  if (err) {
    logger.error('Kesalahan koneksi SQLite3:', err.message);
  } else {
    logger.info('Terhubung ke SQLite3');
  }
});

db.run(`CREATE TABLE IF NOT EXISTS pending_deposits (
  unique_code TEXT PRIMARY KEY,
  user_id INTEGER,
  amount INTEGER,
  original_amount INTEGER,
  timestamp INTEGER,
  status TEXT,
  qr_message_id INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel pending_deposits:', err.message);
  }
});

db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT,
  auth TEXT,
  harga INTEGER,
  nama_server TEXT,
  quota INTEGER,
  iplimit INTEGER,
  batas_create_akun INTEGER,
  total_create_akun INTEGER
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel Server:', err.message);
  } else {
    logger.info('Server table created or already exists');
  }
});


db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  saldo INTEGER DEFAULT 0,
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel users:', err.message);
  } else {
    logger.info('Users table created or already exists');
  }
});

db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount INTEGER,
  type TEXT,
  reference_id TEXT,
  timestamp INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => {
  if (err) {
    logger.error('Kesalahan membuat tabel transactions:', err.message);
  } else {
    logger.info('Transactions table created or already exists');
    
    // Add reference_id column if it doesn't exist
    db.get("PRAGMA table_info(transactions)", (err, rows) => {
      if (err) {
        logger.error('Kesalahan memeriksa struktur tabel:', err.message);
        return;
      }
      
      db.get("SELECT * FROM transactions WHERE reference_id IS NULL LIMIT 1", (err, row) => {
        if (err && err.message.includes('no such column')) {
          // Column doesn't exist, add it
          db.run("ALTER TABLE transactions ADD COLUMN reference_id TEXT", (err) => {
            if (err) {
              logger.error('Kesalahan menambahkan kolom reference_id:', err.message);
            } else {
              logger.info('Kolom reference_id berhasil ditambahkan ke tabel transactions');
            }
          });
        } else if (row) {
          // Update existing transactions with reference_id
          db.all("SELECT id, user_id, type, timestamp FROM transactions WHERE reference_id IS NULL", [], (err, rows) => {
            if (err) {
              logger.error('Kesalahan mengambil transaksi tanpa reference_id:', err.message);
              return;
            }
            
            rows.forEach(row => {
              const referenceId = `account-${row.type}-${row.user_id}-${row.timestamp}`;
              db.run("UPDATE transactions SET reference_id = ? WHERE id = ?", [referenceId, row.id], (err) => {
                if (err) {
                  logger.error(`Kesalahan mengupdate reference_id untuk transaksi ${row.id}:`, err.message);
                } else {
                  logger.info(`Berhasil mengupdate reference_id untuk transaksi ${row.id}`);
                }
              });
            });
          });
        }
      });
    });
  }
});

const userState = {};
logger.info('User state initialized');

bot.command(['start', 'menu'], async (ctx) => {
  logger.info('Start or Menu command received');
  
  const userId = ctx.from.id;
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      logger.error('Kesalahan saat memeriksa user_id:', err.message);
      return;
    }

    if (row) {
      logger.info(`User ID ${userId} sudah ada di database`);
    } else {
      db.run('INSERT INTO users (user_id) VALUES (?)', [userId], (err) => {
        if (err) {
          logger.error('Kesalahan saat menyimpan user_id:', err.message);
        } else {
          logger.info(`User ID ${userId} berhasil disimpan`);
        }
      });
    }
  });

  await sendMainMenu(ctx);
});

async function sendMainMenu(ctx) {
  // Ambil data user
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';
  let saldo = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT saldo FROM users WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
    saldo = row ? row.saldo : 0;
  } catch (e) { saldo = 0; }
  // Jumlah pengguna bot
  let jumlahPengguna = 0;
  let isReseller = false;
if (fs.existsSync(resselFilePath)) {
  const resellerList = fs.readFileSync(resselFilePath, 'utf8').split('\n').map(x => x.trim());
  isReseller = resellerList.includes(userId.toString());
}
const statusReseller = isReseller ? 'Reseller' : 'Bukan Reseller';
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS count FROM users', (err, row) => { if (err) reject(err); else resolve(row); });
    });
    jumlahPengguna = row.count;
  } catch (e) { jumlahPengguna = 0; }

  // Latency (dummy, bisa diubah sesuai kebutuhan)
  const latency = (Math.random() * 0.1 + 0.01).toFixed(2);
 const total = getTotalAkunTerdaftar();
  const messageText = `
<b>Selamat datang di ${NAMA_STORE} 👋</b>

<b>Hai, Member <code>${userName}</code>!</b>
ID: <code>${userId}</code>
Saldo: <code>Rp ${saldo}</code>
Status: <code>${statusReseller}</code>

Bot serba otomatis untuk Registrasi IP
dengan mudah dan cepat
Nikmati kemudahan dan kecepatan
dalam layanan VPN dengan bot kami!

<blockquote> 📊 Total Akun Terdaftar: ${total} </blockquote>

⚙️ <b>COMMAND</b>
• 🏠 Menu Utama   : /start
• 🛡️ Admin Panel  : /helpadmin

👨‍💻 <b>Pembuat:</b> @ARI_VPN_STORE
🛠️ <b>Credit:</b> ARI STORE 
🔧 <b>Base:</b> FighterTunnel
👥 Pengguna BOT: ${jumlahPengguna}
⏱️ Latency: ${latency} ms
──────────────────────────`;

const keyboard = [];

if (isReseller) {
  // Menu untuk reseller
  keyboard.push(
    [
      { text: '➕ Beli SC TUNNEL', callback_data: 'register_ip' },
      { text: '♻️ Renew SC TUNNEL', callback_data: 'renew_ip' }
    ],
    [
      { text: '❌ Delete SC TUNNEL', callback_data: 'del_ip' },
      { text: '⌛ Trial SC TUNNEL', callback_data: 'trial_ip' }
    ],
    [
      { text: '🔄 Ganti SC TUNNEL', callback_data: 'ganti_ip' },
      { text: '🔗 Link Install', callback_data: 'link_install' }
    ],
    [
      { text: '💰 TopUp Saldo', callback_data: 'topup_saldo' }
    ]
  );
} else {
  // Menu untuk user biasa (belum reseller)
  keyboard.push(
    [
      { text: '➕ Beli SC TUNNEL', callback_data: 'register_ip' },
      { text: '♻️ Renew SC TUNNEL', callback_data: 'renew_ip' }
    ],
    [
      { text: '⌛ Trial SC TUNNEL', callback_data: 'trial_ip' },
      { text: '🔄 Ganti SC TUNNEL', callback_data: 'ganti_ip' }
    ],
    [
       { text: '🔗 Link Install', callback_data: 'link_install' },
      { text: '💰 TopUp Saldo', callback_data: 'topup_saldo' }
    ],
    [
      { text: '🤝 Yuk Jadi Reseller & Dapat Harga Spesial!', callback_data: 'jadi_reseller' }
    ]
  );
}


  try {
    if (ctx.updateType === 'callback_query') {
      try {
      await ctx.editMessageText(messageText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } catch (error) {
        // Jika error karena message sudah diedit/dihapus, abaikan
        if (error && error.response && error.response.error_code === 400 &&
            (error.response.description.includes('message is not modified') ||
             error.response.description.includes('message to edit not found') ||
             error.response.description.includes('message can\'t be edited'))
        ) {
          logger.info('Edit message diabaikan karena pesan sudah diedit/dihapus atau tidak berubah.');
    } else {
          logger.error('Error saat mengedit menu utama:', error);
        }
      }
    } else {
      try {
        await ctx.reply(messageText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: keyboard }
        });
      } catch (error) {
        logger.error('Error saat mengirim menu utama:', error); 
      }
    }
    logger.info('Main menu sent');
  } catch (error) {
    logger.error('Error umum saat mengirim menu utama:', error);
  }
}

bot.command('addressel', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk melakukan tindakan ini.');
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Format salah. Gunakan perintah:\n/addressel <id_telegram_user>');
    }

    const targetId = args[1];

    // Baca file ressel.db jika ada, kalau tidak, buat file baru
    let resellerList = [];
    if (fs.existsSync(resselFilePath)) {
      const fileContent = fs.readFileSync(resselFilePath, 'utf8');
      resellerList = fileContent.split('\n').filter(line => line.trim() !== '');
    }

    // Cek apakah ID sudah ada
    if (resellerList.includes(targetId)) {
      return ctx.reply(`⚠️ User dengan ID ${targetId} sudah menjadi reseller.`);
    }

    // Tambahkan ID ke file
    fs.appendFileSync(resselFilePath, `${targetId}\n`);
    ctx.reply(`✅ User dengan ID ${targetId} berhasil dijadikan reseller.`);

  } catch (e) {
    logger.error('❌ Error di command /addressel:', e.message);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});

bot.command('delressel', async (ctx) => {
  try {
    const requesterId = ctx.from.id;

    // Hanya admin yang bisa menjalankan perintah ini
    if (!adminIds.includes(requesterId)) {
      return ctx.reply('🚫 Anda tidak memiliki izin untuk melakukan tindakan ini.');
    }

    // Ambil ID Telegram dari argumen
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
      return ctx.reply('❌ Format salah. Gunakan perintah:\n/delressel <id_telegram_user>');
    }

    const targetId = args[1];

    // Cek apakah file ressel.db ada
    if (!fs.existsSync(resselFilePath)) {
      return ctx.reply('📁 File reseller belum dibuat.');
    }

    // Baca file dan filter ulang tanpa targetId
    const fileContent = fs.readFileSync(resselFilePath, 'utf8');
    const resellerList = fileContent.split('\n').filter(line => line.trim() !== '' && line.trim() !== targetId);

    // Tulis ulang file dengan data yang sudah difilter
    fs.writeFileSync(resselFilePath, resellerList.join('\n') + (resellerList.length ? '\n' : ''));

    ctx.reply(`✅ User dengan ID ${targetId} berhasil dihapus dari daftar reseller.`);

  } catch (e) {
    logger.error('❌ Error di command /delressel:', e.message);
    ctx.reply('❌ Terjadi kesalahan saat menjalankan perintah.');
  }
});

bot.command('helpadmin', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }
  const helpMessage = `
*📋 Daftar Perintah Admin:*

1. /addressel - Menambahkan Ressel baru.
2. /delressel- Menghapus id Ressel.
3. /addsaldo - Menambahkan saldo ke akun pengguna.
4. /broadcast - Mengirim pesan siaran ke semua pengguna.

Gunakan perintah ini dengan format yang benar untuk menghindari kesalahan.
`;
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⛔ Anda tidak punya izin.');
  }

  const msg = ctx.message.reply_to_message 
      ? ctx.message.reply_to_message.text 
      : ctx.message.text.split(' ').slice(1).join(' ');

  if (!msg) {
      return ctx.reply('⚠️ Harap isi pesan broadcast.');
  }

  ctx.reply('📢 Broadcast dimulai...');

  db.all("SELECT user_id FROM users", [], async (err, rows) => {
      if (err) return ctx.reply('⚠️ Error ambil data user.');

      let sukses = 0;
      let gagal = 0;
      let dihapus = 0;

      const delay = 30; // aman biar ga kena limit (30 ms)

      for (const row of rows) {
          try {
              await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                  chat_id: row.user_id,
                  text: msg
              });

              sukses++;

          } catch (error) {
              const code = error.response?.status;

              gagal++;

              // AUTO DELETE USER MATI
              if (code === 400 || code === 403) {
                  db.run("DELETE FROM users WHERE user_id = ?", [row.user_id]);
                  dihapus++;
                  console.log(`🗑️ User invalid dihapus: ${row.user_id}`);
              }

              console.log(`❌ Gagal kirim ke ${row.user_id}: ${code}`);
          }

          // Anti limit Telegram
          await new Promise(r => setTimeout(r, delay));
      }

      ctx.reply(
          `📣 *Broadcast selesai!*\n\n` +
          `✔️ Berhasil: *${sukses}*\n` +
          `❌ Gagal: *${gagal}*\n` +
          `🗑️ User dihapus: *${dihapus}*`,
          { parse_mode: 'Markdown' }
      );
  });
});

bot.action('send_main_menu', async (ctx) => {
  if (!ctx || !ctx.match) {
    return ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
  await sendMainMenu(ctx);
});

bot.action('jadi_reseller', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;

await ctx.reply(
  `📩 Hubungi admin ${ADMIN_USERNAME} untuk menjadi Reseller.\n\n` +
  `💰 <b>Minimal deposit:</b> Rp50,000\n\n` +
  `✨ <b>Fitur khusus Reseller:</b>\n` +
  `• Harga per bulan: Rp2.500\n` +
  `• Trial: Unlimited\n` +
  `• Bisa delete IP\n\n` +
  `Kirim pesan ke admin dengan format:\n` +
  `<code>Mau jadi reseller ${userId}</code>`,
  { parse_mode: 'HTML' }
);
});

bot.action('link_install', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch(e) {}

  const message = `
--------------  
OS Support  
☞ Ubuntu 20.04  
--------------  
1. Link OS Ubuntu 20.04 :  
\`apt update -y && wget https://raw.githubusercontent.com/bin456789/reinstall/main/reinstall.sh -O reinstall && chmod +x reinstall && bash reinstall ubuntu 20.04\`  

--------------  
2. Link Install v4 (Ubuntu 20.04):  
\`apt update -y && apt install screen curl wget python3-pip -y && wget -q https://raw.githubusercontent.com/arivpnstores/install/main/v4.sh -O /tmp/install && chmod +x /tmp/install && screen -S ari /tmp/install\`  

--------------  
Jika saat instalasi koneksi terputus, login VPS lagi dan jalankan:  
☞ \`screen -r ari\` atau \`screen -d -r ari\`  
--------------
`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
});

bot.command('addsaldo', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) {
      return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' });
  }

  const args = ctx.message.text.split(' ');
  if (args.length !== 3) {
      return ctx.reply('⚠️ Format salah. Gunakan: `/addsaldo <user_id> <jumlah>`', { parse_mode: 'Markdown' });
  }

  const targetUserId = parseInt(args[1]);
  const amount = parseInt(args[2]);

  if (isNaN(targetUserId) || isNaN(amount)) {
      return ctx.reply('⚠️ `user_id` dan `jumlah` harus berupa angka.', { parse_mode: 'Markdown' });
  }

  if (/\s/.test(args[1]) || /\./.test(args[1]) || /\s/.test(args[2]) || /\./.test(args[2])) {
      return ctx.reply('⚠️ `user_id` dan `jumlah` tidak boleh mengandung spasi atau titik.', { parse_mode: 'Markdown' });
  }

  db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
      if (err) {
          logger.error('⚠️ Kesalahan saat memeriksa `user_id`:', err.message);
          return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id`.', { parse_mode: 'Markdown' });
      }

      if (!row) {
          return ctx.reply('⚠️ `user_id` tidak terdaftar.', { parse_mode: 'Markdown' });
      }

      db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, targetUserId], function(err) {
          if (err) {
              logger.error('⚠️ Kesalahan saat menambahkan saldo:', err.message);
              return ctx.reply('⚠️ Kesalahan saat menambahkan saldo.', { parse_mode: 'Markdown' });
          }

          if (this.changes === 0) {
              return ctx.reply('⚠️ Pengguna tidak ditemukan.', { parse_mode: 'Markdown' });
          }

          ctx.reply(`✅ Saldo sebesar \`${amount}\` berhasil ditambahkan untuk \`user_id\` \`${targetUserId}\`.`, { parse_mode: 'Markdown' });
      });
  });
});

bot.action('register_ip', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) {}

  userState[ctx.chat.id] = {
    step: 'input_ip_register',
    userId: ctx.from.id
  };

  return ctx.reply('🌐 *Masukkan IP:*', { parse_mode: 'Markdown' });
});

const pathA = './trial.db'; // file untuk menyimpan data trial

bot.action('trial_ip', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) {}

  const userId = ctx.from.id;
  const today = new Date().toISOString().slice(0, 10); // format YYYY-MM-DD

  // ==== Cek apakah user adalah reseller ====
  let isReseller = false;
  if (fs.existsSync(resselFilePath)) {
    const resellerList = fs.readFileSync(resselFilePath, 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '');
    if (resellerList.includes(userId.toString())) {
      isReseller = true;
    }
  }

  // ==== Kalau reseller, langsung skip batas harian ====
  if (isReseller) {
    userState[ctx.chat.id] = {
      step: 'input_trial_ip',
      userId: userId
    };
    return ctx.reply('🌐 *Masukkan IP (Reseller Unli)*:', { parse_mode: 'Markdown' });
  }

  // ==== Kalau bukan reseller, cek batas harian ====
  let data = {};
  if (fs.existsSync(pathA)) {
    const fileContent = fs.readFileSync(pathA, 'utf8');
    if (fileContent) data = JSON.parse(fileContent);
  }

  if (data[userId] === today) {
    return ctx.reply('⚠️ Anda sudah melakukan trial hari ini. Silakan coba besok.', { parse_mode: 'Markdown' });
  }

  // Simpan tanggal hari ini untuk user biasa
  data[userId] = today;
  fs.writeFileSync(pathA, JSON.stringify(data, null, 2));

  userState[ctx.chat.id] = {
    step: 'input_trial_ip',
    userId: userId
  };

  return ctx.reply('🌐 *Masukkan IP:*', { parse_mode: 'Markdown' });
});


bot.action('renew_ip', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) {}

  userState[ctx.chat.id] = {
    step: 'input_ip_renew',
    userId: ctx.from.id
  };

  return ctx.reply('🌐 *Masukkan IP yang ingin diperpanjang:*', { parse_mode: 'Markdown' });
});

bot.action('ganti_ip', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) {}

  userState[ctx.chat.id] = {
    step: 'input_ip_lama',
    userId: ctx.from.id
  };

  return ctx.reply('🌐 *Masukkan IP lama yang ingin diganti:*', { parse_mode: 'Markdown' });
});

bot.action('del_ip', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (e) {}

  userState[ctx.chat.id] = {
    step: 'input_del_ip',
    userId: ctx.from.id
  };
   //izin ressel saja
    const resselDbPath = './ressel.db';
    fs.readFile(resselDbPath, 'utf8', async (err, data) => {
      if (err) {
        logger.error('❌ Gagal membaca file ressel.db:', err.message);
        return ctx.reply('❌ *Terjadi kesalahan saat membaca data reseller.*', { parse_mode: 'Markdown' });
      }

      const idUser = ctx.from.id.toString().trim();
      const resselList = data.split('\n').map(line => line.trim()).filter(Boolean);

      console.log('🧪 ID Pengguna:', idUser);
      console.log('📂 Daftar Ressel:', resselList);

      const isRessel = resselList.includes(idUser);

      if (!isRessel) {
        return ctx.reply('❌ *Fitur ini hanya untuk Ressel SC.*', { parse_mode: 'Markdown' });
      }
  //izin ressel saja
  return ctx.reply('🌐 *Masukkan IP yang ingin di hapus:*', { parse_mode: 'Markdown' });
});
});

bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id]; // ⬅️ Tambahkan ini!
  if (!state) return;

  const text = ctx.message.text.trim();

  if (state.step === 'input_ip_register') {
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
    if (!ipRegex.test(text)) {
      return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
    }

    state.ip = text;
    state.step = 'input_nama_register';
    return ctx.reply('📝 *Masukkan Nama:*', { parse_mode: 'Markdown' });
  }

  if (state.step === 'input_nama_register') {
    const nama = text;
    if (!/^[a-z0-9]+$/.test(nama)) {
      return ctx.reply('❌ *Nama hanya boleh huruf kecil dan angka tanpa spasi.*', { parse_mode: 'Markdown' });
    }

    const ip = state.ip;
    const exp = 30;
  // ==== Tentukan harga sesuai status user ====
let isReseller = false;
let totalHarga = 5000; // default untuk user biasa

if (isReseller) {
  totalHarga = 2500; // harga khusus reseller
}


db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, row) => {
      if (err || !row) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Gagal mengambil data saldo.*', { parse_mode: 'Markdown' });
      }

      if (row.saldo < totalHarga) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Saldo tidak cukup. Minimal Rp5.000*', { parse_mode: 'Markdown' });
      }

      ctx.reply('🔧 *Memproses pendaftaran IP...*', { parse_mode: 'Markdown' });

const maskedIp = ip.length > 3 
  ? `${ip.slice(0, 3)}${'x'.repeat(ip.length - 3)}` 
  : ip;

// 🔔 IP Created
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
📢 <b>IP Registered Created</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🌐 <b>IP:</b> ${maskedIp}
📛 <b>Nama:</b> ${nama}
💰 <b>Harga:</b> Rp${totalHarga.toLocaleString('id-ID')}
📆 <b>Expired:</b> ${exp || '-'} hari
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);
      const { exec } = require('child_process');
      const shellCommand = `chmod +x ./modules/* && printf "%s\\n" "3" "${ip}" | ./modules/m-ftr-admin.sh && printf "%s\\n" "1" "${ip}" "${nama}" "${exp}" | ./modules/m-ftr-admin.sh`;

      exec(shellCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ CMD ERROR:', error.message);
          return ctx.reply(`❌ *Gagal menjalankan perintah:* ${error.message}`, { parse_mode: 'Markdown' });
        }
//SALDO DATABES
// kalau sampai sini artinya tidak ada ❌, transaksi sukses
logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}`);

        db.run('UPDATE users SET saldo = saldo - ? WHERE user_id = ?', [totalHarga, ctx.from.id], (err) => {
          if (err) {
            return ctx.reply('❌ *Gagal mengurangi saldo.*', { parse_mode: 'Markdown' });
          }

          updateTotalCreateAkun(ctx);
         const cleanOutput = stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
          ctx.reply(`✅ *IP berhasil didaftarkan!*\n${cleanOutput}`, {
            parse_mode: 'Markdown'
          });
          delete userState[ctx.chat.id];
//SALDO DATABES
        });
      });
    });
  }

  if (state.step === 'input_trial_ip') {
    const text = ctx.message.text.trim();

    // Validasi IP
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
    if (!ipRegex.test(text)) {
      return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
    }

    const ip = text;
    const nama = (() => { // nama random
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let out = '';
      for (let i = 0; i < 8; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return out;
    })();
    const exp = 1;
    const totalHarga = 0; // gratis trial

db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, row) => {
      if (err || !row) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Gagal mengambil data saldo.*', { parse_mode: 'Markdown' });
      }

      if (row.saldo < totalHarga) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Saldo tidak cukup.*', { parse_mode: 'Markdown' });
      }
const maskedIp = ip.length > 3 
  ? `${ip.slice(0, 3)}${'x'.repeat(ip.length - 3)}` 
  : ip;
// 🔔 IP Trial
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
🧪 <b>IP Registered Trial</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🌐 <b>IP:</b> ${maskedIp}
📛 <b>Nama:</b> ${nama}
📆 <b>Expired:</b> ${exp || '-'} hari
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);
      ctx.reply('🔧 *Memproses pendaftaran IP trial...*', { parse_mode: 'Markdown' });

      const { exec } = require('child_process');
      const shellCommand = `chmod +x ./modules/* && printf "%s\\n" "3" "${ip}" | ./modules/m-ftr-admin.sh && printf "%s\\n" "1" "${ip}" "${nama}" "${exp}" | ./modules/m-ftr-admin.sh`;

      exec(shellCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ CMD ERROR:', error.message);
          return ctx.reply(`❌ *Gagal menjalankan perintah:* ${error.message}`, { parse_mode: 'Markdown' });
        }

        // transaksi sukses
        logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}`);

        db.run('UPDATE users SET saldo = saldo - ? WHERE user_id = ?', [totalHarga, ctx.from.id], (err) => {
          if (err) {
            return ctx.reply('❌ *Gagal mengurangi saldo.*', { parse_mode: 'Markdown' });
          }

          updateTotalCreateAkun(ctx);
          const cleanOutput = stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();

          ctx.reply(`✅ *IP trial berhasil didaftarkan!*\n👤 *Username:* \`${nama}\`\n${cleanOutput}`, {
            parse_mode: 'Markdown'
          });

          delete userState[ctx.chat.id];
        });
      });
    });
};

if (state.step === 'input_ip_lama') {
  const text = ctx.message.text.trim();

  // Validasi format IP lama (opsional)
  const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
  if (!ipRegex.test(text)) {
    return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
  }

  const ipLama = text;

  // Simpan IP lama saja, exp lama bisa diambil dari userState sebelumnya
  userState[ctx.chat.id] = {
    step: 'input_ganti_ip',
    ipLama: ipLama,
    userId: ctx.from.id
  };

  return ctx.reply('💡 *Sekarang kirimkan IP baru pengganti:*', { parse_mode: 'Markdown' });
}

if (state.step === 'input_ganti_ip') {
  const text = ctx.message.text.trim();

  // Validasi format IP baru
  const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
  if (!ipRegex.test(text)) {
    return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
  }

  const ipBaru = text;
  const { ipLama } = state;
  const totalHarga = 0; // gratis ganti IP

  ctx.reply('🔧 *Memproses penggantian IP...*', { parse_mode: 'Markdown' });

  const { exec } = require('child_process');
  const shellCommand = `
    chmod +x ./modules/* &&
    printf "%s\\n" "4" "${ipLama}" "${ipBaru}" | ./modules/m-ftr-admin.sh
  `;

  exec(shellCommand, async (error, stdout, stderr) => {
    if (error) {
      console.error('❌ CMD ERROR:', error.message);
      return ctx.reply(`❌ *Gagal menjalankan perintah:* ${error.message}`, { parse_mode: 'Markdown' });
    }

    const cleanOutput = stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
    
const maskedIpLama = ipLama.length > 3 
  ? `${ipLama.slice(0, 3)}${'x'.repeat(ipLama.length - 3)}` 
  : ipLama;

const maskedIpBaru = ipBaru.length > 3 
  ? `${ipBaru.slice(0, 3)}${'x'.repeat(ipBaru.length - 3)}` 
  : ipBaru;

// 🔔 Notifikasi ke grup admin
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
♻️ <b>IP Diganti</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🌐 <b>IP Lama:</b> ${maskedIpLama}
🌐 <b>IP Baru:</b> ${maskedIpBaru}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);

    ctx.reply(
      `✅ *IP berhasil diganti!*\n🌐 *IP Lama:* \`${ipLama}\`\n🌐 *IP Baru:* \`${ipBaru}\`\n`,
      { parse_mode: 'Markdown' }
    );

    delete userState[ctx.chat.id];
  });
}


  if (state.step === 'input_ip_renew') {
    const ip = text;
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
    if (!ipRegex.test(ip)) {
      return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
    }

    const exp = 30;
  // ==== Tentukan harga sesuai status user ====
let totalHarga = 5000; // default untuk user biasa

if (isReseller) {
  totalHarga = 2500; // harga khusus reseller
}


db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, row) => {
      if (err || !row) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Gagal mengambil data saldo.*', { parse_mode: 'Markdown' });
      }

      if (row.saldo < totalHarga) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Saldo tidak cukup. Minimal Rp5.000*', { parse_mode: 'Markdown' });
      }
const maskedIp = ip.length > 3 
  ? `${ip.slice(0, 3)}${'x'.repeat(ip.length - 3)}` 
  : ip;
// 🔔 IP Renew
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
♻️ <b>Account Renewed</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🌐 <b>IP:</b> ${maskedIp}
📛 <b>Nama:</b> ${nama}
📆 <b>New Expiry:</b> ${exp || '-'} hari
💾 <b>Quota:</b> ${quota || '-'}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);
      ctx.reply('🔧 *Memproses perpanjangan IP...*', { parse_mode: 'Markdown' });

      const { exec } = require('child_process');
      const shellCommand = `chmod +x ./modules/* && printf "%s\\n" "2" "${ip}" "${exp}" | ./modules/m-ftr-admin.sh`;

      exec(shellCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ CMD ERROR:', error.message);
          return ctx.reply(`❌ *Gagal menjalankan perintah:* ${error.message}`, { parse_mode: 'Markdown' });
        }
//SALDO DATABES
// kalau sampai sini artinya tidak ada ❌, transaksi sukses
logger.info(`✅ Transaksi sukses untuk user ${ctx.from.id}`);

        db.run('UPDATE users SET saldo = saldo - ? WHERE user_id = ?', [totalHarga, ctx.from.id], (err) => {
          if (err) {
            return ctx.reply('❌ *Gagal mengurangi saldo.*', { parse_mode: 'Markdown' });
          }

          updateTotalCreateAkun(ctx);
         const cleanOutput = stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
          ctx.reply(`✅ *IP berhasil didaftarkan!*\n${cleanOutput}`, {
            parse_mode: 'Markdown'
          });
          delete userState[ctx.chat.id];
//SALDO DATABES
        });
      });
    });
  }

    if (state.step === 'input_del_ip') {
    const ip = text;
    const ipRegex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
    if (!ipRegex.test(ip)) {
      return ctx.reply('❌ *Format IP tidak valid.* Coba lagi.', { parse_mode: 'Markdown' });
    }
  // ==== Tentukan harga sesuai status user ====
let totalHarga = 5000; // default untuk user biasa

if (isReseller) {
  totalHarga = 2500; // harga khusus reseller
}


db.get('SELECT saldo FROM users WHERE user_id = ?', [ctx.from.id], async (err, row) => {
      if (err || !row) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Gagal mengambil data saldo.*', { parse_mode: 'Markdown' });
      }

      if (row.saldo < totalHarga) {
        delete userState[ctx.chat.id];
        return ctx.reply('❌ *Saldo tidak cukup. Minimal Rp5.000*', { parse_mode: 'Markdown' });
      }
const maskedIp = ip.length > 3 
  ? `${ip.slice(0, 3)}${'x'.repeat(ip.length - 3)}` 
  : ip;
// 🔔 IP Deleted
await bot.telegram.sendMessage(
  GROUP_ID,
  `<blockquote>
🗑️ <b>IP Registered Deleted</b>
━━━━━━━━━━━━━━━━━━━━
👤 <b>User:</b> ${ctx.from.first_name} (${ctx.from.id})
🌐 <b>IP:</b> ${maskedIp}
━━━━━━━━━━━━━━━━━━━━
</blockquote>`,
  { parse_mode: 'HTML' }
);

      ctx.reply('🔧 *Memproses Menghapus IP...*', { parse_mode: 'Markdown' });

      const { exec } = require('child_process');
      const shellCommand = `chmod +x ./modules/* && printf "%s\\n" "3" "${ip}" | ./modules/m-ftr-admin.sh`;

      exec(shellCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ CMD ERROR:', error.message);
          return ctx.reply(`❌ *Gagal menjalankan perintah:* ${error.message}`, { parse_mode: 'Markdown' });
        }
          updateTotalCreateAkun(ctx);
         const cleanOutput = stdout.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').trim();
          ctx.reply(`✅ *IP berhasil didaftarkan!*\n${cleanOutput}`, {
            parse_mode: 'Markdown'
          });
          delete userState[ctx.chat.id];
      });
    });
  }
});


bot.action('addsaldo_user', async (ctx) => {
  try {
    logger.info('Add saldo user process started');
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all('SELECT user_id FROM users LIMIT 20', [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          reject(err);
        } else {
        resolve(users);
        }
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          reject(err);
        } else {
        resolve(row.count);
        }
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const currentPage = 0;
    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    if (totalUsers > 20) {
      replyMarkup.inline_keyboard.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage + 1}`
      }]);
    }

    await ctx.reply('📊 *Silakan pilih user untuk menambahkan saldo:*', {
      reply_markup: replyMarkup,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses tambah saldo user:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});
bot.action(/next_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = currentPage * 20;

  try {
    logger.info(`Next users process started for page ${currentPage + 1}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage + 1}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses next users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action(/prev_users_(\d+)/, async (ctx) => {
  const currentPage = parseInt(ctx.match[1]);
  const offset = (currentPage - 1) * 20; 

  try {
    logger.info(`Previous users process started for page ${currentPage}`);
    await ctx.answerCbQuery();

    const users = await new Promise((resolve, reject) => {
      db.all(`SELECT user_id FROM users LIMIT 20 OFFSET ${offset}`, [], (err, users) => {
        if (err) {
          logger.error('❌ Kesalahan saat mengambil daftar user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar user.*');
        }
        resolve(users);
      });
    });

    const totalUsers = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
        if (err) {
          logger.error('❌ Kesalahan saat menghitung total user:', err.message);
          return reject('⚠️ *PERHATIAN! Terjadi kesalahan saat menghitung total user.*');
        }
        resolve(row.count);
      });
    });

    const keyboard = [];
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      const username1 = await getUsernameById(users[i].user_id);
      row.push({
        text: username1 || users[i].user_id,
        callback_data: `add_saldo_${users[i].user_id}`
      });
      if (i + 1 < users.length) {
        const username2 = await getUsernameById(users[i + 1].user_id);
        row.push({
          text: username2 || users[i + 1].user_id,
          callback_data: `add_saldo_${users[i + 1].user_id}`
        });
      }
      keyboard.push(row);
    }

    const replyMarkup = {
      inline_keyboard: [...keyboard]
    };

    const navigationButtons = [];
    if (currentPage > 0) {
      navigationButtons.push([{
        text: '⬅️ Back',
        callback_data: `prev_users_${currentPage - 1}`
      }]);
    }
    if (offset + 20 < totalUsers) {
      navigationButtons.push([{
        text: '➡️ Next',
        callback_data: `next_users_${currentPage}`
      }]);
    }

    replyMarkup.inline_keyboard.push(...navigationButtons);

    await ctx.editMessageReplyMarkup(replyMarkup);
  } catch (error) {
    logger.error('❌ Kesalahan saat memproses previous users:', error);
    await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' });
  }
});

bot.action('topup_saldo', async (ctx) => {
  try {
    await ctx.answerCbQuery(); 
    const userId = ctx.from.id;
    logger.info(`🔍 User ${userId} memulai proses top-up saldo.`);
    

    if (!global.depositState) {
      global.depositState = {};
    }
    global.depositState[userId] = { action: 'request_amount', amount: '' };
    
    logger.info(`🔍 User ${userId} diminta untuk memasukkan jumlah nominal saldo.`);
    

    const keyboard = keyboard_nomor();
    
    await ctx.editMessageText('💰 *Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:*', {
      reply_markup: {
        inline_keyboard: keyboard
      },
      parse_mode: 'Markdown'
    });
  } catch (error) {
    logger.error('❌ Kesalahan saat memulai proses top-up saldo:', error);
    await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
});

bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (global.depositState && global.depositState[userId] && global.depositState[userId].action === 'request_amount') {
    await handleDepositState(ctx, userId, data);
  } else if (userStateData) {
    switch (userStateData.step) {
      case 'add_saldo':
        await handleAddSaldo(ctx, userStateData, data);
        break;
      case 'edit_batas_create_akun':
        await handleEditBatasCreateAkun(ctx, userStateData, data);
        break;
      case 'edit_limit_ip':
        await handleEditiplimit(ctx, userStateData, data);
        break;
      case 'edit_quota':
        await handleEditQuota(ctx, userStateData, data);
        break;
      case 'edit_auth':
        await handleEditAuth(ctx, userStateData, data);
        break;
      case 'edit_domain':
        await handleEditDomain(ctx, userStateData, data);
        break;
      case 'edit_harga':
        await handleEditHarga(ctx, userStateData, data);
        break;
      case 'edit_nama':
        await handleEditNama(ctx, userStateData, data);
        break;
      case 'edit_total_create_akun':
        await handleEditTotalCreateAkun(ctx, userStateData, data);
        break;
    }
  }
});

async function handleDepositState(ctx, userId, data) {
  // Cek apakah user reseller
  const isReseller = await isUserReseller(userId);
  const statusReseller = isReseller ? 'Reseller' : 'Bukan Reseller';
  const minDeposit = isReseller ? 50000 : 5000; // 100k untuk reseller, 1k untuk user biasa

  let currentAmount = global.depositState[userId].amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    const amount = Number(currentAmount) || 0;

    if (amount === 0) {
      return await ctx.answerCbQuery('⚠️ Jumlah tidak boleh kosong!', { show_alert: true });
    }
    if (amount < minDeposit) {
      return await ctx.answerCbQuery(
        `⚠️ Jumlah minimal deposit untuk ${statusReseller} adalah Rp${minDeposit.toLocaleString()}!`,
        { show_alert: true }
      );
    }

    global.depositState[userId].action = 'confirm_amount';
    await processDeposit(ctx, currentAmount);
    return;
  } else {
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ Jumlah maksimal adalah 12 digit!', { show_alert: true });
    }
  }

  global.depositState[userId].amount = currentAmount;
  const newMessage = `💰 Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda:\n\nJumlah saat ini: Rp${currentAmount || '0'}`;

  try {
    if (newMessage !== ctx.callbackQuery.message.text) {
      await ctx.editMessageText(newMessage, {
        reply_markup: { inline_keyboard: keyboard_nomor() },
        parse_mode: 'HTML'
      });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (error) {
    await ctx.answerCbQuery();
    logger.error('Error editing message:', error);
  }
}

async function handleAddSaldo(ctx, userStateData, data) {
  let currentSaldo = userStateData.saldo || '';

  if (data === 'backspace') {
    currentSaldo = currentSaldo.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentSaldo.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak boleh kosong!*', { show_alert: true });
    }

    try {
      await updateUserBalance(userStateData.userId, currentSaldo);
      ctx.reply(`✅ *Saldo user berhasil ditambahkan.*\n\n📄 *Detail Saldo:*\n- Jumlah Saldo: *Rp ${currentSaldo}*`, { parse_mode: 'Markdown' });
    } catch (error) {
      ctx.reply('❌ *Terjadi kesalahan saat menambahkan saldo user.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else if (data === 'cancel') {
    delete userState[ctx.chat.id];
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo tidak valid!*', { show_alert: true });
  } else {
    if (currentSaldo.length < 10) {
      currentSaldo += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah saldo maksimal adalah 10 karakter!*', { show_alert: true });
    }
  }

  userStateData.saldo = currentSaldo;
  const newMessage = `📊 *Silakan masukkan jumlah saldo yang ingin ditambahkan:*\n\nJumlah saldo saat ini: *${currentSaldo}*`;
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
}

async function handleEditBatasCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?');
}

async function handleEditTotalCreateAkun(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?');
}

async function handleEditiplimit(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'iplimit', 'limit IP', 'UPDATE Server SET limit_ip = ? WHERE id = ?');
}

async function handleEditQuota(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?');
}

async function handleEditAuth(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?');
}

async function handleEditDomain(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?');
}

async function handleEditHarga(ctx, userStateData, data) {
  let currentAmount = userStateData.amount || '';

  if (data === 'delete') {
    currentAmount = currentAmount.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentAmount.length === 0) {
      return await ctx.answerCbQuery('⚠️ *Jumlah tidak boleh kosong!*', { show_alert: true });
    }
    const hargaBaru = parseFloat(currentAmount);
    if (isNaN(hargaBaru) || hargaBaru <= 0) {
      return ctx.reply('❌ *Harga tidak valid. Masukkan angka yang valid.*', { parse_mode: 'Markdown' });
    }
    try {
      await updateServerField(userStateData.serverId, hargaBaru, 'UPDATE Server SET harga = ? WHERE id = ?');
      ctx.reply(`✅ *Harga server berhasil diupdate.*\n\n📄 *Detail Server:*\n- Harga Baru: *Rp ${hargaBaru}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply('❌ *Terjadi kesalahan saat mengupdate harga server.*', { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^\d+$/.test(data)) {
      return await ctx.answerCbQuery('⚠️ *Hanya angka yang diperbolehkan!*', { show_alert: true });
    }
    if (currentAmount.length < 12) {
      currentAmount += data;
    } else {
      return await ctx.answerCbQuery('⚠️ *Jumlah maksimal adalah 12 digit!*', { show_alert: true });
    }
  }

  userStateData.amount = currentAmount;
  const newMessage = `💰 *Silakan masukkan harga server baru:*\n\nJumlah saat ini: *Rp ${currentAmount}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}

async function handleEditNama(ctx, userStateData, data) {
  await handleEditField(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?');
}

async function handleEditField(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || '';

  if (data === 'delete') {
    currentValue = currentValue.slice(0, -1);
  } else if (data === 'confirm') {
    if (currentValue.length === 0) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak boleh kosong!*`, { show_alert: true });
    }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) {
      ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' });
    }
    delete userState[ctx.chat.id];
    return;
  } else {
    if (!/^[a-zA-Z0-9.-]+$/.test(data)) {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} tidak valid!*`, { show_alert: true });
    }
    if (currentValue.length < 253) {
      currentValue += data;
    } else {
      return await ctx.answerCbQuery(`⚠️ *${fieldName} maksimal adalah 253 karakter!*`, { show_alert: true });
    }
  }

  userStateData[field] = currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  if (newMessage !== ctx.callbackQuery.message.text) {
    await ctx.editMessageText(newMessage, {
      reply_markup: { inline_keyboard: keyboard_nomor() },
      parse_mode: 'Markdown'
    });
  }
}
async function updateUserSaldo(userId, saldo) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [saldo, userId], function (err) {
      if (err) {
        logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) {
        logger.error(`⚠️ Kesalahan saat mengupdate ${fieldName} server:`, err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function generateRandomAmount(baseAmount) {
  const random = Math.floor(Math.random() * 99) + 1;
  return baseAmount + random;
}

global.depositState = {};
global.pendingDeposits = {};
let lastRequestTime = 0;
const requestInterval = 1000; 

db.all('SELECT * FROM pending_deposits WHERE status = "pending"', [], (err, rows) => {
  if (err) {
    logger.error('Gagal load pending_deposits:', err.message);
    return;
  }
  rows.forEach(row => {
    global.pendingDeposits[row.unique_code] = {
      amount: row.amount,
      originalAmount: row.original_amount,
      userId: row.user_id,
      timestamp: row.timestamp,
      status: row.status,
      qrMessageId: row.qr_message_id
    };
  });
  logger.info('Pending deposit loaded:', Object.keys(global.pendingDeposits).length);
});

/*
    const qris = new QRISPayment({
    merchantId: MERCHANT_ID,
    apiKey: API_KEY,
    baseQrString: DATA_QRIS,
    logoPath: 'logo.png'
});
*/
function generateRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processDeposit(ctx, amount) {
  const currentTime = Date.now();

  if (currentTime - lastRequestTime < requestInterval) {
    await ctx.editMessageText('⚠️ *Terlalu banyak permintaan. Silakan tunggu sebentar sebelum mencoba lagi.*', { parse_mode: 'Markdown' });
    return;
  }

  lastRequestTime = currentTime;
  const userId = ctx.from.id;
  const uniqueCode = `user-${userId}-${Date.now()}`;

  // Generate final amount with random suffix
  const finalAmount = Number(amount) + generateRandomNumber(1, 300);
  const adminFee = finalAmount - Number(amount)
  try {
    const urlQr = DATA_QRIS; // QR destination
   // console.log('🔍 CEK DATA_QRIS:', urlQr);
    const axios = require('axios');
//const sharp = require('sharp'); // opsional kalau mau resize

const bayar = await axios.get(`https://api.rajaserverpremium.web.id/orderkuota/createpayment?apikey=AriApiPaymetGetwayMod&amount=${finalAmount}&codeqr=${urlQr}`);
const get = bayar.data;

if (get.status !== 'success') {
  throw new Error('Gagal membuat QRIS: ' + JSON.stringify(get));
}

const qrImageUrl = get.result.imageqris?.url;

if (!qrImageUrl || qrImageUrl.includes('undefined')) {
  throw new Error('URL QRIS tidak valid: ' + qrImageUrl);
}

// Download gambar QR
const qrResponse = await axios.get(qrImageUrl, { responseType: 'arraybuffer' });
const qrBuffer = Buffer.from(qrResponse.data);

    const caption =
      `📝 *Detail Pembayaran:*\n\n` +
                  `💰 Jumlah: Rp ${finalAmount}\n` +
      `- Nominal Top Up: Rp ${amount}\n` +
      `- Admin Fee : Rp ${adminFee}\n` +
                  `⚠️ *Penting:* Mohon transfer sesuai nominal\n` +
      `⏱️ Waktu: 5 menit\n\n` +
                  `⚠️ *Catatan:*\n` +
                  `- Pembayaran akan otomatis terverifikasi\n` +
      `- Jika pembayaran berhasil, saldo akan otomatis ditambahkan`;

    const qrMessage = await ctx.replyWithPhoto({ source: qrBuffer }, {
      caption: caption,
          parse_mode: 'Markdown'
        }); 
    // Hapus pesan input nominal setelah QR code dikirim
    try {
      await ctx.deleteMessage();
    } catch (e) {
      logger.error('Gagal menghapus pesan input nominal:', e.message);
    }

        global.pendingDeposits[uniqueCode] = {
          amount: finalAmount,
          originalAmount: amount,
          userId,
          timestamp: Date.now(),
      status: 'pending',
      qrMessageId: qrMessage.message_id
    };

    db.run(
      `INSERT INTO pending_deposits (unique_code, user_id, amount, original_amount, timestamp, status, qr_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uniqueCode, userId, finalAmount, amount, Date.now(), 'pending', qrMessage.message_id],
      (err) => {
        if (err) logger.error('Gagal insert pending_deposits:', err.message);
      }
    );
        delete global.depositState[userId];

  } catch (error) {
    logger.error('❌ Kesalahan saat memproses deposit:', error);
    await ctx.editMessageText('❌ *GAGAL! Terjadi kesalahan saat memproses pembayaran. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    delete global.depositState[userId];
    delete global.pendingDeposits[uniqueCode];
    db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
      if (err) logger.error('Gagal hapus pending_deposits (error):', err.message);
    });
  }
}

async function checkQRISStatus() {
  try {
    const pendingDeposits = Object.entries(global.pendingDeposits);

    for (const [uniqueCode, deposit] of pendingDeposits) {
      if (deposit.status !== 'pending') continue;

      const depositAge = Date.now() - deposit.timestamp;
      if (depositAge > 5 * 60 * 1000) {
        try {
          if (deposit.qrMessageId) {
            await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
          }
          await bot.telegram.sendMessage(
            deposit.userId,
            '❌ *Pembayaran Expired*\n\n' +
              'Waktu pembayaran telah habis. Silakan klik Top Up lagi untuk mendapatkan QR baru.',
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          logger.error('Error deleting expired payment messages:', error);
        }

        delete global.pendingDeposits[uniqueCode];
        db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
          if (err) logger.error('Gagal hapus pending_deposits (expired):', err.message);
        });
        continue;
      }

      try {
        const data = buildPayload(); // payload selalu fresh
        const resultcek = await axios.post(API_URL, data, { headers, timeout: 5000 });

        // API balik teks (bukan JSON)
        const responseText = resultcek.data;
        //console.log('📦 Raw response from API:\n', responseText);

        // Parse teks jadi array transaksi
        const transaksiList = [];
        const blocks = responseText.split('------------------------').filter(Boolean);

        for (const block of blocks) {
          const kreditMatch = block.match(/Kredit\s*:\s*([\d.]+)/);
          const tanggalMatch = block.match(/Tanggal\s*:\s*(.+)/);
          const brandMatch = block.match(/Brand\s*:\s*(.+)/);
          if (kreditMatch) {
            transaksiList.push({
              tanggal: tanggalMatch ? tanggalMatch[1].trim() : '-',
              kredit: Number(kreditMatch[1].replace(/\./g, '')),
              brand: brandMatch ? brandMatch[1].trim() : '-'
            });
          }
        }

        // Debug hasil parsing
        console.log('✅ Parsed transaksi:', transaksiList);

        // Cocokkan nominal
        const expectedAmount = deposit.amount;
        const matched = transaksiList.find(t => t.kredit === expectedAmount);

        if (matched) {
          const success = await processMatchingPayment(deposit, matched, uniqueCode);
          if (success) {
            logger.info(`Payment processed successfully for ${uniqueCode}`);
            delete global.pendingDeposits[uniqueCode];
            db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode], (err) => {
              if (err) logger.error('Gagal hapus pending_deposits (success):', err.message);
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking payment status for ${uniqueCode}:`, error.message);
      }
    }
  } catch (error) {
    logger.error('Error in checkQRISStatus:', error);
  }
}

function keyboard_abc() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

function keyboard_nomor() {
  const alphabet = '1234567890';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

function keyboard_full() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({
      text: char,
      callback_data: char
    }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
  return buttons;
}

global.processedTransactions = new Set();
async function updateUserBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, userId], function(err) {
        if (err) {
        logger.error('⚠️ Kesalahan saat mengupdate saldo user:', err.message);
          reject(err);
      } else {
        resolve();
        }
    });
  });
}

async function getUserBalance(userId) {
  return new Promise((resolve, reject) => {
    db.get("SELECT saldo FROM users WHERE user_id = ?", [userId], function(err, row) {
        if (err) {
        logger.error('⚠️ Kesalahan saat mengambil saldo user:', err.message);
          reject(err);
      } else {
        resolve(row ? row.saldo : 0);
        }
    });
  });
}

async function sendPaymentSuccessNotification(userId, deposit, currentBalance) {
  try {
    // Hitung admin fee
    const adminFee = deposit.amount - deposit.originalAmount;
    await bot.telegram.sendMessage(userId,
      `✅ *Pembayaran Berhasil!*\n\n` +
      `💰 Jumlah Deposit: Rp ${deposit.originalAmount}\n` +
      `💰 Biaya Admin: Rp ${adminFee}\n` +
      `💰 Total Pembayaran: Rp ${deposit.amount}\n` +
      `💳 Saldo Sekarang: Rp ${currentBalance}`,
      { parse_mode: 'Markdown' }
    );
    return true;
  } catch (error) {
    logger.error('Error sending payment notification:', error);
    return false;
  }
}

async function processMatchingPayment(deposit, matchingTransaction, uniqueCode) {
  const transactionKey = `${matchingTransaction.reference_id || uniqueCode}_${matchingTransaction.amount}`;
  // Use a database transaction to ensure atomicity
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      // First check if transaction was already processed
      db.get('SELECT id FROM transactions WHERE reference_id = ? AND amount = ?', 
        [matchingTransaction.reference_id || uniqueCode, matchingTransaction.amount], 
        (err, row) => {
          if (err) {
            db.run('ROLLBACK');
            logger.error('Error checking transaction:', err);
            reject(err);
            return;
          }
          if (row) {
            db.run('ROLLBACK');
    logger.info(`Transaction ${transactionKey} already processed, skipping...`);
            resolve(false);
            return;
          }
          // Update user balance
          db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', 
            [deposit.originalAmount, deposit.userId], 
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                logger.error('Error updating balance:', err);
                reject(err);
                return;
              }
    // Record the transaction
      db.run(
                'INSERT INTO transactions (user_id, amount, type, reference_id, timestamp) VALUES (?, ?, ?, ?, ?)',
                [deposit.userId, deposit.originalAmount, 'deposit', matchingTransaction.reference_id || uniqueCode, Date.now()],
        (err) => {
                  if (err) {
                    db.run('ROLLBACK');
                    logger.error('Error recording transaction:', err);
                    reject(err);
                    return;
                  }
                  // Get updated balance
                  db.get('SELECT saldo FROM users WHERE user_id = ?', [deposit.userId], async (err, user) => {
                    if (err) {
                      db.run('ROLLBACK');
                      logger.error('Error getting updated balance:', err);
                      reject(err);
                      return;
                    }
                    // Send notification using sendPaymentSuccessNotification
    const notificationSent = await sendPaymentSuccessNotification(
      deposit.userId,
      deposit,
                      user.saldo
                    );
                    // Delete QR code message after payment success
                    if (deposit.qrMessageId) {
                      try {
                        await bot.telegram.deleteMessage(deposit.userId, deposit.qrMessageId);
                      } catch (e) {
                        logger.error("Gagal menghapus pesan QR code:", e.message);
                      }
                    }
    if (notificationSent) {
      // Notifikasi ke grup untuk top up
      try {
        // Pada notifikasi ke grup (top up dan pembelian/renew), ambil info user:
        let userInfo;
        try {
          userInfo = await bot.telegram.getChat(deposit ? deposit.userId : (ctx ? ctx.from.id : ''));
        } catch (e) {
          userInfo = {};
        }
        const username = userInfo.username ? `@${userInfo.username}` : (userInfo.first_name || (deposit ? deposit.userId : (ctx ? ctx.from.id : '')));
        const userDisplay = userInfo.username
          ? `${username} (${deposit ? deposit.userId : (ctx ? ctx.from.id : '')})`
          : `${username}`;
        await bot.telegram.sendMessage(
          GROUP_ID,
          `<blockquote>
✅ <b>Top Up Berhasil</b>
👤 User: ${userDisplay}
💰 Nominal: <b>Rp ${deposit.originalAmount}</b>
🏦 Saldo Sekarang: <b>Rp ${user.saldo}</b>
🕒 Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
</blockquote>`,
          { parse_mode: 'HTML' }
        );
      } catch (e) { logger.error('Gagal kirim notif top up ke grup:', e.message); }
      // Hapus semua file di receipts setelah pembayaran sukses
      try {
        const receiptsDir = path.join(__dirname, 'receipts');
        if (fs.existsSync(receiptsDir)) {
          const files = fs.readdirSync(receiptsDir);
          for (const file of files) {
            fs.unlinkSync(path.join(receiptsDir, file));
          }
        }
      } catch (e) { logger.error('Gagal menghapus file di receipts:', e.message); }
      db.run('COMMIT');
      global.processedTransactions.add(transactionKey);
      delete global.pendingDeposits[uniqueCode];
      db.run('DELETE FROM pending_deposits WHERE unique_code = ?', [uniqueCode]);
      resolve(true);
    } else {
      db.run('ROLLBACK');
      reject(new Error('Failed to send payment notification.'));
    }
                  });
                }
              );
            }
          );
        }
      );
    });
  });
}

setInterval(checkQRISStatus, 10000);

async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run(
      'INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()],
      (err) => {
        if (err) {
          logger.error('Error recording account transaction:', err.message);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

app.listen(port, () => {
  bot.launch().then(() => {
      logger.info('Bot telah dimulai');
  }).catch((error) => {
      logger.error('Error saat memulai bot:', error);
  });
  logger.info(`Server berjalan di port ${port}`);
});