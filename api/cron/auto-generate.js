/**
 * Vercel Cron - 블로그 콘텐츠 자동 생성
 *
 * 매일 21:00 UTC (06:00 KST) 실행
 * 1. Workers KV에서 오늘 주제 꺼내기
 * 2. Gemini → 블로그 콘텐츠 JSON 생성
 * 3. Gemini → hero 이미지 생성 (base64)
 * 4. Workers /api/cron/images/upload → R2 저장 → URL 반환
 * 5. Workers /api/cron/posts → Airtable 저장
 * 6. Workers /api/cron/today → slug + 소셜 데이터 KV 저장
 * 7. Vercel Deploy Hook → 재빌드 트리거
 *
 * 환경변수 (Vercel Dashboard):
 *   GEMINI_API_KEY
 *   CRON_SECRET          (Vercel 자동 주입 - Vercel-to-Vercel 인증용)
 *   WORKERS_CRON_SECRET  (Vercel → Workers 호출 시 인증)
 *   VERCEL_DEPLOY_HOOK_URL
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

const WORKERS_BASE = "https://zipcheck-api.zipcheck2025.workers.dev";
const GEMINI_TEXT_MODEL = "gemini-3-pro-preview";
const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0]; // "2026-02-25"
}

function workersHeaders() {
  return {
    "Content-Type": "application/json",
    "x-cron-secret": process.env.WORKERS_CRON_SECRET || "",
  };
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

/**
 * Gemini 텍스트 생성 (JSON 모드)
 */
async function generateContent(topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const prompt = `당신은 한국 인테리어 리모델링 정보 블로그 "집첵"의 시니어 콘텐츠 에디터입니다.
실제 인테리어 경험이 풍부한 사람이 쓴 것처럼, 독자에게 직접 말하는 대화체로 작성합니다.

주제: ${topic}

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

반드시 아래 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON):
{
  "slug": "영문-소문자-하이픈-최대5단어",
  "title": "한글 제목 (35-45자, 숫자나 구체적 표현 포함)",
  "category": "정보 및 참고사항",
  "excerpt": "검색 스니펫용 요약 (120자 이내, 핵심 정보 포함)",
  "content_html": "(위 규칙 준수한 완전한 HTML 본문)",
  "read_time": "6분",
  "tags": "인테리어,리모델링,태그3,태그4,태그5",
  "instagram_caption": "이모지 포함 캡션\\n\\n핵심 정보 2-3줄\\n\\n#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5 #해시태그6 #해시태그7 (250자 이내)",
  "threads_chain": [
    "훅: 독자가 멈추게 만드는 첫 문장. 질문이나 충격적 사실로 시작 (150자 이내)",
    "핵심 정보 3가지를 번호 매겨서 전달. 줄바꿈 포함 (200자 이내)",
    "CTA: 더 자세한 내용은 blog.zcheck.co.kr 에서 확인하세요 포함 (100자 이내)"
  ]
}

category는 반드시 "정보 및 참고사항" 또는 "피해예방" 중 하나`;

  // 최대 2번 시도 (품질 미달 시 재시도)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(
      `${GEMINI_API}/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: attempt === 1 ? 0.9 : 1.0,
            maxOutputTokens: 16384,
          },
        }),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini 텍스트 생성 실패 (${res.status}): ${err}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 응답에 텍스트 없음");

    const parsed = JSON.parse(text);

    // 품질 검증: content_html 텍스트 길이 체크 (HTML 태그 제거 후)
    const textOnly = (parsed.content_html || "").replace(/<[^>]+>/g, "").trim();
    if (textOnly.length >= 1500) {
      return parsed; // 품질 통과
    }
    if (attempt === 1) {
      console.warn(`[AUTO-GEN] 1차 생성 텍스트 ${textOnly.length}자 - 재시도`);
    } else {
      console.warn(
        `[AUTO-GEN] 2차 생성 텍스트 ${textOnly.length}자 - 그대로 사용`,
      );
      return parsed;
    }
  }
}

/**
 * Gemini 이미지 생성 → base64 반환
 */
async function generateImage(title, slug) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 환경변수 없음");

  const imagePrompt = `Create a professional Korean interior design blog hero image.
Topic: "${title}"

Style requirements:
- Clean, modern Korean apartment interior photography style
- Bright, airy space with abundant natural light from windows
- Include tropical plant decoration (monstera deliciosa, bird of paradise, or sansevieria)
- Professional real estate photography quality, warm neutral tones
- Modern Korean apartment aesthetic with clean lines
- No text overlays, no people, no faces
- Horizontal landscape orientation (16:9 ratio)
- High quality, suitable for blog header image`;

  const res = await fetch(
    `${GEMINI_API}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: imagePrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini 이미지 생성 실패 (${res.status}): ${err}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }

  throw new Error("Gemini 이미지 응답에 inlineData 없음");
}

/**
 * Workers R2에 이미지 업로드
 */
