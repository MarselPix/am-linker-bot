require('dotenv').config();
const http = require('http');
let TelegramBot = require('node-telegram-bot-api');

// Mini web server pancingan untuk Render (agar tidak sleep)
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('Bot is running!');
  res.end();
}).listen(port, () => {
  console.log(`Server pancingan Render berjalan di port ${port}`);
});

// Pastikan import constructor kompatibel dengan berbagai versi package
if (TelegramBot.TelegramBot) {
  TelegramBot = TelegramBot.TelegramBot;
} else if (TelegramBot.default) {
  TelegramBot = TelegramBot.default;
}

// Ambil token dari environment
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('ERROR: TELEGRAM_BOT_TOKEN belum dikonfigurasi di file .env!');
  process.exit(1);
}

// Inisialisasi bot dengan polling
const bot = new TelegramBot(token, { polling: true });

// Objek untuk menyimpan session aktif per user
// Struktur: { chatId: { intervalId, timeoutId, email, existingLinks } }
const sessions = {};

// Regex untuk mendeteksi email
const emailRegex = /^[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}$/;

console.log('Bot Telegram Alight Motion Linker berhasil dijalankan!');

// Handler untuk command /start atau /help
bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  // Hentikan session aktif jika ada
  clearActiveSession(chatId);

  const instructions = `<b>Alight Motion Login Assistant</b>

Halo! Bot ini membantu kamu mengambil link login Alight Motion dari generator.email secara real-time langsung ke Telegram.

<b>Cara Penggunaan:</b>
1. Salin email dari website generator.email.
2. Masukkan email tersebut ke aplikasi Alight Motion untuk login.
3. Kirim alamat email tersebut ke bot ini.
4. Bot akan memantau inbox email tersebut selama 3 menit.
5. Begitu link login masuk, bot akan langsung mengirimkannya ke kamu.

Silakan kirim alamat email generator.email kamu sekarang untuk mulai.`;

  bot.sendMessage(chatId, instructions, { parse_mode: 'HTML' });
});

// Handler untuk semua pesan teks
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  // Abaikan command /start atau /help agar tidak diproses ganda
  if (text.startsWith('/start') || text.startsWith('/help')) {
    return;
  }

  // Cek apakah pesan adalah alamat email
  if (emailRegex.test(text)) {
    const email = text.toLowerCase();
    const parts = email.split('@');
    const user = parts[0];
    const domain = parts[1];

    // Hentikan session aktif sebelumnya jika ada
    const hasPrevious = clearActiveSession(chatId);
    if (hasPrevious) {
      bot.sendMessage(chatId, '🔄 <i>Pemantauan email sebelumnya dihentikan.</i>', { parse_mode: 'HTML' });
    }

    try {
      // 1. Cek langsung ke inbox saat pertama kali email dikirim
      const currentLinks = await fetchAllAlightLinks(user, domain);
      
      if (currentLinks.length > 0) {
        // Jika langsung menemukan link, kirimkan segera dan selesai!
        const latestLink = currentLinks[0];
        bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${latestLink}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${latestLink}</code>\n\n⚠️ <i>Catatan: Jika link di atas kadaluarsa atau tidak bekerja, silakan lakukan permintaan login baru di aplikasi Alight Motion, lalu kirim kembali alamat email kamu ke bot ini.</i>`, { parse_mode: 'HTML' });
        return;
      }

      // 2. Jika belum ada link, masuk ke mode pemantauan (polling) selama 3 menit
      bot.sendMessage(chatId, `🔍 <b>Link login belum ditemukan di inbox.</b>\n\nMemulai pemantauan untuk: <code>${email}</code>\nBot akan memantau inbox selama 3 menit. Silakan lakukan permintaan login di aplikasi Alight Motion sekarang...`, { parse_mode: 'HTML' });

      const existingLinks = new Set(currentLinks);

      // Setup polling interval (setiap 5 detik)
      const intervalId = setInterval(async () => {
        try {
          const links = await fetchAllAlightLinks(user, domain);
          
          // Cari link baru yang belum ada di initial check
          const newLink = links.find(link => !existingLinks.has(link));

          if (newLink) {
            // Berhasil menemukan link baru!
            bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${newLink}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${newLink}</code>`, { parse_mode: 'HTML' });
            
            // Hentikan pemantauan
            clearActiveSession(chatId);
          }
        } catch (pollErr) {
          console.error(`[${email}] Error saat polling:`, pollErr.message);
        }
      }, 5000);

      // Setup timeout (3 menit = 180000 ms)
      const timeoutId = setTimeout(() => {
        bot.sendMessage(chatId, `⚠️ <b>Waktu Pemantauan Habis</b>\n\nBot telah memantau email <code>${email}</code> selama 3 menit dan tidak menemukan link baru. Silakan kirim email lagi jika ingin memantau ulang.`, { parse_mode: 'HTML' });
        clearActiveSession(chatId);
      }, 180000);

      // Simpan session
      sessions[chatId] = {
        intervalId,
        timeoutId,
        email,
        existingLinks
      };

    } catch (err) {
      console.error(`[${email}] Gagal mengakses generator.email:`, err);
      bot.sendMessage(chatId, '❌ Gagal mengakses generator.email. Pastikan email yang dimasukkan benar dan coba lagi beberapa saat lagi.', { parse_mode: 'HTML' });
    }
  } else {
    // Jika input bukan email dan bukan command
    bot.sendMessage(chatId, '⚠️ Format email tidak valid. Silakan kirim alamat email generator.email yang benar (contoh: <code>kamu@gmailxsn.com</code>).', { parse_mode: 'HTML' });
  }
});

