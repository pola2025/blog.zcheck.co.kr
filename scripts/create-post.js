/**
 * 네이버 블로그 콘텐츠 → blog.zcheck.co.kr 콘텐츠 변환
 *
 * 사용법:
 *   node scripts/create-post.js <naver-content.json>
 *
 * - 네이버 콘텐츠 JSON을 받아 블로그용 JSON으로 변환
 * - 첫 번째 이미지를 hero image로 사용
 * - 본문을 구조화된 형태로 리라이팅 (섹션 재구성)
 * - SEO 메타 생성
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');

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
  const heroImageLocal = firstImage ? path.resolve(firstImage.path) : null;

  // 본문 섹션 재구성 (이미지 제외, 텍스트만 구조화)
  const blogSections = [];
  for (const section of raw.body_sections) {
    if (section.type === 'image') continue; // hero만 사용

    if (section.type === 'heading') {
      blogSections.push({ type: 'heading', content: section.content });
    } else if (section.type === 'text') {
      blogSections.push({ type: 'text', content: section.content });
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

  return outPath;
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
