/**
 * 콘텐츠 JSON → Airtable 동기화
 *
 * 파이프라인에서 새 글 생성 시 Airtable에도 push하여
 * 관리자 대시보드에서 수정/삭제 가능하게 함.
 *
 * 사용법:
 *   node scripts/sync-to-airtable.js <content.json>
 *   node scripts/sync-to-airtable.js --all           (content/ 전체 동기화)
 *
 * 환경변수: AIRTABLE_BASE_ID, AIRTABLE_API_KEY
 * (GOI/backend/.env에서 자동 로드)
 */

const fs = require('fs');
const path = require('path');

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
loadEnv(path.resolve(__dirname, '..', '..', 'zcheck-content-pipeline', '.env'));

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const TABLE_NAME = 'blog_posts';
const CONTENT_DIR = path.join(__dirname, '..', 'content');

function airtableUrl(recordId) {
  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_NAME}`;
  return recordId ? `${base}/${recordId}` : base;
}

const headers = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * body_sections → HTML 변환 (build.js의 buildBodyHtml 로직 재사용)
 */
function sectionsToHtml(sections) {
  const parts = [];
  for (const section of sections) {
    switch (section.type) {
      case 'heading':
        parts.push(`<h2>${esc(section.content)}</h2>`);
        break;
      case 'subheading':
        parts.push(`<h3>${esc(section.content)}</h3>`);
        break;
      case 'text': {
        const paragraphs = section.content.split('\n\n');
        for (const p of paragraphs) {
          const trimmed = p.trim();
          if (trimmed) {
            let formatted = esc(trimmed);
            formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            formatted = formatted.replace(/==(.+?)==/g, '<mark>$1</mark>');
            parts.push(`<p>${formatted.replace(/\n/g, '<br>')}</p>`);
          }
        }
        break;
      }
      case 'list':
        if (section.items) {
          parts.push('<ul>');
          for (const item of section.items) parts.push(`<li>${esc(item)}</li>`);
          parts.push('</ul>');
        }
        break;
      case 'image':
        if (section.src || section.path) {
          parts.push(`<figure><img src="${esc(section.src || section.path)}" alt="${esc(section.alt || '')}" loading="lazy"></figure>`);
        }
        break;
      case 'callout':
        parts.push(`<blockquote><strong>${section.emoji || '💡'} ${esc(section.title || '')}</strong><br>${esc(section.content || '')}</blockquote>`);
        break;
      case 'tip':
        parts.push(`<blockquote><strong>💡 ${esc(section.title || '알아두세요')}</strong><br>${esc(section.content || '')}</blockquote>`);
        break;
      case 'warning':
        parts.push(`<blockquote><strong>⚠️ ${esc(section.title || '주의')}</strong><br>${esc(section.content || '')}</blockquote>`);
        break;
      case 'checklist':
        if (section.items) {
          parts.push('<ul>');
          for (const item of section.items) parts.push(`<li>✅ ${esc(item)}</li>`);
          parts.push('</ul>');
        }
        break;
      case 'table':
        parts.push('<table>');
        if (section.headers) {
          parts.push('<thead><tr>');
          for (const h of section.headers) parts.push(`<th>${esc(h)}</th>`);
          parts.push('</tr></thead>');
        }
        if (section.rows) {
          parts.push('<tbody>');
          for (const row of section.rows) {
            parts.push('<tr>');
            for (const cell of row) parts.push(`<td>${esc(cell)}</td>`);
            parts.push('</tr>');
          }
          parts.push('</tbody>');
        }
        parts.push('</table>');
        break;
      case 'keypoints':
        if (section.points) {
          parts.push('<ul>');
          for (const pt of section.points) {
            parts.push(`<li><strong>${esc(pt.title || '')}</strong> ${esc(pt.desc || '')}</li>`);
          }
          parts.push('</ul>');
        }
        break;
    }
  }
  return parts.join('\n');
}

function esc(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * slug로 기존 레코드 찾기
 */
async function findBySlug(slug) {
  const filter = encodeURIComponent(`{slug}='${slug}'`);
  const res = await fetch(`${airtableUrl()}?filterByFormula=${filter}&maxRecords=1`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

/**
 * JSON 포스트를 Airtable에 upsert
 */
async function syncPost(post) {
  const htmlContent = sectionsToHtml(post.body_sections || []);
  const pubDate = post.published_at ? new Date(post.published_at) : new Date();
  const dateStr = `${pubDate.getFullYear()}.${String(pubDate.getMonth() + 1).padStart(2, '0')}.${String(pubDate.getDate()).padStart(2, '0')}`;

  const fields = {
    title: post.title,
    slug: post.slug,
    category: mapCategory(post.category),
    excerpt: post.meta_description || '',
    content: htmlContent,
    read_time: estimateReadTime(htmlContent),
    author: '집첵 에디터',
    tags: (post.tags || []).join(', '),
    status: post.published !== false ? 'published' : 'draft',
    published_date: dateStr,
  };

  const existing = await findBySlug(post.slug);

  if (existing) {
    // Update
    const res = await fetch(airtableUrl(existing.id), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Update 실패: ${res.status} ${await res.text()}`);
    console.log(`  [UPDATE] ${post.slug} (${existing.id})`);
  } else {
    // Create
    const res = await fetch(airtableUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Create 실패: ${res.status} ${await res.text()}`);
    console.log(`  [CREATE] ${post.slug}`);
  }
}

function mapCategory(cat) {
  if (!cat) return '정보 및 참고사항';
  if (/피해|사기|예방/.test(cat)) return '피해예방';
  return '정보 및 참고사항';
}

function estimateReadTime(html) {
  const text = html.replace(/<[^>]*>/g, '');
  const words = text.length; // 한글 기준 글자 수
  const minutes = Math.max(3, Math.ceil(words / 500));
  return `${minutes}분`;
}

async function main() {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_API_KEY) {
    console.error('[ERROR] AIRTABLE_BASE_ID, AIRTABLE_API_KEY 환경변수 필요');
    console.error('  GOI/backend/.env 또는 zipcheck_blog/.env에 설정하세요');
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const syncAll = process.argv.includes('--all');

  let files = [];

  if (syncAll) {
    // content/ 전체 동기화
    if (fs.existsSync(CONTENT_DIR)) {
      files = fs.readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(CONTENT_DIR, f));
    }
  } else if (args.length > 0) {
    files = [path.resolve(args[0])];
  } else {
    console.log('사용법:');
    console.log('  node scripts/sync-to-airtable.js <content.json>');
    console.log('  node scripts/sync-to-airtable.js --all');
    process.exit(0);
  }

  console.log(`[SYNC] ${files.length}개 파일 → Airtable 동기화`);

  for (const file of files) {
    try {
      const post = JSON.parse(fs.readFileSync(file, 'utf-8'));
      await syncPost(post);
    } catch (e) {
      console.error(`  [ERROR] ${path.basename(file)}: ${e.message}`);
    }
  }

  console.log('[SYNC] 완료');
}

module.exports = { syncPost, main };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  });
}
