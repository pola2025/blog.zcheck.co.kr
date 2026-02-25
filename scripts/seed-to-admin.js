/**
 * zipcheck_blog content/*.json → GOI 관리자 API를 통해 Airtable에 시드
 *
 * Workers API를 사용하므로 Airtable PAT 불필요 (Workers secrets 사용)
 *
 * 사용법: node scripts/seed-to-admin.js
 * 환경변수: ADMIN_TOKEN (GOI 관리자 JWT)
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const API_BASE = process.env.BLOG_API_URL || 'https://zipcheck-api.zipcheck2025.workers.dev';

// .env 로드
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const clean = line.replace(/\r/, '');
    const match = clean.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}
loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.resolve(__dirname, '..', '..', 'GOI', 'backend', '.env'));

/**
 * body_sections → HTML
 */
function sectionsToHtml(sections) {
  const parts = [];
  for (const s of sections) {
    switch (s.type) {
      case 'heading':
        parts.push(`<h2>${esc(s.content)}</h2>`);
        break;
      case 'subheading':
        parts.push(`<h3>${esc(s.content)}</h3>`);
        break;
      case 'text': {
        for (const p of s.content.split('\n\n')) {
          const t = p.trim();
          if (t) {
            let f = esc(t);
            f = f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            f = f.replace(/==(.+?)==/g, '<mark>$1</mark>');
            parts.push(`<p>${f.replace(/\n/g, '<br>')}</p>`);
          }
        }
        break;
      }
      case 'list':
        if (s.items) {
          parts.push('<ul>' + s.items.map(i => `<li>${esc(i)}</li>`).join('') + '</ul>');
        }
        break;
      case 'image':
        if (s.src) parts.push(`<figure><img src="${esc(s.src)}" alt="${esc(s.alt || '')}" loading="lazy"></figure>`);
        break;
      case 'callout':
        parts.push(`<blockquote><strong>${s.emoji || '💡'} ${esc(s.title || '')}</strong><br>${esc(s.content || '')}</blockquote>`);
        break;
      case 'tip':
        parts.push(`<blockquote><strong>💡 ${esc(s.title || '알아두세요')}</strong><br>${esc(s.content || '')}</blockquote>`);
        break;
      case 'warning':
        parts.push(`<blockquote><strong>⚠️ ${esc(s.title || '주의')}</strong><br>${esc(s.content || '')}</blockquote>`);
        break;
      case 'checklist':
        if (s.items) {
          parts.push('<ul>' + s.items.map(i => `<li>✅ ${esc(i)}</li>`).join('') + '</ul>');
        }
        break;
      case 'table':
        parts.push('<table>');
        if (s.headers) parts.push('<thead><tr>' + s.headers.map(h => `<th>${esc(h)}</th>`).join('') + '</tr></thead>');
        if (s.rows) {
          parts.push('<tbody>');
          for (const row of s.rows) parts.push('<tr>' + row.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>');
          parts.push('</tbody>');
        }
        parts.push('</table>');
        break;
      case 'keypoints':
        if (s.points) {
          parts.push('<ul>' + s.points.map(pt => `<li><strong>${esc(pt.title || '')}</strong> ${esc(pt.desc || '')}</li>`).join('') + '</ul>');
        }
        break;
    }
  }
  return parts.join('\n');
}

function esc(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mapCategory(cat) {
  if (/피해|사기|예방/.test(cat || '')) return '피해예방';
  return '정보 및 참고사항';
}

async function getAdminToken() {
  // 환경변수에서 가져오기
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;

  // 없으면 로그인으로 획득
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('[ERROR] ADMIN_TOKEN 또는 ADMIN_PASSWORD 환경변수 필요');
    process.exit(1);
  }

  const res = await fetch(`${API_BASE}/api/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    console.error(`[ERROR] 관리자 로그인 실패: ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  return data.token;
}

async function main() {
  const token = await getAdminToken();
  console.log('[SEED] 관리자 토큰 획득 완료');

  // content/*.json 로드
  const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith('.json'));
  console.log(`[SEED] ${files.length}개 JSON 파일 발견\n`);

  let created = 0, skipped = 0, failed = 0;

  for (const file of files) {
    const post = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'));
    if (post.published === false) { skipped++; continue; }

    const htmlContent = sectionsToHtml(post.body_sections || []);
    const pubDate = post.published_at ? new Date(post.published_at) : new Date();
    const dateStr = `${pubDate.getFullYear()}.${String(pubDate.getMonth() + 1).padStart(2, '0')}.${String(pubDate.getDate()).padStart(2, '0')}`;

    const payload = {
      title: post.title,
      slug: post.slug,
      category: mapCategory(post.category),
      excerpt: post.meta_description || '',
      content: htmlContent,
      read_time: `${Math.max(3, Math.ceil(htmlContent.replace(/<[^>]*>/g, '').length / 500))}분`,
      author: '집첵 에디터',
      tags: (post.tags || []).join(', '),
      status: 'published',
      published_date: dateStr,
    };

    try {
      // 먼저 slug로 기존 글 확인 (공개 API)
      const checkRes = await fetch(`${API_BASE}/api/blog/posts/${post.slug}`);
      if (checkRes.ok) {
        console.log(`  [SKIP] ${post.slug} — 이미 존재`);
        skipped++;
        continue;
      }

      // 생성
      const res = await fetch(`${API_BASE}/api/admin/blog/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        console.log(`  [OK] ${post.slug}`);
        created++;
      } else {
        const err = await res.text();
        console.error(`  [FAIL] ${post.slug}: ${res.status} ${err}`);
        failed++;
      }
    } catch (e) {
      console.error(`  [ERROR] ${post.slug}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[SEED] 완료: 생성 ${created} / 스킵 ${skipped} / 실패 ${failed}`);
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
