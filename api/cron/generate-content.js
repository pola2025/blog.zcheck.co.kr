const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "pola2025/blog.zcheck.co.kr";
const GEMINI_TEXT_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=${GEMINI_KEY}`;
const GEMINI_IMG_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${GEMINI_KEY}`;
const BLOG_BASE = "https://blog.zcheck.co.kr";

const TOPIC_POOL = [
  { keyword: "아파트 거실 인테리어", slug: "apartment-living-room-interior" },
  { keyword: "주방 리모델링 비용", slug: "kitchen-remodeling-cost" },
  { keyword: "욕실 타일 교체", slug: "bathroom-tile-replacement" },
  { keyword: "방문 교체 비용", slug: "door-replacement-cost" },
  { keyword: "븬란다 확장 인테리어", slug: "balcony-expansion-interior" },
  { keyword: "원룸 인테리어 셀프", slug: "studio-self-interior" },
  { keyword: "아파트 도배 비용", slug: "apartment-wallpaper-cost" },
  { keyword: "붙박이장 제작 비용", slug: "built-in-closet-cost" },
  { keyword: "주방 상부장 교체", slug: "kitchen-upper-cabinet-replacement" },
  { keyword: "욕실 방수 공사", slug: "bathroom-waterproofing" },
  { keyword: "마루 바닥재 교체 비용", slug: "floor-replacement-cost" },
  { keyword: "싱크대 교체 비용", slug: "sink-replacement-cost" },
  { keyword: "아파트 전체 리모델링", slug: "apartment-full-remodeling" },
  { keyword: "침실 인테리어 꾸미기", slug: "bedroom-interior-decor" },
  { keyword: "화장실 인테리어 리모델링", slug: "toilet-interior-remodeling" },
  { keyword: "청장 도장 셀프 인테리어", slug: "ceiling-paint-self-interior" },
  { keyword: "샷시 교체 비용", slug: "window-frame-replacement-cost" },
  { keyword: "아이방 인테리어 아이디어", slug: "kids-room-interior-ideas" },
  { keyword: "발코니 단열 공사", slug: "balcony-insulation-work" },
  { keyword: "현관 인테리어 꾸미기", slug: "entrance-interior-decor" },
  { keyword: "조명 교체 인테리어", slug: "lighting-replacement-interior" },
  { keyword: "소파 배치 거실 인테리어", slug: "sofa-arrangement-living-room" },
  { keyword: "화이트 인테리어 아파트", slug: "white-interior-apartment" },
  { keyword: "북유럽 인테리어 스타일", slug: "nordic-interior-style" },
  { keyword: "모던 아파트 인테리어", slug: "modern-apartment-interior" },
];

const SCENE_TIMES = [
  "오전 햇살이 가득한",
  "저녁 골든아워",
  "흘린 날 은은한 자연광",
  "야간 간접조명",
];
const ROOM_SCENES = [
  "넓은 거실",
  "모던한 주방",
  "아늘한 침실",
  "깔끔한 욕실",
  "밝은 븬란다",
];
const STYLE_MOODS = [
  "미니멀리즘",
  "북유럽 스칸디나비아",
  "내추럴 우드",
  "모던 럭셔리",
  "빈티지 감성",
];
const COLOR_PALETTE = [
  "화이트&그레이",
  "베이지&아이보리",
  "딥그린&우드",
  "블랙&화이트",
  "테라코타&크림",
];

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
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) return [];
  const files = await res.json();
  return files.map((f) => f.name.replace(/\.json$/, ""));
}

