/**
 * Vercel Cron - 소셜 미디어 자동 발행
 *
 * 매일 00:00 UTC (09:00 KST) 실행
 * Workers KV "blog:today"에서 오늘 슬러그+소셜 데이터를 가져와 IG + Threads 발행
 *
 * 환경변수 (Vercel Dashboard에서 설정):
 *   IG_ACCESS_TOKEN, IG_USER_ID
 *   THREADS_ACCESS_TOKEN, THREADS_USER_ID
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   WORKERS_CRON_SECRET  (Workers API 인증)
 *   CRON_SECRET          (Vercel 자동 주입)
 */

const BLOG_BASE = "https://blog.zcheck.co.kr";
const API_BASE = "https://zipcheck-api.zipcheck2025.workers.dev";
const IG_API = "https://graph.facebook.com/v21.0";
const TH_API = "https://graph.threads.net/v1.0";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0]; // "2026-02-12"
}

function workersHeaders() {
  return {
    "Content-Type": "application/json",
    "x-cron-secret": process.env.WORKERS_CRON_SECRET || "",
  };
}

async function publishInstagram(post) {
  const TOKEN = process.env.IG_ACCESS_TOKEN;
  const USER_ID = process.env.IG_USER_ID;
  if (!TOKEN || !USER_ID) return { success: false, reason: "no_token" };

  // thumbnail_url이 http로 시작하면 그대로 사용, 아니면 blog.zcheck.co.kr 기준 절대 URL
  const imageUrl =
    post.thumbnail_url && post.thumbnail_url.startsWith("http")
      ? post.thumbnail_url
      : `${BLOG_BASE}${post.thumbnail_url || post.hero_image || ""}`;

  if (!imageUrl || imageUrl === BLOG_BASE) {
    return { success: false, reason: "no_image_url" };
  }

  const containerRes = await fetch(`${IG_API}/${USER_ID}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      image_url: imageUrl,
      caption: post.instagram_caption || "",
      access_token: TOKEN,
    }).toString(),
  });
  const container = await containerRes.json();
  if (container.error)
    throw new Error(`IG 컨테이너: ${container.error.message}`);

  for (let i = 0; i < 12; i++) {
    const s = await (
      await fetch(
        `${IG_API}/${container.id}?fields=status_code&access_token=${TOKEN}`,
      )
    ).json();
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error("IG 이미지 처리 실패");
    await sleep(5000);
  }

  const pub = await (
    await fetch(`${IG_API}/${USER_ID}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
  if (!TOKEN || !USER_ID) return { success: false, reason: "no_token" };

  const chain = post.threads_chain;
  if (!chain || chain.length === 0)
    return { success: false, reason: "no_chain" };

  const mainData = await (
    await fetch(`${TH_API}/${USER_ID}/threads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ media_type: "TEXT", text: chain[0] }),
    })
  ).json();
  if (mainData.error) throw new Error(`TH 메인: ${mainData.error.message}`);

  await sleep(2000);
  const mainResult = await (
    await fetch(`${TH_API}/${USER_ID}/threads_publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ creation_id: mainData.id }),
    })
  ).json();
  if (mainResult.error)
    throw new Error(`TH 메인 게시: ${mainResult.error.message}`);

  let lastId = mainResult.id;
  for (let i = 1; i < chain.length; i++) {
    await sleep(3000);
    const rd = await (
      await fetch(`${TH_API}/${USER_ID}/threads`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          media_type: "TEXT",
          text: chain[i],
          reply_to_id: lastId,
        }),
      })
    ).json();
    if (rd.error) throw new Error(`TH 답글 ${i}: ${rd.error.message}`);

    await sleep(2000);
    const rp = await (
      await fetch(`${TH_API}/${USER_ID}/threads_publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch {}
}

module.exports = async function handler(req, res) {
  // Vercel Cron 인증 확인
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = todayKST();
  const logs = [`[${today}] publish-social 시작`];

  // Workers KV에서 오늘 데이터 조회
  let todayData;
  try {
    const kvRes = await fetch(`${API_BASE}/api/cron/today`, {
      headers: workersHeaders(),
    });
    if (!kvRes.ok) throw new Error(`KV 조회 실패 (${kvRes.status})`);
    todayData = await kvRes.json();
  } catch (e) {
    logs.push(`KV 조회 오류: ${e.message}`);
    await sendTelegram(
      `<b>Cron 실행</b>\n${today}\nKV 조회 실패: ${e.message}`,
    );
    return res.status(200).json({ logs, published: [] });
  }

  if (!todayData?.slug) {
    logs.push("오늘 발행 예정 콘텐츠 없음 (blog:today 없음)");
    await sendTelegram(`<b>Cron 실행</b>\n${today}\n발행 예정 콘텐츠 없음`);
    return res.status(200).json({ logs, published: [] });
  }

  const slug = todayData.slug;

  // 중복발행 체크 (Workers KV)
  try {
    const pubCheck = await (
      await fetch(`${API_BASE}/api/counter/published/${slug}/${today}`)
    ).json();
    if (pubCheck.published) {
      logs.push(`SKIP (이미 발행됨 - KV): ${slug}`);
      await sendTelegram(`<b>Cron 실행</b>\n${today}\n이미 발행됨: ${slug}`);
      return res.status(200).json({ logs, published: [] });
    }
  } catch {}

  logs.push(`발행 시작: ${slug}`);
  const result = { slug, instagram: null, threads: null };

  // Instagram 발행
  try {
    result.instagram = await publishInstagram(todayData);
    logs.push(
      `  IG: ${result.instagram.success ? "OK" : `SKIP (${result.instagram.reason})`}`,
    );
  } catch (e) {
    result.instagram = { success: false, error: e.message };
    logs.push(`  IG ERROR: ${e.message}`);
  }

  await sleep(10000);

  // Threads 발행
  try {
    result.threads = await publishThreads(todayData);
    logs.push(
      `  TH: ${result.threads.success ? "OK" : `SKIP (${result.threads.reason})`}`,
    );
  } catch (e) {
    result.threads = { success: false, error: e.message };
    logs.push(`  TH ERROR: ${e.message}`);
  }

  // Workers KV에 발행 기록 (30일 TTL) — 중복발행 방지
  if (result.instagram?.success || result.threads?.success) {
    try {
      await fetch(`${API_BASE}/api/counter/published/${slug}/${today}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
    } catch {}
  }

  const ig = result.instagram?.success ? "✅" : "❌";
  const th = result.threads?.success ? "✅" : "❌";
  await sendTelegram(
    `<b>소셜 자동 발행 (Cron)</b>\n\n` +
      `<b>${todayData.title || slug}</b>\n` +
      `${BLOG_BASE}/${slug}/\n\n` +
      `Instagram: ${ig}\nThreads: ${th}`,
  );

  return res.status(200).json({ logs, published: [result] });
};
