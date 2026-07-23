const TelegramBot = require('node-telegram-bot-api');

// Ambil token dari environment
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);

// Regex untuk mendeteksi email di dalam pesan
const emailRegex = /[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/;

// List mirror generator.email untuk failover otomatis jika domain utama lambat/diblokir
const MIRRORS = [
  'https://generator.email',
  'https://uk.generator.email',
  'https://de.generator.email',
  'https://fr.generator.email'
];

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const { body } = req;
      if (body && body.message) {
        const msg = body.message;
        const chatId = msg.chat.id;
        const text = msg.text ? msg.text.trim() : '';

        // Abaikan command /start atau /help agar tidak diproses ganda
        if (text.startsWith('/start') || text.startsWith('/help')) {
          const instructions = `<b>Alight Motion Login Assistant</b>

Halo! Bot ini membantu kamu mengambil link login Alight Motion dari <b>generator.email</b> atau <b>emailqu.com</b> secara instan.

<b>Cara Penggunaan (Agar Instan):</b>
1. Lakukan permintaan login di aplikasi Alight Motion.
2. <b>Tunggu 15-20 detik</b> agar email verifikasi masuk ke inbox.
3. Kirim alamat email tersebut ke bot ini.
4. Bot akan langsung memeriksa inbox dan mengirimkan link login ke kamu.

Silakan kirim alamat email kamu sekarang untuk mulai.`;

          await bot.sendMessage(chatId, instructions, { parse_mode: 'HTML' });
          res.status(200).send('OK');
          return;
        }

        // Cek apakah pesan mengandung alamat email
        const emailMatch = text.match(emailRegex);
        if (emailMatch) {
          const email = emailMatch[0].toLowerCase();
          const parts = email.split('@');
          const user = parts[0];
          const domain = parts[1];

          // Beri tahu user bahwa bot sedang memeriksa
          const loadingMsg = await bot.sendMessage(chatId, '?? <i>Sedang memeriksa kotak masuk email kamu, mohon tunggu sebentar...</i>', { parse_mode: 'HTML' });

          try {
            const provider = await checkEmailProvider(domain);
            console.log(`[${email}] Domain provider terdeteksi: ${provider}`);

            let resultLink = null;

            // Cek inbox sebanyak 3 kali dengan jeda 3-4 detik (total ~7 detik)
            // Ini memberi waktu toleransi jika email baru saja dikirim oleh Firebase
            for (let attempt = 1; attempt <= 3; attempt++) {
              if (provider === 'emailqu') {
                const result = await fetchNewestEmailQuLink(email);
                resultLink = result.link;
              } else {
                const result = await fetchNewestAlightLink(user, domain, null);
                resultLink = result.link;
              }

              if (resultLink) {
                break; // Jika link ditemukan, langsung kirim
              }

              if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 3000));
              }
            }

            // Hapus pesan loading
            await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

            if (resultLink) {
              await bot.sendMessage(chatId, `✅ <b>Link Login Alight Motion Ditemukan!</b>\n\n<b>1. Klik untuk Langsung Login:</b>\n<a href="${resultLink}">👉 Klik di Sini untuk Login</a>\n\n<b>2. Klik untuk Salin Link (Auto Copy):</b>\n<code>${resultLink}</code>\n\n⚠️ <i>Catatan: Jika link di atas kadaluarsa atau tidak bekerja, silakan lakukan permintaan login baru di aplikasi Alight Motion, lalu kirim kembali alamat email kamu ke bot ini.</i>`, { parse_mode: 'HTML' });
            } else {
              await bot.sendMessage(chatId, `❌ <b>Link login belum ditemukan di inbox.</b>\n\nSilakan lakukan permintaan login baru di aplikasi Alight Motion, tunggu sekitar 10 detik agar emailnya masuk, lalu kirim kembali alamat email kamu ke bot ini.`, { parse_mode: 'HTML' });
            }

          } catch (err) {
            console.error(`[${email}] Gagal memproses kotak masuk email:`, err);
            await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
            await bot.sendMessage(chatId, `⚠️ <b>Gagal mengakses kotak masuk email:</b>\n<code>${err.message}</code>\n\nPastikan alamat email benar dan coba lagi beberapa saat lagi.`, { parse_mode: 'HTML' });
          }
        } else {
          await bot.sendMessage(chatId, '?? Format email tidak valid. Silakan kirim alamat email generator.email / emailqu.com yang benar.', { parse_mode: 'HTML' });
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Error handling webhook update:', err);
    res.status(200).send('OK'); // Selalu return 200 agar Telegram tidak melakukan retry terus-menerus saat error
  }
};

