/**
 * ZCheck Blog 빌드 스크립트
 * content/*.json → dist/{slug}/index.html
 *
 * 사용법: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function build() {
  console.log('[BUILD] 시작...');

  // dist 초기화
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // public 복사
  if (fs.existsSync(PUBLIC_DIR)) {
    copyDir(PUBLIC_DIR, DIST_DIR);
  }

  // 콘텐츠 로드
  const posts = loadPosts();
  console.log(`[BUILD] ${posts.length}개 포스트 발견`);

  // 포스트 템플릿
  const postTemplate = fs.readFileSync(
    path.join(TEMPLATE_DIR, 'post.html'),
    'utf-8',
  );

  // 각 포스트 빌드
  for (const post of posts) {
    buildPost(post, postTemplate);
  }

  // 인덱스 빌드
  buildIndex(posts);

  // sitemap.xml
  buildSitemap(posts);

  // robots.txt
  fs.writeFileSync(
    path.join(DIST_DIR, 'robots.txt'),
    'User-agent: *\nAllow: /\nSitemap: https://blog.zcheck.co.kr/sitemap.xml\n',
  );

  console.log(`[BUILD] 완료! dist/ 에 ${posts.length}개 포스트 생성됨`);
}

function loadPosts() {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  const posts = [];

  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'),
      );
      if (data.published !== false) {
        posts.push(data);
      }
    } catch (e) {
      console.error(`[BUILD] JSON 파싱 실패: ${file} — ${e.message}`);
    }
  }

  // 최신 순 정렬
  posts.sort(
    (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
  );
  return posts;
}

function buildPost(post, template) {
  const slug = post.slug;
  const outDir = path.join(DIST_DIR, slug);
  fs.mkdirSync(outDir, { recursive: true });

  // 이미지 복사
  if (post.hero_image_local) {
    const src = path.resolve(post.hero_image_local);
    if (fs.existsSync(src)) {
      const imgDir = path.join(DIST_DIR, 'images');
      fs.mkdirSync(imgDir, { recursive: true });
      const dest = path.join(imgDir, `${slug}.png`);
      fs.copyFileSync(src, dest);
      post.hero_image = `/images/${slug}.png`;
    }
  }

  // 본문 HTML 생성
  const bodyHtml = buildBodyHtml(post.body_sections || []);

  // 태그 HTML
  const tagsHtml = (post.tags || [])
    .map(
      (t) =>
        `<span class="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm">#${esc(t)}</span>`,
    )
    .join('\n          ');

  // 날짜 포맷
  const pubDate = post.published_at
    ? new Date(post.published_at)
    : new Date();
  const dateDisplay = `${pubDate.getFullYear()}년 ${pubDate.getMonth() + 1}월 ${pubDate.getDate()}일`;

  // 템플릿 치환
  let html = template;
  const replacements = {
    '{{title}}': esc(post.title || ''),
    '{{slug}}': esc(slug),
    '{{meta_description}}': esc(
      post.meta_description || post.title || '',
    ),
    '{{keywords}}': esc((post.tags || []).join(', ')),
    '{{og_image}}': post.hero_image
      ? `https://blog.zcheck.co.kr${post.hero_image}`
      : '',
    '{{hero_image}}': post.hero_image || '',
    '{{published_at}}': pubDate.toISOString(),
    '{{date_display}}': dateDisplay,
    '{{category}}': esc(post.category || '인테리어 가이드'),
    '{{body_html}}': bodyHtml,
    '{{tags_html}}': tagsHtml,
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, value);
  }

  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
  console.log(`  [POST] ${slug}/index.html`);
}

function buildBodyHtml(sections) {
  const parts = [];

  for (const section of sections) {
    switch (section.type) {
      case 'heading':
        parts.push(`<h2>${esc(section.content)}</h2>`);
        break;
      case 'subheading':
        parts.push(`<h3>${esc(section.content)}</h3>`);
        break;
      case 'text':
        // 줄바꿈을 <br>로 변환, 문단 단위로 <p> 래핑
        const paragraphs = section.content.split('\n\n');
        for (const p of paragraphs) {
          const trimmed = p.trim();
          if (trimmed) {
            parts.push(`<p>${esc(trimmed).replace(/\n/g, '<br>')}</p>`);
          }
        }
        break;
      case 'list':
        if (section.items) {
          parts.push('<ul>');
          for (const item of section.items) {
            parts.push(`  <li>${esc(item)}</li>`);
          }
          parts.push('</ul>');
        }
        break;
      case 'image':
        // 자체 블로그에서는 hero만 사용, 추가 이미지는 생략
        break;
    }
  }

  return parts.join('\n        ');
}

function buildIndex(posts) {
  const template = fs.readFileSync(
    path.join(TEMPLATE_DIR, 'index.html'),
    'utf-8',
  );

  let postsHtml = '';
  let emptyState = '';

  if (posts.length === 0) {
    emptyState =
      '<p class="text-gray-500 text-center py-12">아직 게시된 글이 없습니다.</p>';
  } else {
    postsHtml = posts
      .map((post) => {
        const pubDate = post.published_at
          ? new Date(post.published_at)
          : new Date();
        const dateStr = `${pubDate.getFullYear()}.${String(pubDate.getMonth() + 1).padStart(2, '0')}.${String(pubDate.getDate()).padStart(2, '0')}`;

        return `
      <a href="/${esc(post.slug)}/" class="block bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all overflow-hidden no-underline group">
        <div class="flex flex-col sm:flex-row">
          ${post.hero_image ? `<div class="sm:w-48 h-40 sm:h-auto overflow-hidden flex-shrink-0"><img src="${esc(post.hero_image)}" alt="${esc(post.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"></div>` : ''}
          <div class="p-4 sm:p-5 flex-1">
            <div class="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <span class="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">${esc(post.category || '가이드')}</span>
              <time>${dateStr}</time>
            </div>
            <h2 class="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors mb-2">${esc(post.title)}</h2>
            <p class="text-sm text-gray-500 line-clamp-2">${esc(post.meta_description || '')}</p>
          </div>
        </div>
      </a>`;
      })
      .join('\n');
  }

  const html = template
    .replace('{{posts_html}}', postsHtml)
    .replace('{{empty_state}}', emptyState);

  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html, 'utf-8');
  console.log('  [INDEX] index.html');
}

function buildSitemap(posts) {
  const urls = [
    '<url><loc>https://blog.zcheck.co.kr/</loc><priority>1.0</priority></url>',
  ];

  for (const post of posts) {
    const lastmod = post.published_at
      ? new Date(post.published_at).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    urls.push(
      `<url><loc>https://blog.zcheck.co.kr/${post.slug}/</loc><lastmod>${lastmod}</lastmod></url>`,
    );
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemascorp/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf-8');
  console.log('  [SITEMAP] sitemap.xml');
}

function copyDir(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function esc(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

build();
