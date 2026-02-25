/**
 * 예약 발행 실행기
 *
 * schedule-social.js가 생성한 JSON을 읽어
 * Instagram + Threads 동시 발행 후 텔레그램 알림 전송
 *
 * 사용법: node scripts/publish-scheduled.js <schedule/slug.json>
 */

const fs = require('fs');
const path = require('path');

// .env 로드
const envPath = path.resolve(__dirname, '..', '..', 'zcheck-content-pipeline', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const clean = line.replace(/\r/, '');
    const match = clean.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const BLOG_BASE = 'https://blog.zcheck.co.kr';
const IG_API_BASE = 'https://graph.facebook.com/v21.0';
const THREADS_API_BASE = 'https://graph.threads.net/v1.0';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`[${ts}] ${msg}`);
}

// --- Instagram ---
async function publishInstagram(post) {
  const TOKEN = process.env.IG_ACCESS_TOKEN;
  const USER_ID = process.env.IG_USER_ID;
  if (!TOKEN || !USER_ID) {
    log('[IG] 토큰 미설정 - 건너뜀');
    return { success: false, reason: 'no_token' };
  }

  const imageUrl = `${BLOG_BASE}${post.hero_image}`;
  const caption = post.instagram_caption;

  log(`[IG] 발행 시작: ${post.slug}`);
  log(`[IG] 이미지: ${imageUrl}`);
  log(`[IG] 캡션: ${caption.length}자`);

  // 컨테이너 생성
  const containerRes = await fetch(`${IG_API_BASE}/${USER_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      image_url: imageUrl,
      caption: caption,
      access_token: TOKEN,
    }).toString(),
  });
  const container = await containerRes.json();
  if (container.error) throw new Error(`IG 컨테이너 실패: ${container.error.message}`);
  log(`[IG] 컨테이너 생성: ${container.id}`);

  // 이미지 처리 대기
  for (let i = 0; i < 12; i++) {
    const statusRes = await fetch(
      `${IG_API_BASE}/${container.id}?fields=status_code&access_token=${TOKEN}`
    );
    const status = await statusRes.json();
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') throw new Error('IG 이미지 처리 실패');
    log(`[IG] 이미지 처리 중... (${i + 1}/12)`);
    await sleep(5000);
  }

  // 게시
  const pubRes = await fetch(`${IG_API_BASE}/${USER_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: TOKEN,
    }).toString(),
  });
  const pub = await pubRes.json();
  if (pub.error) throw new Error(`IG 게시 실패: ${pub.error.message}`);

  log(`[IG] 발행 완료! 미디어 ID: ${pub.id}`);
  return { success: true, mediaId: pub.id };
}

// --- Threads ---
async function publishThreads(post) {
  const TOKEN = process.env.THREADS_ACCESS_TOKEN;
  const USER_ID = process.env.THREADS_USER_ID;
  if (!TOKEN || !USER_ID) {
    log('[TH] 토큰 미설정 - 건너뜀');
    return { success: false, reason: 'no_token' };
  }

  const chain = post.threads_chain;
  if (!chain || chain.length === 0) {
    log('[TH] 답글 체인 없음 - 건너뜀');
    return { success: false, reason: 'no_chain' };
  }

  log(`[TH] 발행 시작: ${post.slug} (${chain.length}개 체인)`);

  // 메인 포스트
  const mainContainer = await fetch(`${THREADS_API_BASE}/${USER_ID}/threads`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ media_type: 'TEXT', text: chain[0] }),
  });
  const mainData = await mainContainer.json();
  if (mainData.error) throw new Error(`TH 메인 컨테이너 실패: ${mainData.error.message}`);

  await sleep(2000);
  const mainPub = await fetch(`${THREADS_API_BASE}/${USER_ID}/threads_publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ creation_id: mainData.id }),
  });
  const mainResult = await mainPub.json();
  if (mainResult.error) throw new Error(`TH 메인 게시 실패: ${mainResult.error.message}`);

  log(`[TH] 메인 포스트: ${mainResult.id}`);

  // 답글 체인
  let lastId = mainResult.id;
  for (let i = 1; i < chain.length; i++) {
    await sleep(3000);
    log(`[TH] 답글 ${i}/${chain.length - 1} 발행 중...`);

    const replyContainer = await fetch(`${THREADS_API_BASE}/${USER_ID}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_type: 'TEXT',
        text: chain[i],
        reply_to_id: lastId,
      }),
    });
    const replyData = await replyContainer.json();
    if (replyData.error) throw new Error(`TH 답글 ${i} 컨테이너 실패: ${replyData.error.message}`);

    await sleep(2000);
    const replyPub = await fetch(`${THREADS_API_BASE}/${USER_ID}/threads_publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ creation_id: replyData.id }),
    });
    const replyResult = await replyPub.json();
    if (replyResult.error) throw new Error(`TH 답글 ${i} 게시 실패: ${replyResult.error.message}`);

    log(`[TH] 답글 ${i}: ${replyResult.id}`);
    lastId = replyResult.id;
  }

  log(`[TH] 발행 완료! ${chain.length}개 포스트`);
  return { success: true, mainPostId: mainResult.id, totalPosts: chain.length };
}

// --- Telegram 알림 ---
async function sendTelegram(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    log('[TG] 알림 전송 완료');
  } catch (e) {
    log(`[TG] 알림 실패: ${e.message}`);
  }
}

// --- 메인 ---
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node scripts/publish-scheduled.js <schedule/slug.json>');
    process.exit(1);
  }

  const jsonPath = path.resolve(args[0]);
  if (!fs.existsSync(jsonPath)) {
    console.error(`파일 없음: ${jsonPath}`);
    process.exit(1);
  }

  const post = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  log(`========================================`);
  log(`예약 발행 시작: ${post.slug}`);
  log(`========================================`);

  const results = { instagram: null, threads: null };

  // Instagram 발행
  try {
    results.instagram = await publishInstagram(post);
  } catch (e) {
    log(`[IG ERROR] ${e.message}`);
    results.instagram = { success: false, error: e.message };
  }

  // 10초 대기 후 Threads 발행
  await sleep(10000);

  // Threads 발행
  try {
    results.threads = await publishThreads(post);
  } catch (e) {
    log(`[TH ERROR] ${e.message}`);
    results.threads = { success: false, error: e.message };
  }

  // 결과 요약
  log('========================================');
  log('발행 결과:');
  log(`  Instagram: ${results.instagram?.success ? '✅' : '❌'} ${results.instagram?.mediaId || results.instagram?.error || results.instagram?.reason || ''}`);
  log(`  Threads:   ${results.threads?.success ? '✅' : '❌'} ${results.threads?.mainPostId || results.threads?.error || results.threads?.reason || ''}`);

  // 텔레그램 알림
  const blogUrl = `${BLOG_BASE}/${post.slug}/`;
  const igEmoji = results.instagram?.success ? '✅' : '❌';
  const thEmoji = results.threads?.success ? '✅' : '❌';
  await sendTelegram(
    `<b>소셜 미디어 자동 발행</b>\n\n` +
    `<b>${post.slug}</b>\n` +
    `${blogUrl}\n\n` +
    `Instagram: ${igEmoji}\n` +
    `Threads: ${thEmoji}`
  );

  // 결과 파일 저장 (로그용)
  const resultPath = jsonPath.replace('.json', '-result.json');
  fs.writeFileSync(resultPath, JSON.stringify({
    ...results,
    published_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
  log(`결과 저장: ${resultPath}`);
}

main().catch((err) => {
  log(`[FATAL] ${err.message}`);
  process.exit(1);
});
