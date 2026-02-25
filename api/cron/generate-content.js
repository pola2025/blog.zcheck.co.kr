'use strict';
const fetch = require('node-fetch');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'pola2025/blog.zcheck.co.kr';
const GEMINI_TEXT_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
const GEMINI_IMG_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_KEY}`;
const BLOG_BASE = 'https://blog.zcheck.co.kr';

const TOPIC_POOL = [
  { keyword: '아파트 거실 인테리어', slug: 'apartment-living-room-interior' },
  { keyword: '주방 리모델링 비용', slug: 'kitchen-remodeling-cost' },
  { keyword: '욕실 타일 교체', slug: 'bathroom-tile-replacement' },
  { keyword: '방문 교체 비용', slug: 'door-replacement-cost' },
  { keyword: '븬란다 확장 인테리어', slug: 'balcony-expansion-interior' },
  { keyword: '원룸 인테리어 셀프', slug: 'studio-self-interior' },
  { keyword: '아파트 도배 비용', slug: 'apartment-wallpaper-cost' },
  { keyword: '붙박이장 제작 비용', slug: 'built-in-closet-cost' },
  { keyword: '주방 상부장 교체', slug: 'kitchen-upper-cabinet-replacement' },
  { keyword: '욕실 방수 공사', slug: 'bathroom-waterproofing' },
  { keyword: '마루 바닥재 교체 비용', slug: 'floor-replacement-cost' },
  { keyword: '싱크대 교체 비용', slug: 'sink-replacement-cost' },
  { keyword: '아파트 전체 리모델링', slug: 'apartment-full-remodeling' },
  { keyword: '침실 인테리어 꾸미기', slug: 'bedroom-interior-decor' },
  { keyword: '화장실 인테리어 리모델링', slug: 'toilet-interior-remodeling' },
  { keyword: '청장 도장 셀프 인테리어', slug: 'ceiling-paint-self-interior' },
  { keyword: '샷시 교체 비용', slug: 'window-frame-replacement-cost' },
  { keyword: '아이방 인테리어 아이디어', slug: 'kids-room-interior-ideas' },
  { keyword: '발코니 단열 공사', slug: 'balcony-insulation-work' },
  { keyword: '현관 인테리어 꾸미기', slug: 'entrance-interior-decor' },
  { keyword: '조명 교체 인테리어', slug: 'lighting-replacement-interior' },
  { keyword: '소파 배치 거실 인테리어', slug: 'sofa-arrangement-living-room' },
  { keyword: '화이트 인테리어 아파트', slug: 'white-interior-apartment' },
  { keyword: '북유럽 인테리어 스타일', slug: 'nordic-interior-style' },
  { keyword: '모던 아파트 인테리어', slug: 'modern-apartment-interior' },
];

const SCENE_TIMES = ['오전 햇살이 가득한', '저녁 골든아워', '흘린 날 은은한 자연광', '야간 간접조명'];
const ROOM_SCENES = ['넓은 거실', '모던한 주방', '아늘한 침실', '깔끔한 욕실', '밝은 븬란다'];
const STYLE_MOODS = ['미니멀리즘', '북유럽 스칸디나비아', '내추럴 우드', '모던 럭셔리', '빈티지 감성'];
const COLOR_PALETTE = ['화이트&그레이', '베이지&아이보리', '딥그린&우드', '블랙&화이트', '테라코타&크림'];

function slugHash(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function buildUniquePrompt(slug) {
  const h = slugHash(slug);
  const scene = SCENE_TIMES[h % SCENE_TIMES.length];
  const room = ROOM_SCENES[(h >> 2) % ROOM_SCENES.length];
  const style = STYLE_MOODS[(h >> 4) % STYLE_MOODS.length];
  const color = COLOR_PALETTE[(h >> 6) % COLOR_PALETTE.length];
  return `${scene} ${room}, ${style} 스타일, ${color} 색상 팔레트의 한국 아파트 인테리어 사진. 실제 인테리어 잡지 화보처럼 사실적이고 고품질. 사람 없음, 텍스트 없음.`;
}

async function getPublishedSlugs() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/content`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) return [];
  const files = await res.json();
  return files.map((f) => f.name.replace(/\.json$/, ''));
}