/**
 * Fungsi untuk menghentikan session pemantauan aktif
 * @param {number} chatId 
 * @returns {boolean} True jika ada session yang dihentikan
 */
function clearActiveSession(chatId) {
  if (sessions[chatId]) {
    clearInterval(sessions[chatId].intervalId);
    clearTimeout(sessions[chatId].timeoutId);
    delete sessions[chatId];
    return true;
  }
  return false;
}

/**
 * Mengambil semua link Alight Motion yang ada saat ini di inbox
 * @param {string} user 
 * @param {string} domain 
 * @returns {Promise<string[]>}
 */
async function fetchAllAlightLinks(user, domain) {
  // 1. Fetch halaman utama inbox
  const url = `https://generator.email/${domain}/${user}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': `embx=%5B%22${user}%40${domain}%22%5D; surl=${domain}%2F${user}`,
      'Referer': 'https://generator.email/'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const html = await response.text();

  // 2. Cari semua link email spesifik di list
  const rowRegex = /href=["'](\/[a-zA-Z0-9.\-_]+\/[a-zA-Z0-9.\-_]+\/[a-f0-9]{32})["'][^>]*>\s*<div class="[^"]*from_div_[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  
  let match;
  const alightPaths = [];
  while ((match = rowRegex.exec(html)) !== null) {
    const path = match[1];
    const sender = match[2].trim().toLowerCase();
    
    // Cek apakah email berasal dari Alight Motion
    if (sender.includes('alight') || sender.includes('firebaseapp')) {
      alightPaths.push(path);
    }
  }

  // Jika tidak ditemukan email spesifik dari Alight di list
  if (alightPaths.length === 0) {
    // Fallback: coba langsung ekstrak dari halaman utama (jika hanya ada 1 email biasanya ter-render langsung)
    return extractAlightLinks(html);
  }

  // 3. Ambil isi email dari path terbaru (indeks 0, email paling baru)
  // Format newestPath: /domain/user/hash
  const newestPath = alightPaths[0];
  const parts = newestPath.split('/');
  const hash = parts[3]; // Ambil hash di paling belakang
  
  // generator.email membutuhkan surl cookie bernilai "domain/user/hash" agar mau mengembalikan isi email
  const specificSurl = `${domain}%2F${user}%2F${hash}`;
  const emailUrl = `https://generator.email/`;
  
  const emailRes = await fetch(emailUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': `embx=%5B%22${user}%40${domain}%22%5D; surl=${specificSurl}`,
      'Referer': 'https://generator.email/'
    }
  });

  if (!emailRes.ok) {
    throw new Error(`HTTP error fetching email body! status: ${emailRes.status}`);
  }

  const emailHtml = await emailRes.text();
  return extractAlightLinks(emailHtml);
}

/**
 * Mengambil link Alight Motion saat pertama kali memantau (untuk blacklist/ignored)
 * @param {string} user 
 * @param {string} domain 
 * @returns {Promise<Set<string>>}
 */
async function fetchExistingLinks(user, domain) {
  try {
    const links = await fetchAllAlightLinks(user, domain);
    return new Set(links);
  } catch (err) {
    console.error('Gagal mengambil initial links:', err.message);
    return new Set();
  }
}

/**
 * Regex extractor untuk mencari link Alight Motion
 * @param {string} html 
 * @returns {string[]}
 */
function extractAlightLinks(html) {
  const links = new Set();
  
  // 1. Ekstrak dari href="..."
  const hrefRegex = /href=["'](https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:alightcreative\.com|alightmotion\.com|alight\.link|alight-creative\.firebaseapp\.com)[^"']*)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    links.add(match[1]);
  }
  
  // 2. Ekstrak dari URL mentah (raw text)
  const rawRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:alightcreative\.com|alightmotion\.com|alight\.link|alight-creative\.firebaseapp\.com)\/[a-zA-Z0-9.\-_?&=%/~:+]*/gi;
  while ((match = rawRegex.exec(html)) !== null) {
    let link = match[0];
    // Bersihkan karakter penutup HTML jika ikut ter-capture
    if (link.endsWith('"') || link.endsWith("'") || link.endsWith('>')) {
      link = link.substring(0, link.length - 1);
    }
    links.add(link);
  }
  
  // Filter link statis/bukan link login
  return Array.from(links).filter(link => {
    const url = link.toLowerCase();
    
    // Filter gambar/asset
    if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.svg')) {
      return false;
    }
    
    // Filter homepage/support
    if (url === 'https://alightcreative.com' || url === 'https://alightcreative.com/') {
      return false;
    }
    if (url === 'https://alightmotion.com' || url === 'https://alightmotion.com/') {
      return false;
    }
    if (url.includes('support.alightmotion.com')) {
      return false;
    }
    
    return true;
  });
}
