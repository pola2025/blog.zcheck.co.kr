/**
 * Vercel Cron - 콘텐츠 자동 생성
 *
 * 매일 12:00 UTC (21:00 KST) 실행
 * 내일 발행할 콘텐츠를 자동 생성:
 *   1. GitHub에서 이미 발행된 슬러그 목록 확인 (중복 방지)
 *   2. Gemini Flash로 콘텐츠 JSON 생성
 *   3. Gemini Imagen으로 고유 히어로 이미지 생성 (슬러그 해시 기반)
 *   4. GitHub API로 content/ + images/ + schedule/ 파일 push
 *   5. Vercel 자동 재빌드 (GitHub 연동)
 *   6. 텔레그램 알림
 *
 * 필요 환경변수 (Vercel Dashboard):
 *   GEMINI_API_KEY, GITHUB_TOKEN, CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'pola2025/blog.zcheck.co.kr';
const GEMINI_TEXT_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const GEMINI_IMG_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_KEY}`;
const BLOG_BASE = 'https://blog.zcheck.co.kr';

// Topic Pool
const TOPIC_POOL = [
  { keyword: '아파트 베란다 확장 비용', slug: 'balcony-expansion-cost' },
  { keyword: '인테리어 업체 계약서 주의사항', slug: 'interior-contract-checklist' },
  { keyword: '아파트 도돈 비용 평당', slug: 'wallpaper-cost-per-pyeong' },
  { keyword: '주방 싱크대 궐체 비용', slug: 'kitchen-sink-replacement-cost' },
  { keyword: '아파트 장판 궐체 비용', slug: 'flooring-replacement-cost' },
  { keyword: '화장실 타일 궐체 비용', slug: 'bathroom-tile-replacement-cost' },
  { keyword: '인테리어 감리 필요성', slug: 'interior-supervision-guide' },
  { keyword: '아파트 새시 궐체 비용', slug: 'window-frame-replacement-cost' },
  { keyword: '리모델링 하자보수 기간', slug: 'remodeling-warranty-guide' },
  { keyword: '인테리어 계약 전 확인사항', slug: 'pre-contract-checklist' },
  { keyword: '아파트 도어 궐체 비용', slug: 'door-replacement-cost' },
  { keyword: '주방 후드 궐체 비용', slug: 'kitchen-hood-replacement' },
  { keyword: '욕실 방수 공사 비용', slug: 'bathroom-waterproofing-cost' },
  { keyword: '아파트 조명 궐체 비용', slug: 'lighting-replacement-cost' },
  { keyword: '인테리어 업체 포트폴리오 보는 법', slug: 'interior-portfolio-review' },
  { keyword: '리모델링 공사 기간 단계별', slug: 'remodeling-timeline-stages' },
  { keyword: '아파트 거실 인테리어 비용', slug: 'living-room-interior-cost' },
  { keyword: '인테리어 견적서 항목 설명', slug: 'estimate-items-explained' },
  { keyword: '아파트 리모델링 시공 순서', slug: 'remodeling-construction-order' },
  { keyword: '싱크대 상판 소재 비교', slug: 'countertop-material-comparison' },
  { keyword: '아파트 방문 궐체 시기', slug: 'door-replacement-timing' },
  { keyword: '인테리어 자재 등급 차이', slug: 'material-grade-differences' },
  { keyword: '리모델링 추가 공사 방지법', slug: 'prevent-extra-construction-costs' },
  { keyword: '아파트 보일러 궐체 비용', slug: 'boiler-replacement-cost' },
  { keyword: '화장실 환기 시스템 궐체', slug: 'bathroom-ventilation-replacement' },
];

// Image prompt diversification via slug hash
const BASE_STYLE = 'Korean apartment interior editorial photography. Warm natural lighting, no people, no text overlay, no watermark, high quality, 16:9 aspect ratio.';
const SCENE_TIMES = ['morning golden hour', 'bright afternoon light', 'soft diffused daylight', 'warm evening ambiance', 'neutral midday light'];
const ROOM_SCENES = [
  'modern living room with wood floor and linen sofa',
  'clean kitchen with marble countertop and pendant lights',
  'serene bedroom with white bedding and sheer curtains',
  'bright bathroom with clean tiles and towel rack',
  'open-plan living and dining area with plants',
  'cozy study corner with bookshelf and desk lamp',
  'balcony area with potted plants and city view',
  'entryway with clean storage and mirror',
];
const STYLE_MOODS = ['minimalist', 'warm Scandinavian', 'modern luxury', 'earthy natural tones', 'bright and airy', 'cozy and soft'];
const COLOR_PALETTE = ['beige and white', 'warm wood and cream', 'gray and white', 'sage green and wood', 'navy and natural', 'terracotta and white'];

function slugHash(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildUniquePrompt(slug) {
  const h = slugHash(slug);
  const time = SCENE_TIMES[h % SCENE_TIMES.length];
  const room = ROOM_SCENES[(h >> 2) % ROOM_SCENES.length];
  const mood = STYLE_MOODS[(h >> 4) % STYLE_MOODS.length];
  const color = COLOR_PALETTE[(h >> 6) % COLOR_PALETTE.length];
  return `${BASE_STYLE} ${mood} style. ${room}. ${color} color palette. ${time}. Soft shadows, editorial magazine quality.`;
}
async function getPublishedSlugs() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/content`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'zcheck-bot/1.0' },
  });
  if (!res.ok) return [];
  const files = await res.json();
  return files.map((f) => f.name.replace('.json', ''));
}

async function pushFileToGitHub(filePath, content, message, isBinary = false) {
  let sha;
  const checkRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'zcheck-bot/1.0' },
  });
  if (checkRes.ok) sha = (await checkRes.json()).sha;

  const body = { message, content: isBinary ? content : Buffer.from(content, 'utf-8').toString('base64') };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'zcheck-bot/1.0' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub push 실패 (${filePath}): ${err.message}`);
  }
  return res.json();
}
async function generateContentJSON(topic, tomorrowDate) {
  const prompt = `당신은 한국 아파트 인테리어/리모델링 전문 블로그 콘텐츠 작성자입니다.

다음 주제로 블로그 포스트와 소셜 미디어 콘텐츠를 생성하세요:
- 키워드: ${topic.keyword}
- 슬러그: ${topic.slug}
- 발행일: ${tomorrowDate}

반드시 아래 JSON 형식으로만 응답하세요. JSON 외 텍스트는 절대 포함하지 마세요:

{
  "slug": "${topic.slug}",
  "title": "(SEO 최적화된 명확한 제목, 20-35자)",
  "meta_description": "(검색 결과용 설명, 100-150자, 키워드 자연스럽게 포함)",
  "category": "인테리어",
  "target_keyword": "${topic.keyword}",
  "tags": ["태그1", "태그2", "태그3", "태그4"],
  "published_at": "${tomorrowDate}T09:00:00.000Z",
  "published": true,
  "hero_image": "/images/${topic.slug}.png",
  "body_sections": [
    {"type": "text", "content": "(첫 단락 - 공감형 도입부, 3-5문장)"},
    {"type": "text", "content": "(핵심 내용 1: 구체적 수치/사례 포함, 3-5문장)"},
    {"type": "callout", "emoji": "������", "title": "(핵심 포인트 제목)", "content": "(실용적 팁)"},
    {"type": "text", "content": "(핵심 내용 2: 독자가 바로 쓸 수 있는 정보)"},
    {"type": "callout", "emoji": "⚠️", "title": "(주의사항 제목)", "content": "(주의할 점)"},
    {"type": "text", "content": "(마무리: 집쭁 무료 견적 비교 서비스 자연스럽게 언급)"}
  ],
  "instagram_caption": "(인스타용 캐시: 후킹 첫 줄 + 핵심 팁 3-4개 + 해시태그 8-10개, 전 300-400자)",
  "threads_chain": [
    "(첫 포스트: 강한 후킹 + 예고, 150-200자)",
    "(두 번째: 핵심 내용 1 상세, 200-250자)",
    "(세 번째: 핵심 내용 2 상세, 200-250자)",
    "(네 번째: 마무리 + 링크 https://blog.zcheck.co.kr/${topic.slug}/, 100-150자)"
  ]
}\`;

  const res = await fetch(GEMINI_TEXT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 3000 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini text API 오류: ${res.status}`);
  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = rawText.match(/```json\s*([\s\S]+?)\s*```/) || rawText.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) throw new Error(`JSON 파싱 실패. 응답: ${rawText.substring(0, 200)}`);
  return JSON.parse(jsonMatch[1]);
}

async function generateHeroImage(slug) {
  const prompt = buildUniquePrompt(slug);
  const res = await fetch(GEMINI_IMG_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini image API 오류: ${res.status}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error('이미지 반환 없음');
  return imagePart.inlineData.data;
}

function tomorrowKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setDate(kst.getDate() + 1);
  return kst.toISOString().split('T')[0];
}

async function sendTelegram(message) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) return;
  try {
    await fetch(\, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN 미설정' });

  const logs = [];
  const tomorrow = tomorrowKST();

  try {
    logs.push('발행된 슬러그 목록 조회 중...');
    const publishedSlugs = await getPublishedSlugs();
    logs.push(`  기존 발행: ${publishedSlugs.length}개`);

    // 내일 이미 schedule된 항목 확인
    const scheduleRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/schedule`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'zcheck-bot/1.0' },
    });
    let scheduledSlugs = [];
    if (scheduleRes.ok) {
      const schedFiles = await scheduleRes.json();
      scheduledSlugs = schedFiles
        .filter((f) => f.name.endsWith('.json') && !f.name.includes('result'))
        .map((f) => f.name.replace('.json', ''));
    }

    const used = new Set([...publishedSlugs, ...scheduledSlugs]);
    const available = TOPIC_POOL.filter((t) => !used.has(t.slug));

    if (available.length === 0) {
      logs.push('발행 가능한 주제 없음');
      await sendTelegram(`<b>콘텐츠 생성 Cron</b>
${tomorrow}
발행 가능한 주제 없음. 토픽 풀 추가 필요.`);
      return res.status(200).json({ logs, slug: null });
    }

    const topic = available[Math.floor(Math.random() * Math.min(available.length, 3))];
    logs.push(`선택된 주제: ${topic.slug} (${topic.keyword})`);

    logs.push('Gemini Flash 콘텐츠 생성 중...');
    const contentJSON = await generateContentJSON(topic, tomorrow);
    logs.push(`  콘텐츠 생성 완료: "${contentJSON.title}"`);

    logs.push('Gemini Imagen 이미지 생성 중...');
    const imageBase64 = await generateHeroImage(topic.slug);
    logs.push(`  이미지 생성 완료 (${Math.round((imageBase64.length * 3) / 4 / 1024)}KB)`);

    const scheduleData = {
      slug: topic.slug,
      title: contentJSON.title,
      schedule_date: `${tomorrow} 09:00`,
      hero_image: `/images/${topic.slug}.png`,
      instagram_caption: contentJSON.instagram_caption,
      threads_chain: contentJSON.threads_chain,
    };

    logs.push('GitHub에 파일 push 중...');
    await pushFileToGitHub(`content/${topic.slug}.json`, JSON.stringify(contentJSON, null, 2), `content: add ${topic.slug}`);
    logs.push(`  content/${topic.slug}.json`);

    await pushFileToGitHub(`images/${topic.slug}.png`, imageBase64, `images: hero for ${topic.slug}`, true);
    logs.push(`  images/${topic.slug}.png`);

    await pushFileToGitHub(`schedule/${topic.slug}.json`, JSON.stringify(scheduleData, null, 2), `schedule: ${tomorrow} - ${topic.slug}`);
    logs.push(`  schedule/${topic.slug}.json`);

    logs.push('GitHub push 완료 -> Vercel 자동 재빌드 시작');

    await sendTelegram(
      `<b>콘텐츠 자동 생성 완료</b>

` +
      `<b>${contentJSON.title}</b>
` +
      `슬러그: ${topic.slug}
` +
      `발행 예정: ${tomorrow} 09:00 KST

` +
      `GitHub push -> Vercel 재빌드 진행 중
` +
      `${BLOG_BASE}/${topic.slug}/`
    );

    return res.status(200).json({ logs, slug: topic.slug, title: contentJSON.title, scheduleDate: tomorrow });
  } catch (err) {
    logs.push(`오류: ${err.message}`);
    await sendTelegram(`<b>콘텐츠 생성 Cron 오류</b>
${err.message}`);
    return res.status(500).json({ logs, error: err.message });
  }
};
