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

// Regex untuk mendeteksi email di dalam pesan
const emailRegex = /[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/;

console.log('Bot Telegram Alight Motion Linker berhasil dijalankan!');

// Handler untuk command /start atau /help
bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;
  
  // Hentikan session aktif jika ada
  clearActiveSession(chatId);

  const instructions = `<b>Alight Motion Login Assistant</b>

Halo! Bot ini membantu kamu mengambil link login Alight Motion dari <b>generator.email</b> dan <b>emailqu.com</b> secara real-time langsung ke Telegram.

<b>Cara Penggunaan:</b>
1. Masukkan alamat email dari generator.email / emailqu.com ke aplikasi Alight Motion untuk login.
2. Kirim alamat email tersebut ke bot ini.
3. Bot akan memantau inbox email tersebut selama 3 menit.
4. Begitu link login masuk, bot akan langsung mengirimkannya ke kamu.

Silakan kirim alamat email kamu sekarang untuk mulai.`;

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

  // Cek apakah pesan mengandung alamat email
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    const parts = email.split('@');
    const user = parts[0];
    const domain = parts[1];

    // Hentikan session aktif sebelumnya jika ada
    const hasPrevious = clearActiveSession(chatId);
    if (hasPrevious) {
      bot.sendMessage(chatId, '🔄 <i>Pemantauan email sebelumnya dihentikan.</i>', { parse_mode: 'HTML' });
    }

    try {
      // Tentukan provider email secara otomatis lewat verify API
      const provider = await checkEmailProvider(domain);
      console.log(`[${email}] Domain provider terdeteksi: ${provider}`);

      if (provider === 'emailqu') {
        // --- JALUR EMAILQU.COM ---
        const result = await fetchNewestEmailQuLink(email);
        
        if (result.link) {
          // Jika langsung menemukan link, kirimkan segera dan selesai!
          bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${result.link}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${result.link}</code>\n\n⚠️ <i>Catatan: Jika link di atas kadaluarsa atau tidak bekerja, silakan lakukan permintaan login baru di aplikasi Alight Motion, lalu kirim kembali alamat email kamu ke bot ini.</i>`, { parse_mode: 'HTML' });
          return;
        }

        // Jika belum ada link, masuk ke mode pemantauan (polling) selama 3 menit
        bot.sendMessage(chatId, `🔍 <b>Link login belum ditemukan di inbox.</b>\n\nMemulai pemantauan untuk: <code>${email}</code> (via EmailQu)\nBot akan memantau inbox selama 3 menit. Silakan lakukan permintaan login di aplikasi Alight Motion sekarang...`, { parse_mode: 'HTML' });

        const existingEmailId = result.emailId;

        // Setup polling interval (setiap 8 detik)
        const intervalId = setInterval(async () => {
          try {
            const pollResult = await fetchNewestEmailQuLink(email);

            // Cek jika ada email baru (ID berbeda dengan existing)
            if (pollResult.link && pollResult.emailId !== existingEmailId) {
              bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${pollResult.link}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${pollResult.link}</code>`, { parse_mode: 'HTML' });
              
              // Hentikan pemantauan
              clearActiveSession(chatId);
            }
          } catch (pollErr) {
            console.error(`[${email}] Error saat polling EmailQu:`, pollErr.message);
          }
        }, 8000);

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
          existingEmailId
        };

      } else {
        // --- JALUR GENERATOR.EMAIL ---
        const result = await fetchNewestAlightLink(user, domain, null);
        
        if (result.link) {
          // Jika langsung menemukan link, kirimkan segera dan selesai!
          bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${result.link}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${result.link}</code>\n\n⚠️ <i>Catatan: Jika link di atas kadaluarsa atau tidak bekerja, silakan lakukan permintaan login baru di aplikasi Alight Motion, lalu kirim kembali alamat email kamu ke bot ini.</i>`, { parse_mode: 'HTML' });
          return;
        }

        // Jika belum ada link, masuk ke mode pemantauan (polling) selama 3 menit
        bot.sendMessage(chatId, `🔍 <b>Link login belum ditemukan di inbox.</b>\n\nMemulai pemantauan untuk: <code>${email}</code> (via GeneratorEmail)\nBot akan memantau inbox selama 3 menit. Silakan lakukan permintaan login di aplikasi Alight Motion sekarang...`, { parse_mode: 'HTML' });

        // Catat hash yang sudah ada (biar diabaikan saat polling)
        const existingHashes = new Set();
        if (result.newestHash) {
          existingHashes.add(result.newestHash);
        }

        // Setup polling interval (setiap 8 detik)
        const intervalId = setInterval(async () => {
          try {
            // Cari link baru dengan mengabaikan hash lama
            const pollResult = await fetchNewestAlightLink(user, domain, existingHashes);

            if (pollResult.link) {
              // Berhasil menemukan link baru!
              bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${pollResult.link}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${pollResult.link}</code>`, { parse_mode: 'HTML' });
              
              // Hentikan pemantauan
              clearActiveSession(chatId);
            } else if (pollResult.newestHash) {
              // Jika ada hash baru tapi link tidak berhasil diekstrak, abaikan
              existingHashes.add(pollResult.newestHash);
            }
          } catch (pollErr) {
            console.error(`[${email}] Error saat polling GeneratorEmail:`, pollErr.message);
          }
        }, 8000);

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
          existingHashes
        };
      }

    } catch (err) {
      console.error(`[${email}] Gagal memproses kotak masuk email:`, err);
      bot.sendMessage(chatId, `❌ <b>Gagal mengakses kotak masuk email:</b>\n<code>${err.message}</code>\n\nPastikan alamat email benar dan coba lagi beberapa saat lagi.`, { parse_mode: 'HTML' });
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
 * Cek apakah domain terdaftar di EmailQu
 * @param {string} domain 
 * @returns {Promise<'emailqu' | 'generator_email'>}
 */
async function checkEmailProvider(domain) {
  try {
    const url = `https://emailqu.com/api/domain/verify/${domain}`;
    const resText = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, 10000, 2); // 10s timeout, 2 retries
    
    const json = JSON.parse(resText);
    if (json && json.success && json.verified === true) {
      return 'emailqu';
    }
  } catch (err) {
    console.warn(`Gagal verifikasi domain ${domain} ke EmailQu:`, err.message);
  }
  return 'generator_email';
}

