const fs = require('fs');

const envPath = 'F:/zcheck-content-pipeline/.env';
const env = {};
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.replace(/\r/, '').match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const VERCEL_TOKEN = 'sXCm9dVqTSDq8P9AVRnBJtDw';
const PROJECT_ID = 'prj_4xXCYed2IipxElwiUhpI24Ebzjlv'; // zcheck-blog

const needed = [
  'IG_ACCESS_TOKEN', 'IG_USER_ID',
  'THREADS_ACCESS_TOKEN', 'THREADS_USER_ID',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
];

async function main() {
  // 기존 env vars 조회
  const listRes = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  const existing = await listRes.json();
  const existingMap = {};
  if (existing.envs) {
    for (const e of existing.envs) {
      existingMap[e.key] = e.id;
    }
  }

  for (const key of needed) {
    if (!env[key]) {
      console.log(`SKIP ${key}: not found`);
      continue;
    }

    // 기존 있으면 삭제
    if (existingMap[key]) {
      await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${existingMap[key]}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
      });
    }

    // 추가
    const res = await fetch(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value: env[key],
        type: 'encrypted',
        target: ['production'],
      }),
    });
    const data = await res.json();
    if (data.error) {
      console.log(`[FAIL] ${key}: ${data.error.message}`);
    } else {
      console.log(`[OK] ${key}`);
    }
  }
}

main().catch(console.error);
