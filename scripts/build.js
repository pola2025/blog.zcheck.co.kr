/**
 * ZCheck Blog 빌드 스크립트
 * 소스: Airtable (primary) + content/*.json (fallback)
 * 출력: dist/{slug}/index.html
 *
 * 사용법: node scripts/build.js [--local-only]
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// GOI 백엔드 API (Airtable 프록시)
const API_BASE = process.env.BLOG_API_URL || 'https://zipcheck-api.zipcheck2025.workers.dev';

async function build() {
  console.log('[BUILD] 시작...');
  const localOnly = process.argv.includes('--local-only');

  // dist 초기화
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // public 복사
  if (fs.existsSync(PUBLIC_DIR)) {
    copyDir(PUBLIC_DIR, DIST_DIR);
  }

  // 콘텐츠 로드: API + 로컬 JSON 병합
  const localPosts = loadLocalPosts();
  let apiPosts = [];
  if (!localOnly) {
    apiPosts = await loadApiPosts();
  }
  const posts = mergePosts(localPosts, apiPosts);
  console.log(`[BUILD] ${posts.length}개 포스트 (로컬: ${localPosts.length}, API: ${apiPosts.length})`);

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

function loadLocalPosts() {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  const posts = [];

  for (const file of files) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'),
      );
      if (data.published !== false) {
        data._source = 'local';
        posts.push(data);
      }
    } catch (e) {
      console.error(`[BUILD] JSON 파싱 실패: ${file} — ${e.message}`);
    }
  }

  posts.sort(
    (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
  );
  return posts;
}

/**
 * GOI 공개 API에서 published 포스트를 가져와 빌드 포맷으로 변환
 */
async function loadApiPosts() {
  console.log(`[BUILD] API에서 포스트 로드 중... (${API_BASE})`);
  const posts = [];

  try {
    const res = await fetch(`${API_BASE}/api/blog/posts`);
    if (!res.ok) {
      console.error(`[BUILD] API 응답 오류: ${res.status}`);
      return posts;
    }
    const data = await res.json();
    for (const p of data.posts || []) {
      if (!p.slug || !p.title) continue;
      posts.push({
        slug: p.slug,
        title: p.title,
        meta_description: p.excerpt || '',
        category: p.category || '인테리어',
        tags: p.tags ? p.tags.split(',').map((t) => t.trim()) : (p.tags_array || []),
        published_at: p.published_date
          ? new Date(p.published_date.replace(/\./g, '-')).toISOString()
          : new Date().toISOString(),
        published: true,
        _html_content: p.content || '',
        _source: 'api',
        hero_image: p.thumbnail_url || '',
        body_sections: [],
      });
    }
    console.log(`[BUILD] API: ${posts.length}개 포스트 로드`);
  } catch (e) {
    console.error(`[BUILD] API 로드 실패: ${e.message}`);
  }
  return posts;
}

/**
 * 로컬 + Airtable 포스트 병합
 * 같은 slug가 있으면 로컬 JSON 우선 (body_sections가 더 풍부)
 * Airtable에만 있는 포스트는 그대로 추가
 */
function mergePosts(localPosts, apiPosts) {
  const slugMap = new Map();

  // 로컬 포스트 먼저 (body_sections가 더 풍부하므로 우선순위 높음)
  for (const post of localPosts) {
    slugMap.set(post.slug, post);
  }

  // API-only 포스트 추가 (로컬에 없는 것만)
  for (const post of apiPosts) {
    if (!slugMap.has(post.slug)) {
      slugMap.set(post.slug, post);
    }
  }

  const merged = Array.from(slugMap.values());
  merged.sort(
    (a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0),
  );
  return merged;
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

  // 본문 내 이미지 복사
  const imgDir = path.join(DIST_DIR, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  for (const section of post.body_sections || []) {
    const localPath = section.local_path || section.path;
    if (section.type === 'image' && localPath) {
      const src = path.resolve(localPath);
      if (fs.existsSync(src)) {
        const ext = path.extname(src);
        const imgName = `${slug}-${path.basename(src, ext)}${ext}`;
        const dest = path.join(imgDir, imgName);
        fs.copyFileSync(src, dest);
        section.src = `/images/${imgName}`;
      }
    }
  }

  // 본문 HTML 생성: Airtable 포스트는 _html_content 사용, 로컬은 body_sections 변환
  const bodyHtml = post._html_content
    ? post._html_content
    : buildBodyHtml(post.body_sections || []);

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
    '{{cta_primary}}': buildCtaPrimary(post.category, slug),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(key, value);
  }

  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
  console.log(`  [POST] ${slug}/index.html`);
}

function formatInline(text) {
  // HTML 이스케이프 먼저 적용
  let result = esc(text);
  // **볼드** → <strong>
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // ==하이라이트== → <mark>
  result = result.replace(/==(.+?)==/g, '<mark>$1</mark>');
  return result;
}