/**
 * Mengambil link login Alight Motion terbaru dari EmailQu
 * @param {string} email 
 * @returns {Promise<{ link: string | null, emailId: number | null }>}
 */
async function fetchNewestEmailQuLink(email) {
  const url = `https://emailqu.com/api/public/emails/${encodeURIComponent(email)}`;
  
  const resText = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  }, 15000, 3); // 15s timeout, 3 retries
  
  const json = JSON.parse(resText);
  if (json && json.success && json.emails && json.emails.length > 0) {
    // Cari email dari Alight Motion
    const alightEmail = json.emails.find(e => {
      const from = (e.from || '').toLowerCase();
      return from.includes('alight') || from.includes('firebaseapp');
    });
    
    if (alightEmail) {
      const content = alightEmail.body_html || alightEmail.body_text || '';
      const links = extractAlightLinks(content);
      return { link: links[0] || null, emailId: alightEmail.id };
    }
  }
  
  return { link: null, emailId: null };
}

/**
 * Custom fetch helper dengan support timeout dan automatic retries
 * @param {string} url 
 * @param {object} options 
 * @param {number} timeoutMs 
 * @param {number} retries 
 * @returns {Promise<string>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timeoutId);
      
      // Jika ini adalah percobaan terakhir, lempar errornya
      if (attempt === retries) {
        throw err;
      }
      
      // Tampilkan log retry
      console.log(`[Attempt ${attempt}/${retries}] Fetch failed (${err.message}). Retrying in 1.5s...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

// List mirror generator.email untuk failover otomatis jika domain utama lambat/diblokir
const MIRRORS = [
  'https://generator.email',
  'https://uk.generator.email',
  'https://de.generator.email',
  'https://fr.generator.email'
];

/**
 * Mencoba memanggil path tertentu dari list mirror generator.email sampai sukses
 * @param {string} path 
 * @param {object} options 
 * @param {number} timeoutMs 
 * @returns {Promise<{ text: string, usedMirror: string }>}
 */
