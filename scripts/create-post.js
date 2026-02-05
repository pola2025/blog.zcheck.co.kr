/**
 * 네이버 블로그 콘텐츠 → blog.zcheck.co.kr 콘텐츠 변환
 *
 * 사용법:
 *   node scripts/create-post.js <naver-content.json>
 *
 * - 네이버 콘텐츠 JSON을 받아 블로그용 JSON으로 변환
 * - 첫 번째 이미지를 hero image로 사용
 * - 본문을 구조화된 형태로 리라이팅 (섹션 재구성)
 * - keypoints/callout 자동 생성
 * - SEO 메타 생성
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');

// 경고/주의 패턴 감지
const WARNING_PATTERNS = [
  /주의/,
  /조심/,
  /피해/,
  /사기/,
  /분쟁/,
  /위험/,
  /절대\s*(?:금지|안|하지)/,
];
// 팁/조언 패턴 감지
const TIP_PATTERNS = [
  /반드시/,
  /꼭\s/,
  /확인하/,
  /추천/,
  /권장/,
  /요청하세요/,
  /팁/,
];

function createPost(naverContentPath) {
  const raw = JSON.parse(fs.readFileSync(naverContentPath, 'utf-8'));

  // slug 생성 (zcheck_blog_url에서 추출 우선)
  let slug = raw.slug;
  if (!slug && raw.zcheck_blog_url) {
    const urlPath = new URL(raw.zcheck_blog_url).pathname;
    slug = urlPath.replace(/^\//, '').replace(/\/$/, '');
  }
  if (!slug) {
    slug = raw.target_keyword
      .replace(/[가-힣]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || 'post-' + Date.now();
  }

  // 첫 번째 이미지 경로
  const firstImage = raw.body_sections.find((s) => s.type === 'image');
  const heroImageLocal = firstImage
    ? path.resolve(firstImage.path || firstImage.local_path)
    : null;

  // 본문 섹션 재구성 (이미지 포함, 구조화 요소 자동 생성)
  const blogSections = [];
  const headingTextPairs = []; // keypoints 자동 생성용

  let isFirstImage = true;
  let currentHeading = null;
  let calloutGenerated = false;

  // 텍스트 섹션만 추출하여 마지막 텍스트 인덱스 파악 (결론 감지)
  const textIndices = raw.body_sections
    .map((s, i) => (s.type === 'text' ? i : -1))
    .filter((i) => i >= 0);
  const lastTextIdx = textIndices[textIndices.length - 1];

  for (let idx = 0; idx < raw.body_sections.length; idx++) {
    const section = raw.body_sections[idx];

    if (section.type === 'image') {
      if (isFirstImage) {
        isFirstImage = false;
        continue; // 첫 이미지는 hero로 사용
      }
      const imgPath = section.path || section.local_path;
      if (imgPath) {
        blogSections.push({
          type: 'image',
          path: imgPath,
          alt: section.alt || section.caption || '',
        });
      }
      continue;
    }

    if (section.type === 'heading') {
      currentHeading = section.content;
      blogSections.push({ type: 'heading', content: section.content });
    } else if (section.type === 'text') {
      blogSections.push({ type: 'text', content: section.content });

      // heading-text 쌍 수집 (keypoints 생성용)
      if (currentHeading) {
        headingTextPairs.push({
          heading: currentHeading,
          text: section.content,
        });
        currentHeading = null;
      }

      // callout 자동 생성: 최대 1개, 마지막 텍스트(결론) 제외
      if (!calloutGenerated && idx !== lastTextIdx) {
        const callout = generateCallout(section.content);
        if (callout) {
          blogSections.push(callout);
          calloutGenerated = true;
        }
      }
    } else {
      // 이미 구조화된 섹션(callout, keypoints 등)은 그대로 통과
      blogSections.push(section);
      if (section.type === 'callout') calloutGenerated = true;
    }
  }

  // keypoints 자동 생성 (heading-text 쌍이 2개 이상일 때)
  if (headingTextPairs.length >= 2) {
    const existingKeypoints = blogSections.some((s) => s.type === 'keypoints');
    if (!existingKeypoints) {
      const keypoints = generateKeypoints(
        headingTextPairs,
        raw.title || raw.target_keyword,
      );
      blogSections.push(keypoints);
    }
  }

  // 메타 설명 (첫 텍스트 섹션에서 추출)
  const firstText = blogSections.find((s) => s.type === 'text');
  const metaDesc = firstText
    ? firstText.content.replace(/\n/g, ' ').substring(0, 150).trim() + '...'
    : raw.title;

  const blogPost = {
    slug,
    title: raw.title,
    meta_description: metaDesc,
    category: raw.category || '인테리어 가이드',
    target_keyword: raw.target_keyword,
    tags: raw.tags || [],
    published_at: new Date().toISOString(),
    published: true,
    hero_image_local: heroImageLocal,
    hero_image: heroImageLocal ? `/images/${slug}.png` : null,
    body_sections: blogSections,
    source: 'naver-pipeline',
    naver_content_file: path.basename(naverContentPath),
  };

  // 저장
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
  const outPath = path.join(CONTENT_DIR, `${slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(blogPost, null, 2), 'utf-8');

  console.log(`[CREATE] 블로그 포스트 생성: ${outPath}`);
  console.log(`  slug: ${slug}`);
  console.log(`  title: ${blogPost.title}`);
  console.log(`  hero: ${heroImageLocal || '없음'}`);
  console.log(`  sections: ${blogSections.length}개`);

  const calloutCount = blogSections.filter((s) => s.type === 'callout').length;
  const keypointsCount = blogSections.filter(
    (s) => s.type === 'keypoints',
  ).length;
  console.log(`  keypoints: ${keypointsCount}개, callout: ${calloutCount}개`);

  return outPath;
}

/**
 * 텍스트에서 경고/팁 패턴을 감지하여 callout 생성
 * 텍스트당 최대 1개만 생성 (과도한 callout 방지)
 */