async function pushFileToGitHub(filePath, content, message, isBinary = false) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  let sha;
  const checkRes = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (checkRes.ok) {
    const existing = await checkRes.json();
    sha = existing.sha;
  }
  const body = {
    message,
    content: isBinary ? content : Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub push failed for ${filePath}: ${err}`);
  }
  return res.json();
}

async function generateContentJSON(topic, tomorrowDate) {
  const prompt = '당신은 한국 아파트 인테리어/리모델링 전문 블로그 콘텐츠 작성자입니다.\n\n' +
    '다음 주제로 블로그 포스트와 소셜 미디어 콘텐츠를 생성하세요:\n' +
    '- 키워드: ' + topic.keyword + '\n' +
    '- 슬러그: ' + topic.slug + '\n' +
    '- 발행일: ' + tomorrowDate + '\n\n' +
    '반드시 아래 JSON 형식으로만 응답하세요. JSON 외 텍스트는 절대 포함하지 마세요:\n\n' +
    '{\n' +
    '  "slug": "' + topic.slug + '",\n' +
    '  "title": "(SEO 최적화된 명확한 제목, 20-35자)",\n' +
    '  "meta_description": "(검색 결과용 설명, 100-150자, 키워드 자연스럽게 포함)",\n' +
    '  "category": "인테리어",\n' +
    '  "target_keyword": "' + topic.keyword + '",\n' +
    '  "tags": ["태그1", "태그2", "태그3", "태그4"],\n' +
    '  "published_at": "' + tomorrowDate + 'T09:00:00.000Z",\n' +
    '  "published": true,\n' +
    '  "hero_image": "/images/' + topic.slug + '.png",\n' +
    '  "body_sections": [\n' +
    '    {"type": "text", "content": "(첫 단락 - 공감형 도입부, 3-5문장)"},\n' +
    '    {"type": "text", "content": "(핵심 내용 1: 구체적 수치/사례 포함, 3-5문장)"},\n' +
    '    {"type": "callout", "emoji": "💡", "title": "(핵심 포인트 제목)", "content": "(실용적 팁)"},\n' +
    '    {"type": "text", "content": "(핵심 내용 2: 독자가 바로 쓸 수 있는 정보)"},\n' +
    '    {"type": "callout", "emoji": "⚠️", "title": "(주의사항 제목)", "content": "(주의할 점)"},\n' +
    '    {"type": "text", "content": "(마무리: 집첩 무료 견적 비교 서비스 자연스럽게 언급)"}\n' +
    '  ],\n' +
    '  "instagram_caption": "(인스타용 캐션: 후킹 첫 줄 + 핵심 팁 3-4개 + 해시태그 8-10개, 촔10 300-400자)",\n' +
    '  "threads_chain": [\n' +
    '    "(첫 포스트: 강한 후킹 + 예고, 150-200자)",\n' +
    '    "(두 번째: 핵심 내용 1 상세, 200-250자)",\n' +
    '    "(세 번째: 핵심 내용 2 상세, 200-250자)",\n' +
    '    "(네 번째: 마무리 + 링크 https://blog.zcheck.co.kr/' + topic.slug + '/, 100-150자)"\n' +
    '  ]\n' +
    '}';

  const res = await fetch(GEMINI_TEXT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini text API error: ${err}`);
  }
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function generateHeroImage(slug) {
  const imagePrompt = buildUniquePrompt(slug);
  const res = await fetch(GEMINI_IMG_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini image API error: ${err}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.mimeType?.startsWith('image/')) {
      return part.inlineData.data;
    }
  }
  throw new Error('No image data returned from Gemini image API');
}

function tomorrowKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const tomorrow = new Date(kstNow.getTime() + 24 * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = '-1003394139746';
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const tomorrowDate = tomorrowKST();
    const publishedSlugs = await getPublishedSlugs();

    const available = TOPIC_POOL.filter((t) => !publishedSlugs.includes(t.slug));
    if (available.length === 0) {
      await sendTelegram('zcheck 블로그: 모든 주제가 발행되었습니다. TOPIC_POOL을 업데이트해주세요.');
      return res.status(200).json({ message: 'All topics published' });
    }

    const topic = available[Math.floor(Math.random() * available.length)];

    await sendTelegram(`zcheck 블로그 콘텐츠 생성 시작
주제: ${topic.keyword}
슬러그: ${topic.slug}
발행일: ${tomorrowDate}`);

    const contentJSON = await generateContentJSON(topic, tomorrowDate);
    const contentPath = `content/${topic.slug}.json`;
    await pushFileToGitHub(
      contentPath,
      JSON.stringify(contentJSON, null, 2),
      `content: add ${topic.slug} for ${tomorrowDate}`
    );

    let imageStatus = 'skipped';
    try {
      const imageBase64 = await generateHeroImage(topic.slug);
      const imagePath = `public/images/${topic.slug}.png`;
      await pushFileToGitHub(
        imagePath,
        imageBase64,
        `image: add hero for ${topic.slug}`,
        true
      );
      imageStatus = 'generated';
    } catch (imgErr) {
      console.error('Image generation failed:', imgErr.message);
      imageStatus = `failed: ${imgErr.message}`;
    }

    const postUrl = `${BLOG_BASE}/${topic.slug}/`;
    await sendTelegram(
      `zcheck 블로그 콘텐츠 생성 완료
` +
      `주제: ${topic.keyword}
` +
      `URL: ${postUrl}
` +
      `이미지: ${imageStatus}
` +
      `발행일: ${tomorrowDate}`
    );

    return res.status(200).json({
      success: true,
      slug: topic.slug,
      keyword: topic.keyword,
      publishedAt: tomorrowDate,
      imageStatus,
      url: postUrl,
    });
  } catch (err) {
    console.error('generate-content error:', err);
    await sendTelegram(`zcheck 블로그 콘텐츠 실패
오류: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