async function fetchFromMirrors(path, options = {}, timeoutMs = 15000) {
  let lastError = null;
  
  for (let i = 0; i < MIRRORS.length; i++) {
    const mirror = MIRRORS[i];
    // Ganti host target jika URL yang di-pass berupa URL lengkap, atau susun URL baru
    const fullUrl = path.startsWith('http') ? path.replace(/https?:\/\/[^/]+/, mirror) : `${mirror}${path}`;
    
    console.log(`[Mirror Attempt ${i + 1}/${MIRRORS.length}] Fetching: ${fullUrl}`);
    
    try {
      const text = await fetchWithTimeout(fullUrl, options, timeoutMs, 1); // Cukup 1x per mirror
      return { text, usedMirror: mirror };
    } catch (err) {
      console.warn(`[Mirror ${mirror}] Failed: ${err.message}`);
      lastError = err;
    }
  }
  
  throw lastError || new Error('All generator.email mirrors failed');
}

/**
 * Mencari link Alight Motion baru di inbox dengan mencocokkan list hash
 * @param {string} user
 * @param {string} domain
 * @param {Set<string>} ignoreHashes Hash yang akan diabaikan (karena sudah ada sebelumnya)
 * @returns {Promise<{ link: string | null, newestHash: string | null }>}
 */
async function fetchNewestAlightLink(user, domain, ignoreHashes) {
  // 1. Fetch halaman utama inbox dari mirror yang merespon paling cepat
  const indexPath = `/${domain}/${user}`;
  const indexResult = await fetchFromMirrors(indexPath, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': `embx=%5B%22${user}%40${domain}%22%5D; surl=${domain}%2F${user}`,
      'Referer': 'https://generator.email/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
    }
  }, 15000);

  const indexHtml = indexResult.text;
  const activeMirror = indexResult.usedMirror;

  // 2. Cari semua link email spesifik di list
  const rowRegex = /href=["'](\/[a-zA-Z0-9.\-_]+\/[a-zA-Z0-9.\-_]+\/[a-f0-9]{32})["'][^>]*>\s*<div class="[^"]*from_div_[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  
  let match;
  const alightHashes = [];
  while ((match = rowRegex.exec(indexHtml)) !== null) {
    const path = match[1];
    const sender = match[2].trim().toLowerCase();
    
    // Cek apakah email berasal dari Alight Motion
    if (sender.includes('alight') || sender.includes('firebaseapp')) {
      const parts = path.split('/');
      const hash = parts[3]; // Ambil hash di paling belakang
      if (hash) {
        alightHashes.push(hash);
      }
    }
  }

  // Jika tidak ditemukan email spesifik dari Alight di list
  if (alightHashes.length === 0) {
    // Fallback: coba langsung ekstrak dari halaman utama
    const links = extractAlightLinks(indexHtml);
    return { link: links[0] || null, newestHash: null };
  }

  const newestHash = alightHashes[0];

  // Jika hash terbaru sudah ada sebelumnya, abaikan (hemat request)
  if (ignoreHashes && ignoreHashes.has(newestHash)) {
    return { link: null, newestHash };
  }

  // 3. Ambil isi email spesifik dari mirror yang sama (agar session cookie valid)
  const specificSurl = `${domain}%2F${user}%2F${newestHash}`;
  const emailPath = `/`;
  
  const emailHtml = await fetchWithTimeout(`${activeMirror}${emailPath}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': `embx=%5B%22${user}%40${domain}%22%5D; surl=${specificSurl}`,
      'Referer': `${activeMirror}/`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive'
    }
  }, 15000, 2); // Coba maksimal 2 kali untuk email body di mirror ini

  const links = extractAlightLinks(emailHtml);
  return { link: links[0] || null, newestHash };
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