function buildBodyHtml(sections) {
  const parts = [];

  for (const section of sections) {
    switch (section.type) {
      case 'heading':
        parts.push(`<h2>${formatInline(section.content)}</h2>`);
        break;
      case 'subheading':
        parts.push(`<h3>${formatInline(section.content)}</h3>`);
        break;
      case 'text':
        // 줄바꿈을 <br>로 변환, 문단 단위로 <p> 래핑
        const paragraphs = section.content.split('\n\n');
        for (const p of paragraphs) {
          const trimmed = p.trim();
          if (trimmed) {
            parts.push(`<p>${formatInline(trimmed).replace(/\n/g, '<br>')}</p>`);
          }
        }
        break;
      case 'list':
        if (section.items) {
          parts.push('<ul>');
          for (const item of section.items) {
            parts.push(`  <li>${formatInline(item)}</li>`);
          }
          parts.push('</ul>');
        }
        break;
      case 'image':
        if (section.src) {
          const alt = esc(section.alt || section.caption || '');
          parts.push(`<figure>`);
          parts.push(`  <img src="${esc(section.src)}" alt="${alt}" loading="lazy">`);
          if (section.caption) {
            parts.push(`  <figcaption class="text-center text-sm text-gray-500 mt-2">${esc(section.caption)}</figcaption>`);
          }
          parts.push(`</figure>`);
        }
        break;
      case 'checklist':
        parts.push('<div class="zc-checklist">');
        if (section.title) {
          parts.push(`  <div class="zc-checklist-title">✅ ${esc(section.title)}</div>`);
        }
        if (section.items) {
          parts.push('  <ul>');
          for (const item of section.items) {
            parts.push(`    <li>${esc(item)}</li>`);
          }
          parts.push('  </ul>');
        }
        parts.push('</div>');
        break;
      case 'tip':
        parts.push('<div class="zc-tip">');
        parts.push(`  <div class="zc-tip-title">💡 ${esc(section.title || '알아두세요')}</div>`);
        parts.push(`  <p>${esc(section.content || '').replace(/\n/g, '<br>')}</p>`);
        parts.push('</div>');
        break;
      case 'warning':
        parts.push('<div class="zc-warning">');
        parts.push(`  <div class="zc-warning-title">⚠️ ${esc(section.title || '주의')}</div>`);
        parts.push(`  <p>${esc(section.content || '').replace(/\n/g, '<br>')}</p>`);
        parts.push('</div>');
        break;
      case 'step':
        parts.push('<div class="zc-steps">');
        if (section.steps) {
          for (let i = 0; i < section.steps.length; i++) {
            const step = section.steps[i];
            parts.push('<div class="zc-step">');
            parts.push(`  <div class="zc-step-num">${i + 1}</div>`);
            parts.push('  <div class="zc-step-body">');
            if (step.title) parts.push(`    <strong>${esc(step.title)}</strong>`);
            if (step.content) parts.push(`    <p>${esc(step.content).replace(/\n/g, '<br>')}</p>`);
            parts.push('  </div>');
            parts.push('</div>');
          }
        }
        parts.push('</div>');
        break;
      case 'highlight':
        parts.push('<div class="zc-highlight">');
        parts.push(`  <p>${esc(section.content || '').replace(/\n/g, '<br>')}</p>`);
        parts.push('</div>');
        break;
      case 'table':
        parts.push('<div class="zc-table">');
        parts.push('<table>');
        if (section.headers) {
          parts.push('<thead><tr>');
          for (const h of section.headers) {
            parts.push(`  <th>${esc(h)}</th>`);
          }
          parts.push('</tr></thead>');
        }
        if (section.rows) {
          parts.push('<tbody>');
          for (const row of section.rows) {
            parts.push('<tr>');
            for (const cell of row) {
              parts.push(`  <td>${esc(cell)}</td>`);
            }
            parts.push('</tr>');
          }
          parts.push('</tbody>');
        }
        parts.push('</table>');
        parts.push('</div>');
        break;
      case 'keypoints':
        parts.push('<div class="zc-keypoints">');
        parts.push('  <div class="zc-keypoints-header">');
        parts.push('    <div class="zc-keypoints-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>');
        parts.push(`    <span class="zc-keypoints-label">${esc(section.title || '핵심 포인트 요약')}</span>`);
        parts.push('  </div>');
        if (section.points) {
          parts.push('  <div class="zc-keypoints-grid">');
          for (let i = 0; i < section.points.length; i++) {
            const pt = section.points[i];
            parts.push('    <div class="zc-keypoint-card">');
            parts.push(`      <div class="zc-keypoint-num">${i + 1}</div>`);
            parts.push('      <div class="zc-keypoint-body">');
            parts.push(`        <strong>${formatInline(pt.title || '')}</strong>`);
            if (pt.desc) parts.push(`        <span>${formatInline(pt.desc)}</span>`);
            parts.push('      </div>');
            parts.push('    </div>');
          }
          parts.push('  </div>');
        }
        parts.push('</div>');
        break;
      case 'callout':
        parts.push('<div class="zc-callout">');
        parts.push('  <div class="zc-callout-accent"></div>');
        parts.push('  <div class="zc-callout-inner">');
        parts.push(`    <div class="zc-callout-emoji">${section.emoji || '💡'}</div>`);
        parts.push('    <div class="zc-callout-content">');
        if (section.title) parts.push(`      <strong>${formatInline(section.title)}</strong>`);
        if (section.content) parts.push(`      <p>${formatInline(section.content).replace(/\n/g, '<br>')}</p>`);
        parts.push('    </div>');
        parts.push('  </div>');
        parts.push('</div>');
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
      <a href="/${esc(post.slug)}/" class="block bg-white rounded-xl border border-gray-200 hover:border-brand-200 hover:shadow-lg transition-all overflow-hidden no-underline group" data-slug="${esc(post.slug)}">
        ${post.hero_image ? `<div class="aspect-video overflow-hidden"><img src="${esc(post.hero_image)}" alt="${esc(post.title)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy"></div>` : '<div class="aspect-video bg-gray-100 flex items-center justify-center"><svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>'}
        <div class="p-4">
          <div class="flex items-center gap-2 text-xs text-gray-500 mb-2.5">
            <span class="bg-brand-50 text-brand-500 px-2 py-0.5 rounded-full font-medium">${esc(post.category || '가이드')}</span>
            <time>${dateStr}</time>
            <span class="ml-auto flex items-center gap-1 text-gray-400"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg><span class="zc-views-count">&middot;</span></span>
          </div>
          <h2 class="text-base font-bold text-gray-900 group-hover:text-brand-500 transition-colors mb-2 line-clamp-2 leading-snug">${esc(post.title)}</h2>
          <p class="text-sm text-gray-500 line-clamp-2 leading-relaxed">${esc(post.meta_description || '')}</p>
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf-8');
  console.log('  [SITEMAP] sitemap.xml');
}

/**
 * 카테고리에 따라 다른 CTA HTML 생성
 * - Type A (가이드/견적 등): 업체후기 CTA → zcheck.co.kr/reviews
 * - Type B (피해/사기/예방): 피해사례 CTA → report.zcheck.co.kr
 */
function buildCtaPrimary(category, slug) {
  const cat = (category || '').toLowerCase();
  const isTypeB = /피해|사기|예방/.test(cat);

  if (isTypeB) {
    return `<div class="mt-12 bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-200 rounded-2xl p-5 md:p-8">
        <div class="text-center">
          <div class="w-12 h-12 md:w-14 md:h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg class="w-6 h-6 md:w-7 md:h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <h3 class="text-base md:text-lg font-bold text-gray-900 mb-2" style="text-wrap:balance;word-break:keep-all">비슷한 피해를 경험하셨나요?</h3>
          <p class="text-gray-600 text-sm mb-4 leading-relaxed mx-auto px-2" style="text-wrap:pretty;word-break:keep-all">
            인테리어 피해사례를 공유해 주시면<br>다른 분들이 같은 피해를 예방할 수 있습니다.
          </p>
          <a href="https://report.zcheck.co.kr?utm_source=blog&utm_medium=cta&utm_campaign=${esc(slug)}"
             target="_blank" rel="noopener"
             class="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors no-underline text-sm">
            피해사례 공유하기
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </a>
        </div>
      </div>`;
  }

  // Type A (기본): 업체후기 CTA
  return `<div class="mt-12 bg-gradient-to-br from-brand-50 to-teal-50 border-2 border-brand-200 rounded-2xl p-5 md:p-8">
        <div class="text-center">
          <div class="w-12 h-12 md:w-14 md:h-14 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg class="w-6 h-6 md:w-7 md:h-7 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </div>
          <h3 class="text-base md:text-lg font-bold text-gray-900 mb-2" style="text-wrap:balance;word-break:keep-all">인테리어 업체 중 만족스러운 곳이 있었나요?</h3>
          <p class="text-gray-600 text-sm mb-4 leading-relaxed mx-auto px-2" style="text-wrap:pretty;word-break:keep-all">
            집첵 업체후기 게시판에 경험을 남겨주세요.
            다른 분들의 업체 선택에 큰 도움이 됩니다.
          </p>
          <a href="https://zcheck.co.kr/reviews?utm_source=blog&utm_medium=cta&utm_campaign=${esc(slug)}"
             target="_blank" rel="noopener"
             class="inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors no-underline text-sm">
            업체 후기 남기기
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </a>
        </div>
      </div>`;
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

build().catch((err) => {
  console.error(`[BUILD] 빌드 실패: ${err.message}`);
  process.exit(1);
});
