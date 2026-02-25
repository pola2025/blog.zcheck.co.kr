/**
 * Instagram 자동 발행 스크립트
 *
 * 블로그 포스트 JSON을 읽어 Instagram 단일 이미지 게시물로 발행
 * - 이미지: 블로그 히어로 이미지 (Vercel 배포 후 공개 URL)
 * - 캡션: 제목 + 요약 + 해시태그 + 블로그 링크
 *
 * Instagram Graph API 사용 (Business/Creator 계정 필요)
 * 2단계: 컨테이너 생성 → 미디어 게시
 *
 * 사용법: node scripts/publish-instagram.js <content.json>
 * 환경변수: IG_ACCESS_TOKEN, IG_USER_ID (.env에서 로드)
 */

const fs = require("fs");
const path = require("path");

// .env 로드
const envPath = path.resolve(
  __dirname,
  "..",
  "..",
  "zcheck-content-pipeline",
  ".env",
);
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const clean = line.replace(/\r/, "");
    const match = clean.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const IG_API_BASE = "https://graph.facebook.com/v21.0";
const BLOG_BASE = "https://blog.zcheck.co.kr";
const MAX_CAPTION = 2200; // Instagram 캡션 제한
const PUBLISHED_LOG = path.resolve(
  __dirname,
  "..",
  "schedule",
  "published-ig.json",
);

function loadPublishedLog() {
  if (fs.existsSync(PUBLISHED_LOG)) {
    return JSON.parse(fs.readFileSync(PUBLISHED_LOG, "utf-8"));
  }
  return {};
}

function savePublishedLog(log) {
  fs.writeFileSync(PUBLISHED_LOG, JSON.stringify(log, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 마크다운 마커 제거 (**볼드**, ==하이라이트==)
 */
function cleanMarkdown(text) {
  return text.replace(/\*\*/g, "").replace(/==/g, "").trim();
}

/**
 * heading에서 번호 prefix 제거 (1. / 2) 등)
 */
function cleanHeading(heading) {
  return heading.replace(/^\d+[\.\)]\s*/, "").trim();
}

/**
 * 텍스트에서 핵심 내용 추출
 * 블로그의 짧은 줄바꿈(20~25자)을 문장으로 합치고, maxChars 이내로 반환
 */
function extractKeyLines(rawText, maxChars) {
  const cleaned = rawText.replace(/\*\*/g, "").replace(/==/g, "");
  // 더블 뉴라인으로 문단 분리, 문단 내 줄바꿈은 공백으로 합침
  const paragraphs = cleaned
    .split(/\n\n+/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((l) => l);

  let result = "";
  for (const para of paragraphs) {
    if (result.length + para.length + 1 > maxChars) break;
    result += (result ? "\n" : "") + para;
  }
  return result || (paragraphs[0] || "").substring(0, maxChars);
}

/**
 * 텍스트에서 **볼드** 텍스트를 제목으로 추출
 */
function extractBoldTitle(text) {
  const match = text.match(/\*\*(.+?)\*\*/);
  return match ? match[1] : null;
}

/**
 * 해시태그 문자열 생성 (총 8개)
 */
function buildHashtags(post) {
  const tags = (post.tags || []).slice(0, 6);
  const baseTags = ["집첵", "인테리어"];
  const allTags = [...new Set([...tags, ...baseTags])].slice(0, 8);
  return allTags.map((t) => `#${t.replace(/\s/g, "")}`).join(" ");
}

/**
 * 블로그 포스트 → Instagram 자체완결형 캡션 생성
 * 1. instagram_caption 필드가 있으면 그대로 사용
 * 2. 없으면 body_sections에서 자동 생성 (800~1,200자 목표)
 *
 * 구조: Hook 제목 → 도입 2~3줄 → --- → 번호 항목 → --- → 마무리 CTA → 해시태그
 */
function buildCaption(post) {
  // instagram_caption 필드 우선 사용
  if (post.instagram_caption) {
    let caption = post.instagram_caption;
    if (!caption.includes("#")) {
      caption += "\n\n" + buildHashtags(post);
    }
    return caption.substring(0, MAX_CAPTION);
  }

  // body_sections에서 자동 생성
  const sections = post.body_sections || [];
  const parts = [];

  // Hook 제목
  parts.push(post.title || "");

  // 도입부 (첫 번째 text 섹션에서 2~3문장)
  const textSections = sections.filter((s) => s.type === "text");
  if (textSections.length > 0) {
    const intro = extractKeyLines(textSections[0].content, 120);
    parts.push("", intro);
  }

  parts.push("", "---");

  // 핵심 항목: keypoints 제목 + 대응 text section에서 상세 설명
  const kpSection = sections.find((s) => s.type === "keypoints");
  const contentTexts = textSections.slice(1);

  if (kpSection && kpSection.points) {
    kpSection.points.forEach((point, i) => {
      const title = cleanHeading(point.title);
      let desc = "";
      if (contentTexts[i]) {
        desc = extractKeyLines(contentTexts[i].content, 200);
      } else if (point.desc) {
        desc = point.desc;
      }
      parts.push("", `${i + 1}. ${title}`);
      if (desc) parts.push(desc);
    });
  } else {
    // heading+text 쌍에서 추출
    let itemNum = 0;
    let currentHeading = null;
    for (const section of sections) {
      if (section.type === "heading") {
        currentHeading = cleanHeading(section.content);
      } else if (section.type === "text" && section !== textSections[0]) {
        itemNum++;
        const heading =
          currentHeading ||
          extractBoldTitle(section.content) ||
          `포인트 ${itemNum}`;
        const content = extractKeyLines(section.content, 200);
        parts.push("", `${itemNum}. ${heading}`);
        if (content) parts.push(content);
        currentHeading = null;
      }
    }
  }

  parts.push("", "---");

  // CTA (소프트 - 블로그 URL 직접 삽입 금지)
  const isTypeB = /피해|사기|예방/.test((post.category || "").toLowerCase());
  if (isTypeB) {
    parts.push(
      "",
      "업체가 제시한 견적이 적정한지 궁금하다면\n프로필 링크에서 확인해 보세요.",
    );
  } else {
    parts.push("", "꼼꼼하게 확인하는 게\n결국 수백만 원을 아끼는 방법이에요.");
  }

  // 해시태그
  parts.push("", buildHashtags(post));

  return parts.join("\n").substring(0, MAX_CAPTION);
}

/**
 * 블로그 포스트의 히어로 이미지 공개 URL
 */
function getImageUrl(post) {
  if (post.hero_image) {
    return `${BLOG_BASE}${post.hero_image}`;
  }
  return null;
}

/**
 * Instagram Graph API: 이미지 컨테이너 생성
 */
async function createMediaContainer(userId, token, imageUrl, caption) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption: caption,
    access_token: token,
  });

  const res = await fetch(`${IG_API_BASE}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (data.error) throw new Error(`컨테이너 생성 실패: ${data.error.message}`);
  return data;
}

/**
 * Instagram Graph API: 미디어 게시
 */
async function publishMedia(userId, token, containerId) {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const res = await fetch(`${IG_API_BASE}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await res.json();
  if (data.error) throw new Error(`게시 실패: ${data.error.message}`);
  return data;
}

/**
 * 컨테이너 상태 확인 (이미지 처리 대기)
 */
async function waitForProcessing(token, containerId, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(
      `${IG_API_BASE}/${containerId}?fields=status_code&access_token=${token}`,
    );
    const data = await res.json();

    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR") throw new Error("이미지 처리 실패");

    console.log(`  [대기] 이미지 처리 중... (${i + 1}/${maxRetries})`);
    await sleep(5000);
  }
  throw new Error("이미지 처리 타임아웃");
}