function generateCallout(text) {
  const paragraphs = text.split('\n\n');

  for (const para of paragraphs) {
    const plain = para.replace(/\*\*/g, '').replace(/==/g, '');
    // 3문장 이상 포함된 단락에서만 추출 (짧은 텍스트는 무시)
    if (plain.length < 30) continue;

    // 경고 패턴 체크
    for (const pattern of WARNING_PATTERNS) {
      if (pattern.test(plain)) {
        const firstSentence = extractFirstSentence(plain);
        return {
          type: 'callout',
          emoji: '⚠️',
          title: firstSentence.length > 30
            ? firstSentence.substring(0, 30) + '...'
            : firstSentence,
          content: plain.replace(/\n/g, ' ').trim(),
        };
      }
    }

    // 팁 패턴 체크
    for (const pattern of TIP_PATTERNS) {
      if (pattern.test(plain)) {
        const firstSentence = extractFirstSentence(plain);
        return {
          type: 'callout',
          emoji: '💡',
          title: firstSentence.length > 30
            ? firstSentence.substring(0, 30) + '...'
            : firstSentence,
          content: plain.replace(/\n/g, ' ').trim(),
        };
      }
    }
  }

  return null;
}

/**
 * heading-text 쌍에서 keypoints 블록 자동 생성
 */
function generateKeypoints(pairs, title) {
  const points = pairs.map((pair) => {
    // heading에서 번호 제거 ("1. 평수별 비용" → "평수별 비용")
    const cleanHeading = pair.heading.replace(/^\d+[\.\)]\s*/, '').trim();

    // text에서 핵심 문장 추출 (첫 문장 또는 가장 중요한 문장)
    const desc = extractKeySentence(pair.text);

    return {
      title: cleanHeading,
      desc: desc,
    };
  });

  // 제목에서 키워드 추출하여 keypoints 제목 생성
  const keyword = title.replace(/\d{4}/, '').trim();

  return {
    type: 'keypoints',
    title: `${keyword} 핵심 포인트`,
    points: points,
  };
}

/**
 * 텍스트에서 첫 번째 문장 추출
 */
function extractFirstSentence(text) {
  const plain = text.replace(/\n/g, ' ').trim();
  const match = plain.match(/^(.+?[.다요습])(?:\s|$)/);
  return match ? match[1].trim() : plain.substring(0, 60).trim();
}

/**
 * 텍스트에서 핵심 문장 추출 (강조 표시가 있는 문장 우선)
 */
function extractKeySentence(text) {
  const lines = text.replace(/\n\n/g, '\n').split('\n').filter((l) => l.trim());

  // **볼드**나 ==하이라이트==가 포함된 줄 우선
  const emphasized = lines.find(
    (l) => /\*\*.+?\*\*/.test(l) || /==.+?==/.test(l),
  );
  if (emphasized) {
    const clean = emphasized
      .replace(/\*\*/g, '')
      .replace(/==/g, '')
      .trim();
    return clean.length > 80 ? clean.substring(0, 77) + '...' : clean;
  }

  // 없으면 첫 문장 사용
  const first = lines[0] || '';
  const clean = first.replace(/\*\*/g, '').replace(/==/g, '').trim();
  return clean.length > 80 ? clean.substring(0, 77) + '...' : clean;
}

// CLI 실행
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node scripts/create-post.js <naver-content.json>');
    process.exit(1);
  }
  createPost(path.resolve(args[0]));
}

module.exports = { createPost };
