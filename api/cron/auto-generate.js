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
const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
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

  const prompt = `당신은 한국 인테리어 리모델링 정보 블로그 "집첵"의 콘텐츠 에디터입니다.
다음 주제로 SEO 최적화된 블로그 포스트를 작성해주세요.

주제: ${topic}

반드시 아래 JSON 형식으로만 응답하세요 (마크다운 없이 순수 JSON):
{
  "slug": "영문-소문자-하이픈-슬러그-최대5단어",
  "title": "한글 제목 (35-45자, 숫자 포함 권장)",
  "category": "정보 및 참고사항",
  "excerpt": "150자 이내 요약문 (검색 스니펫용)",
  "content_html": "완전한 HTML 블로그 본문 (h2, h3, p, ul, li 태그만 사용, 최소 1200자, 집첵 견적서 분석 서비스 zcheck.co.kr 언급 1회 자연스럽게 포함)",
  "read_time": "5분",
  "tags": "인테리어,리모델링,주제관련태그1,주제관련태그2,주제관련태그3",
  "instagram_caption": "인스타그램 캡션 (이모지 적극 활용, 해시태그 7개 이상, 줄바꿈 포함, 250자 이내)",
  "threads_chain": [
    "첫 번째 스레드 (훅 문장, 궁금증 유발, 150자 이내)",
    "두 번째 스레드 (핵심 정보 2-3가지, 줄바꿈 포함, 200자 이내)",
    "세 번째 스레드 (CTA - blog.zcheck.co.kr 링크 포함, 100자 이내)"
  ]
}

작성 규칙:
- content_html: 실제 HTML 태그만, 마크다운 절대 금지
- category는 반드시 "정보 및 참고사항" 또는 "피해예방" 중 하나
- slug: 영문 소문자와 하이픈만 사용
- 인테리어 실용 정보 중심, 초보자도 이해하기 쉽게`;

  const res = await fetch(
    `${GEMINI_API}/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.85,
          maxOutputTokens: 8192,
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

  return JSON.parse(text);
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
          response_modalities: ["IMAGE", "TEXT"],
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
