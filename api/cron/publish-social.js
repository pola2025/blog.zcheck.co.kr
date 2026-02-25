/**
 * Vercel Cron - 소셜 미디어 자동 발행
 *
 * 매일 00:00 UTC (09:00 KST) 실행
 * schedule/ 디렉토리에서 오늘 날짜 매칭되는 JSON을 찾아 IG + Threads 발행
 *
 * 환경변수 (Vercel Dashboard에서 설정):
 *   IG_ACCESS_TOKEN, IG_USER_ID
 *   THREADS_ACCESS_TOKEN, THREADS_USER_ID
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   CRON_SECRET (Vercel 자동 주입)
 */

const fs = require('fs');
const path = require('path');

const BLOG_BASE = 'https://blog.zcheck.co.kr';
const API_BASE = 'https://zipcheck-api.zipcheck2025.workers.dev';
const IG_API = 'https://graph.facebook.com/v21.0';
const TH_API = 'https://graph.threads.net/v1.0';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0]; // "2026-02-12"
}

async function publishInstagram(post) {
  const TOKEN = process.env.IG_ACCESS_TOKEN;
  const USER_ID = process.env.IG_USER_ID;
  if (!TOKEN || !USER_ID) return { success: false, reason: 'no_token' };

  const imageUrl = `${BLOG_BASE}${post.hero_image}`;

  const containerRes = await fetch(`${IG_API}/${USER_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: imageUrl,
      caption: post.instagram_caption,
      access_token: TOKEN,
    }).toString(),
  });
  const container = await containerRes.json();
  if (container.error) throw new Error(`IG 컨테이너: ${container.error.message}`);

  for (let i = 0; i < 12; i++) {
    const s = await (
      await fetch(`${IG_API}/${container.id}?fields=status_code&access_token=${TOKEN}`)
    ).json();
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR') throw new Error('IG 이미지 처리 실패');
    await sleep(5000);
  }

  const pub = await (
    await fetch(`${IG_API}/${USER_ID}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: container.id,
        access_token: TOKEN,
      }).toString(),
    })
  ).json();
  if (pub.error) throw new Error(`IG 게시: ${pub.error.message}`);

  return { success: true, mediaId: pub.id };
}

async function publishThreads(post) {
  const TOKEN = process.env.THREADS_ACCESS_TOKEN;
  const USER_ID = process.env.THREADS_USER_ID;
  if (!TOKEN || !USER_ID) return { success: false, reason: 'no_token' };

  const chain = post.threads_chain;
  if (!chain || chain.length === 0) return { success: false, reason: 'no_chain' };

  const mainData = await (
    await fetch(`${TH_API}/${USER_ID}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_type: 'TEXT', text: chain[0] }),
    })
  ).json();
  if (mainData.error) throw new Error(`TH 메인: ${mainData.error.message}`);

  await sleep(2000);
  const mainResult = await (
    await fetch(`${TH_API}/${USER_ID}/threads_publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: mainData.id }),
    })
  ).json();
  if (mainResult.error) throw new Error(`TH 메인 게시: ${mainResult.error.message}`);

  let lastId = mainResult.id;
  for (let i = 1; i < chain.length; i++) {
    await sleep(3000);
    const rd = await (
      await fetch(`${TH_API}/${USER_ID}/threads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'TEXT', text: chain[i], reply_to_id: lastId }),
      })
    ).json();
    if (rd.error) throw new Error(`TH 답글 ${i}: ${rd.error.message}`);

    await sleep(2000);
    const rp = await (
      await fetch(`${TH_API}/${USER_ID}/threads_publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: rd.id }),
      })
    ).json();
    if (rp.error) throw new Error(`TH 답글 ${i} 게시: ${rp.error.message}`);
    lastId = rp.id;
  }

  return { success: true, mainPostId: mainResult.id, totalPosts: chain.length };
}

async function sendTelegram(message) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

module.exports = async function handler(req, res) {
  // Vercel Cron 인증 확인
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today = todayKST();
  const scheduleDir = path.join(process.cwd(), 'schedule');
  const logs = [`[${today}] Cron 시작`];

  // schedule/ 디렉토리에서 오늘 날짜 매칭
  let files;
  try {
    files = fs.readdirSync(scheduleDir).filter((f) => f.endsWith('.json') && !f.includes('result'));
  } catch {
    logs.push('schedule/ 디렉토리 없음');
    return res.status(200).json({ logs, published: [] });
  }

  const todayPosts = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(scheduleDir, file), 'utf-8'));
    if (data.schedule_date && data.schedule_date.startsWith(today)) {
      // 이미 발행된 포스트 skip (Workers KV 체크 → result 파일 폴백)
      try {
        const pubCheck = await (await fetch(`${API_BASE}/api/counter/published/${data.slug}/${today}`)).json();
        if (pubCheck.published) {
          logs.push(`SKIP (이미 발행됨 - KV): ${data.slug}`);
          continue;
        }
      } catch {}
      const resultFile = file.replace('.json', '-result.json');
      if (fs.existsSync(path.join(scheduleDir, resultFile))) {
        logs.push(`SKIP (이미 발행됨 - file): ${data.slug}`);
        continue;
      }
      todayPosts.push({ ...data, _file: file });
    }
  }

  if (todayPosts.length === 0) {
    logs.push('오늘 발행 예정 콘텐츠 없음');
    await sendTelegram(`<b>Cron 실행</b>\n${today}\n발행 예정 콘텐츠 없음`);
    return res.status(200).json({ logs, published: [] });
  }

  const results = [];
  for (const post of todayPosts) {
    logs.push(`발행 시작: ${post.slug}`);
    const result = { slug: post.slug, instagram: null, threads: null };

    try {
      result.instagram = await publishInstagram(post);
      logs.push(`  IG: ${result.instagram.success ? 'OK' : 'SKIP'}`);
    } catch (e) {
      result.instagram = { success: false, error: e.message };
      logs.push(`  IG ERROR: ${e.message}`);
    }

    await sleep(10000);

    try {
      result.threads = await publishThreads(post);
      logs.push(`  TH: ${result.threads.success ? 'OK' : 'SKIP'}`);
    } catch (e) {
      result.threads = { success: false, error: e.message };
      logs.push(`  TH ERROR: ${e.message}`);
    }

    results.push(result);

    // Workers KV에 발행 기록 (30일 TTL) — 중복발행 방지 핵심
    if (result.instagram?.success || result.threads?.success) {
      try {
        await fetch(`${API_BASE}/api/counter/published/${post.slug}/${today}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        });
      } catch {}
    }

    // result 파일 저장 시도 (read-only 환경에서는 실패해도 무시 — 폴백용)
    if (result.instagram?.success || result.threads?.success) {
      try {
        const resultFile = post._file.replace('.json', '-result.json');
        fs.writeFileSync(
          path.join(scheduleDir, resultFile),
          JSON.stringify({ instagram: result.instagram, threads: result.threads, published_at: new Date().toISOString() }, null, 2),
        );
      } catch {}
    }

    const ig = result.instagram?.success ? '✅' : '❌';
    const th = result.threads?.success ? '✅' : '❌';
    await sendTelegram(
      `<b>소셜 자동 발행 (Cron)</b>\n\n` +
        `<b>${post.slug}</b>\n` +
        `${BLOG_BASE}/${post.slug}/\n\n` +
        `Instagram: ${ig}\nThreads: ${th}`
    );
  }

  return res.status(200).json({ logs, published: results });
};