async function pushFileToGitHub(filePath, content, message, isBinary = false) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  let sha;
  const checkRes = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (checkRes.ok) {
    const existing = await checkRes.json();
    sha = existing.sha;
  }
  const body = {
    message,
    content: isBinary ? content : Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
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
  const prompt = `당신은 한국 인테리어 리모델링 정보 블로그 "집첵"의 시니어 콘텐츠 에디터입니다.
실제 인테리어 경험이 풍부한 사람이 쓴 것처럼, 독자에게 직접 말하는 대화체로 작성합니다.

주제: ${topic.keyword}

## 집첵 서비스 정보
- 사이트: zcheck.co.kr
- 핵심 서비스: 인테리어 견적서 1개를 이메일로 받아 48시간 이내 분석
- 이 서비스를 본문에 1회 자연스럽게 언급 (광고처럼 보이지 않게)

## content_html 작성 규칙 (CRITICAL)

### 어투 규칙 (AI 탐지 우회)
- 문장 길이 다양화: 짧은 문장(1줄)과 긴 문장(3-4줄)을 반드시 섞을 것
- 어미 다양화: ~거든요 / ~더라고요 / ~잖아요 / ~인데요 / ~이에요 를 고루 섞을 것
- 금지 서론: "오늘은 ~에 대해 알아보겠습니다" 절대 금지
- 금지 결론: "지금까지 ~에 대해 알아보았습니다" 절대 금지
- 금지 접속사: "따라서", "그러므로", "또한", "게다가", "이러한", "이처럼" 남발 금지
- 금지 표현: "매우", "굉장히", "정말로" 남발 금지
- 백과사전체 금지, 친구에게 말하듯 대화체 필수
- 구체적 수치/경험담 포함, 본문 끝에 독자 질문 1개 포함

### HTML 구조 (집첵 블로그 CSS 컴포넌트 적극 활용)
반드시 아래 커스텀 컴포넌트를 최소 3종류 이상 사용:

1. 팁 박스:
<div class="zc-tip"><div class="zc-tip-title">💡 알아두세요</div><p>내용</p></div>

2. 경고 박스:
<div class="zc-warning"><div class="zc-warning-title">⚠️ 주의</div><p>내용</p></div>

3. 체크리스트:
<div class="zc-checklist"><div class="zc-checklist-title">✅ 체크리스트 제목</div><ul><li>항목1</li><li>항목2</li></ul></div>

4. 하이라이트:
<div class="zc-highlight"><p>강조할 핵심 내용</p></div>

5. 단계별 가이드:
<div class="zc-steps"><div class="zc-step"><div class="zc-step-num">1</div><div class="zc-step-body"><strong>단계 제목</strong><p>설명</p></div></div></div>

6. 콜아웃:
<div class="zc-callout"><div class="zc-callout-accent"></div><div class="zc-callout-inner"><div class="zc-callout-emoji">💡</div><div class="zc-callout-content"><strong>제목</strong><p>내용</p></div></div></div>

일반 태그: h2, h3, p, ul, li 사용 가능
마크다운 절대 금지, 순수 HTML만

### 분량 기준
- 최소 2000자 이상 (HTML 태그 제외 텍스트 기준)
- h2 소제목 5개 이상
- 전체 문단 15개 이상

반드시 아래 JSON 형식으로만 응답하세요:
{
  "slug": "${topic.slug}",
  "title": "한글 제목 (35-45자, 숫자나 구체적 표현 포함)",
  "meta_description": "검색 스니펫용 요약 (120자 이내, 핵심 정보 포함)",
  "category": "인테리어",
  "target_keyword": "${topic.keyword}",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "published_at": "${tomorrowDate}T09:00:00.000Z",
  "published": true,
  "hero_image": "/images/${topic.slug}.png",
  "content_html": "(위 규칙 준수한 완전한 HTML 본문)",
  "read_time": "6분",
  "instagram_caption": "이모지 포함 캡션\\n\\n핵심 정보 2-3줄\\n\\n#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5 #해시태그6 #해시태그7 (250자 이내)",
  "threads_chain": [
    "훅: 독자가 멈추게 만드는 첫 문장. 질문이나 충격적 사실로 시작 (150자 이내)",
    "핵심 정보 3가지를 번호 매겨서 전달. 줄바꿈 포함 (200자 이내)",
    "CTA: 더 자세한 내용은 blog.zcheck.co.kr 에서 확인하세요 포함 (100자 이내)"
  ]
}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(GEMINI_TEXT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: attempt === 1 ? 0.9 : 1.0,
          maxOutputTokens: 16384,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini text API error: ${err}`);
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        `[GEN] JSON 파싱 실패 (attempt ${attempt}): ${parseErr.message}`,
      );
      if (attempt < 2) continue;
      throw new Error(`JSON 파싱 실패: ${parseErr.message}`);
    }

    // 품질 검증: content_html 텍스트 길이 (HTML 태그 제거 후)
    const textOnly = (parsed.content_html || "").replace(/<[^>]+>/g, "").trim();
    if (textOnly.length >= 1500) return parsed;
    if (attempt === 1) {
      console.warn(`[GEN] 1차 생성 ${textOnly.length}자 - 재시도`);
    } else {
      console.warn(`[GEN] 2차 생성 ${textOnly.length}자 - 그대로 사용`);
      return parsed;
    }
  }
}

async function generateHeroImage(slug) {
  const imagePrompt = buildUniquePrompt(slug);
  const res = await fetch(GEMINI_IMG_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini image API error: ${err}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.mimeType?.startsWith("image/")) {
      return part.inlineData.data;
    }
  }
  throw new Error("No image data returned from Gemini image API");
}

function tomorrowKST() {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffset);
  const tomorrow = new Date(kstNow.getTime() + 24 * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = "-1003394139746";
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers["authorization"];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const tomorrowDate = tomorrowKST();
    const publishedSlugs = await getPublishedSlugs();

    const available = TOPIC_POOL.filter(
      (t) => !publishedSlugs.includes(t.slug),
    );
    if (available.length === 0) {
      await sendTelegram(
        "zcheck 블로그: 모든 주제가 발행되었습니다. TOPIC_POOL을 업데이트해주세요.",
      );
      return res.status(200).json({ message: "All topics published" });
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
      `content: add ${topic.slug} for ${tomorrowDate}`,
    );

    let imageStatus = "skipped";
    try {
      const imageBase64 = await generateHeroImage(topic.slug);
      const imagePath = `images/${topic.slug}.png`;
      await pushFileToGitHub(
        imagePath,
        imageBase64,
        `image: add hero for ${topic.slug}`,
        true,
      );
      imageStatus = "generated";
    } catch (imgErr) {
      console.error("Image generation failed:", imgErr.message);
      imageStatus = `failed: ${imgErr.message}`;
    }

    // Push schedule file for publish-social cron
    const schedData = {
      slug: topic.slug,
      title: contentJSON.title || topic.keyword,
      schedule_date: tomorrowDate + " 09:00",
      hero_image: "/images/" + topic.slug + ".png",
      instagram_caption: contentJSON.instagram_caption || "",
      threads_chain: contentJSON.threads_chain || [],
    };
    await pushFileToGitHub(
      "schedule/" + topic.slug + ".json",
      JSON.stringify(schedData, null, 2),
      "schedule: " + tomorrowDate + " - " + topic.slug,
    );

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
        `발행일: ${tomorrowDate}`,
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
    console.error("generate-content error:", err);
    await sendTelegram(`zcheck 블로그 콘텐츠 실패
오류: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