// 메인 실행
async function main() {
  const TOKEN = process.env.IG_ACCESS_TOKEN;
  const USER_ID = process.env.IG_USER_ID;

  if (!TOKEN || !USER_ID) {
    console.error("[ERROR] 환경변수 필요: IG_ACCESS_TOKEN, IG_USER_ID");
    console.error("F:\\zcheck-content-pipeline\\.env 파일에 추가하세요.");
    console.error("");
    console.error("토큰 발급 방법은 docs/social-api-setup-guide.html 참조");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("사용법: node scripts/publish-instagram.js <content.json>");
    console.log(
      "예시:   node scripts/publish-instagram.js content/remodeling-checklist-2026.json",
    );
    process.exit(1);
  }

  const postPath = path.resolve(args[0]);
  if (!fs.existsSync(postPath)) {
    console.error(`[ERROR] 파일 없음: ${postPath}`);
    process.exit(1);
  }

  const post = JSON.parse(fs.readFileSync(postPath, "utf-8"));
  console.log(`[INSTAGRAM] 포스트 로드: ${post.title}`);

  // 중복 발행 방지
  const publishedLog = loadPublishedLog();
  const slug = post.slug;
  if (publishedLog[slug]) {
    console.log(
      `[INSTAGRAM] SKIP: 이미 발행됨 (${publishedLog[slug].published_at})`,
    );
    console.log(`  미디어 ID: ${publishedLog[slug].media_id}`);
    return { mediaId: publishedLog[slug].media_id, skipped: true };
  }

  const imageUrl = getImageUrl(post);
  if (!imageUrl) {
    console.error(
      "[ERROR] 히어로 이미지가 없습니다. 먼저 이미지를 생성하세요.",
    );
    console.error("실행: node scripts/generate-hero-images.js");
    process.exit(1);
  }

  const caption = buildCaption(post);

  // --dry-run 모드
  const dryRun = args.includes("--dry-run");

  if (dryRun) {
    console.log("\n=== DRY RUN (미리보기) ===\n");
    console.log(`이미지 URL: ${imageUrl}`);
    console.log(`캡션 길이: ${caption.length}자`);
    console.log("---");
    console.log(caption);
    console.log("---");
    return;
  }

  // 실제 발행
  console.log(`[INSTAGRAM] 이미지: ${imageUrl}`);
  console.log(`[INSTAGRAM] 캡션 길이: ${caption.length}자`);

  console.log("[INSTAGRAM] 컨테이너 생성 중...");
  const container = await createMediaContainer(
    USER_ID,
    TOKEN,
    imageUrl,
    caption,
  );
  console.log(`  [OK] 컨테이너 ID: ${container.id}`);

  console.log("[INSTAGRAM] 이미지 처리 대기...");
  await waitForProcessing(TOKEN, container.id);

  console.log("[INSTAGRAM] 게시 중...");
  const result = await publishMedia(USER_ID, TOKEN, container.id);
  console.log(`  [OK] 미디어 ID: ${result.id}`);

  console.log(`\n[INSTAGRAM] 완료! 게시물 ID: ${result.id}`);

  // 발행 이력 저장 (중복 방지용)
  publishedLog[slug] = {
    media_id: result.id,
    published_at: new Date().toISOString(),
    image_url: imageUrl,
  };
  savePublishedLog(publishedLog);

  return { mediaId: result.id };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { buildCaption, getImageUrl, main };