async function uploadImage(slug, imageBase64, mimeType) {
  const res = await fetch(`${WORKERS_BASE}/api/cron/images/upload`, {
    method: "POST",
    headers: workersHeaders(),
    body: JSON.stringify({ slug, imageBase64, mimeType }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`이미지 업로드 실패 (${res.status}): ${err}`);
  }

  return await res.json(); // { key, url }
}

/**
 * Workers Airtable에 포스트 생성
 */
async function createPost(postData) {
  const res = await fetch(`${WORKERS_BASE}/api/cron/posts`, {
    method: "POST",
    headers: workersHeaders(),
    body: JSON.stringify(postData),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`포스트 생성 실패 (${res.status}): ${err}`);
  }

  return await res.json();
}

/**
 * Workers KV에 오늘 데이터 저장
 */
async function saveTodayData(todayData) {
  const res = await fetch(`${WORKERS_BASE}/api/cron/today`, {
    method: "PUT",
    headers: workersHeaders(),
    body: JSON.stringify(todayData),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`today 저장 실패 (${res.status}): ${err}`);
  }
}

/**
 * Workers KV 주제 큐 조회
 */
async function getTopicQueue() {
  const res = await fetch(`${WORKERS_BASE}/api/cron/topic-queue`, {
    headers: workersHeaders(),
  });

  if (!res.ok) throw new Error(`주제 큐 조회 실패 (${res.status})`);
  const data = await res.json();
  return data.topics || [];
}

/**
 * Workers KV 주제 큐 업데이트
 */
async function updateTopicQueue(topics) {
  const res = await fetch(`${WORKERS_BASE}/api/cron/topic-queue`, {
    method: "PUT",
    headers: workersHeaders(),
    body: JSON.stringify({ topics }),
  });

  if (!res.ok) throw new Error(`주제 큐 저장 실패 (${res.status})`);
}

/**
 * Vercel Deploy Hook 트리거
 */
async function triggerDeploy() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    console.warn("[AUTO-GEN] VERCEL_DEPLOY_HOOK_URL 없음 - 배포 스킵");
    return null;
  }

  const res = await fetch(hookUrl, { method: "POST" });
  if (!res.ok) throw new Error(`Deploy Hook 실패 (${res.status})`);
  const data = await res.json();
  return data?.job?.id || "triggered";
}

module.exports = async function handler(req, res) {
  // Vercel Cron 인증 확인
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = todayKST();
  const logs = [`[${today}] auto-generate 시작`];

  try {
    // 1. 주제 큐에서 오늘 주제 꺼내기
    const topics = await getTopicQueue();
    logs.push(`주제 큐: ${topics.length}개`);

    if (topics.length === 0) {
      const msg =
        "주제 큐가 비었습니다. Workers KV blog:topic:queue에 주제를 추가해주세요.";
      logs.push(msg);
      await sendTelegram(`<b>⚠️ Auto-Generate Cron</b>\n\n${today}\n${msg}`);
      return res.status(200).json({ logs, status: "no_topics" });
    }

    const topic = topics[0];
    const remainingTopics = topics.slice(1);
    logs.push(`오늘 주제: ${topic}`);

    // 2. Gemini 텍스트 생성
    logs.push("Gemini 텍스트 생성 중...");
    const content = await generateContent(topic);
    const {
      slug,
      title,
      category,
      excerpt,
      content_html,
      read_time,
      tags,
      instagram_caption,
      threads_chain,
    } = content;
    logs.push(`생성 완료: ${slug} - ${title}`);

    // 3. Gemini 이미지 생성
    logs.push("Gemini 이미지 생성 중...");
    const { imageBase64, mimeType } = await generateImage(title, slug);
    logs.push("이미지 생성 완료");

    // 4. Workers R2에 이미지 업로드
    logs.push("이미지 R2 업로드 중...");
    const imageResult = await uploadImage(slug, imageBase64, mimeType);
    const thumbnailUrl = imageResult.url;
    const thumbnailKey = imageResult.key;
    logs.push(`이미지 업로드 완료: ${thumbnailUrl}`);

    // 5. Workers Airtable에 포스트 생성
    logs.push("Airtable 포스트 생성 중...");
    const publishedDate = today.replace(/-/g, ".");
    await createPost({
      title,
      slug,
      category: category || "정보 및 참고사항",
      excerpt: excerpt || "",
      content: content_html,
      read_time: read_time || "5분",
      author: "집첵 에디터",
      thumbnail_key: thumbnailKey,
      tags: tags || "",
      status: "published",
      published_date: publishedDate,
    });
    logs.push("포스트 Airtable 저장 완료");

    // 6. Workers KV에 today 데이터 저장 (publish-social이 사용)
    await saveTodayData({
      slug,
      title,
      thumbnail_url: thumbnailUrl,
      instagram_caption,
      threads_chain,
      published_date: today,
    });
    logs.push("KV blog:today 저장 완료");

    // 7. 주제 큐 업데이트 (사용한 주제 제거)
    await updateTopicQueue(remainingTopics);
    logs.push(`주제 큐 업데이트: ${remainingTopics.length}개 남음`);

    // 8. Vercel Deploy Hook → 재빌드 트리거
    await sleep(2000);
    const deployId = await triggerDeploy();
    logs.push(`Deploy Hook 트리거 완료: ${deployId}`);

    // 텔레그램 성공 알림
    const remainingCount = remainingTopics.length;
    await sendTelegram(
      `<b>✅ 블로그 자동 생성 완료</b>\n\n` +
        `<b>${title}</b>\n` +
        `슬러그: ${slug}\n` +
        `카테고리: ${category || "정보 및 참고사항"}\n` +
        `이미지: ${thumbnailUrl}\n` +
        `남은 주제: ${remainingCount}개\n` +
        `배포 ID: ${deployId}\n\n` +
        `09:00 KST 소셜 발행 예정`,
    );

    return res.status(200).json({ logs, slug, title, thumbnailUrl, deployId });
  } catch (err) {
    const errMsg = err.message || String(err);
    logs.push(`ERROR: ${errMsg}`);
    console.error("[AUTO-GEN] 오류:", err);

    await sendTelegram(
      `<b>❌ 블로그 자동 생성 실패</b>\n\n${today}\n\n${errMsg}`,
    );

    return res.status(500).json({ logs, error: errMsg });
  }
};