// --- HELPER FUNCTIONS ---

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
      if (attempt === retries) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
}

async function fetchFromMirrors(path, options = {}, timeoutMs = 15000) {
  let lastError = null;
  for (let i = 0; i < MIRRORS.length; i++) {
    const mirror = MIRRORS[i];
    const fullUrl = path.startsWith('http') ? path.replace(/https?:\/\/[^/]+/, mirror) : `${mirror}${path}`;
    try {
      const text = await fetchWithTimeout(fullUrl, options, timeoutMs, 1);
      return { text, usedMirror: mirror };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All generator.email mirrors failed');
}

async function fetchNewestAlightLink(user, domain, ignoreHashes) {
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

  const rowRegex = /href=["'](\/[a-zA-Z0-9.\-_]+\/[a-zA-Z0-9.\-_]+\/[a-f0-9]{32})["'][^>]*>\s*<div class="[^"]*from_div_[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  
  let match;
  const alightHashes = [];
  while ((match = rowRegex.exec(indexHtml)) !== null) {
    const path = match[1];
    const sender = match[2].trim().toLowerCase();
    
    if (sender.includes('alight') || sender.includes('firebaseapp')) {
      const parts = path.split('/');
      const hash = parts[3];
      if (hash) {
        alightHashes.push(hash);
      }
    }
  }

  if (alightHashes.length === 0) {
    const links = extractAlightLinks(indexHtml);
    return { link: links[0] || null, newestHash: null };
  }

  const newestHash = alightHashes[0];

  if (ignoreHashes && ignoreHashes.has(newestHash)) {
    return { link: null, newestHash };
  }

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
  }, 15000, 2);

  const links = extractAlightLinks(emailHtml);
  return { link: links[0] || null, newestHash };
}

async function checkEmailProvider(domain) {
  try {
    const url = `https://emailqu.com/api/domain/verify/${domain}`;
    const resText = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, 10000, 2);
    
    const json = JSON.parse(resText);
    if (json && json.success && json.verified === true) {
      return 'emailqu';
    }
  } catch (err) {
    console.warn(`Gagal verifikasi domain ${domain} ke EmailQu:`, err.message);
  }
  return 'generator_email';
}

async function fetchNewestEmailQuLink(email) {
  const url = `https://emailqu.com/api/public/emails/${encodeURIComponent(email)}`;
  const resText = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  }, 15000, 3);
  
  const json = JSON.parse(resText);
  if (json && json.success && json.emails && json.emails.length > 0) {
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

function extractAlightLinks(html) {
  const links = new Set();
  const hrefRegex = /href=["'](https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:alightcreative\.com|alightmotion\.com|alight\.link|alight-creative\.firebaseapp\.com)[^"']*)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    links.add(match[1]);
  }
  const rawRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:alightcreative\.com|alightmotion\.com|alight\.link|alight-creative\.firebaseapp\.com)\/[a-zA-Z0-9.\-_?&=%/~:+]*/gi;
  while ((match = rawRegex.exec(html)) !== null) {
    let link = match[0];
    if (link.endsWith('"') || link.endsWith("'") || link.endsWith('>')) {
      link = link.substring(0, link.length - 1);
    }
    links.add(link);
  }
  return Array.from(links).filter(link => {
    const url = link.toLowerCase();
    if (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.svg')) {
      return false;
    }
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
