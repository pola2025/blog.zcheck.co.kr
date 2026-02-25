/**
 * Threads 답글 연결형 발행 스크립트
 *
 * 블로그 포스트 JSON을 읽어 Threads 답글 체인으로 발행
 * - 첫 번째 포스트: 제목 + 요약 + 블로그 링크
 * - 2~N번째: 본문 핵심 포인트 (500자 제한)
 * - 마지막: CTA + 블로그 전체 링크
 *
 * 사용법: node scripts/publish-threads.js <content.json>
 * 환경변수: THREADS_ACCESS_TOKEN, THREADS_USER_ID (.env에서 로드)
 */

const fs = require('fs');
const path = require('path');

// .env 로드
const envPath = path.resolve(__dirname, '..', '..', 'zcheck-content-pipeline', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const clean = line.replace(/\r/, '');
    const match = clean.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const BASE_URL = 'https://graph.threads.net/v1.0';
const BLOG_BASE = 'https://blog.zcheck.co.kr';
const MAX_CHARS = 500;

// Threads API 래퍼
async function createContainer(userId, token, params) {
  const res = await fetch(`${BASE_URL}/${userId}/threads`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(`컨테이너 생성 실패: ${data.error.message}`);
  return data;
}

async function publishContainer(userId, token, containerId) {
  const res = await fetch(`${BASE_URL}/${userId}/threads_publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ creation_id: containerId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`게시 실패: ${data.error.message}`);
  return data;
}

async function postThread(userId, token, text, replyToId = null) {
  const params = { media_type: 'TEXT', text };
  if (replyToId) params.reply_to_id = replyToId;

  const container = await createContainer(userId, token, params);
  // 컨테이너 생성 후 짧은 대기
  await sleep(2000);
  const result = await publishContainer(userId, token, container.id);
  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 존댓말 → 반말투 변환
 * Threads 톤: 친근한 반말 (거든, 이야, 해, 돼, 봐 등)
 */
function formalToInformal(text) {
  const replacements = [
    // --- 습니다체 ---
    [/드리겠습니다/g, '줄게'],
    [/드립니다/g, '줄게'],
    [/하겠습니다/g, '할게'],
    [/필요합니다/g, '필요해'],
    [/가능합니다/g, '가능해'],
    [/어렵습니다/g, '어려워'],
    [/높습니다/g, '높아'],
    [/많습니다/g, '많아'],
    [/큽니다/g, '커'],
    [/있습니다/g, '있어'],
    [/없습니다/g, '없어'],
    [/됩니다/g, '돼'],
    [/입니다/g, '이야'],
    [/합니다/g, '해'],
    [/겠습니다/g, '을게'],
    [/습니다/g, '어'],
    // --- ~세요 ---
    [/마세요/g, '마'],
    [/하세요/g, '해'],
    [/보세요/g, '봐'],
    [/주세요/g, '줘'],
    [/두세요/g, '둬'],
    [/가세요/g, '가'],
    [/으세요/g, '어'],
    // --- 해요체 (요 ending) ---
    [/계신가요/g, '있다면'],
    [/되시나요/g, '돼'],
    [/시나요/g, '니'],
    [/신가요/g, '지'],
    [/인가요/g, '야'],
    [/을까요/g, '을까'],
    [/이에요/g, '이야'],
    [/거예요/g, '거야'],
    [/시죠/g, '지'],
    [/거든요/g, '거든'],
    [/잖아요/g, '잖아'],
    [/는데요/g, '는데'],
    [/네요/g, '네'],
    [/군요/g, '군'],
    [/있어요/g, '있어'],
    [/없어요/g, '없어'],
    [/해요/g, '해'],
    [/돼요/g, '돼'],
    [/봐요/g, '봐'],
    [/줘요/g, '줘'],
    [/워요/g, '워'],
    [/져요/g, '져'],
    [/이요/g, '이야'],
    [/예요/g, '야'],
    [/죠/g, '지'],
    [/어요/g, '어'],
    [/아요/g, '아'],
  ];
  let result = text;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 블로그 포스트 JSON → Threads 답글 체인 콘텐츠 생성
 * 각 항목이 500자 이하가 되도록 분할
 */
function buildThreadChain(post) {
  const blogUrl = `${BLOG_BASE}/${post.slug}/`;
  const chain = [];

  // 1. 첫 번째 포스트: 제목 + 요약 + 링크
  const intro = buildIntro(post, blogUrl);
  chain.push(intro);

  // 2. 본문에서 핵심 포인트 추출
  const points = extractPoints(post.body_sections || []);
  for (const point of points) {
    chain.push(point);
  }

  // 3. 마지막: CTA
  const cta = buildCta(post, blogUrl);
  chain.push(cta);

  return chain;
}

function buildIntro(post, blogUrl) {
  const title = post.title || '';
  const rawDesc = (post.meta_description || '').replace(/\.{3}$/, '');
  const desc = formalToInformal(rawDesc);

  let text = `${title}\n\n${desc}`;

  const suffix = `\n\n${blogUrl}`;
  if (text.length + suffix.length <= MAX_CHARS) {
    text += suffix;
  } else {
    const available = MAX_CHARS - title.length - 4 - suffix.length;
    const trimmedDesc = desc.substring(0, available).replace(/[,.\s]+$/, '') + '...';
    text = `${title}\n\n${trimmedDesc}${suffix}`;
  }

  return text;
}

function extractPoints(sections) {
  const points = [];
  const hasKeypoints = sections.some((s) => s.type === 'keypoints');

  // 1단계: heading+text 쌍 수집
  const headingTextPairs = [];
  let currentHeading = null;

  for (const section of sections) {
    if (section.type === 'heading') {
      currentHeading = section.content;
    } else if (section.type === 'text' && currentHeading) {
      headingTextPairs.push({
        heading: cleanHeading(currentHeading),
        text: section.content,
      });
      currentHeading = null;
    }
  }

  // 2단계: keypoints가 있으면 그걸 메인 요약으로 사용 (heading+text 개별 답글 생략)
  //         keypoints가 없으면 heading+text를 묶어서 사용
  if (hasKeypoints) {
    // keypoints 우선 → heading+text 개별 답글은 건너뜀
  } else if (headingTextPairs.length > 0) {
    // keypoints 없음 → heading+text를 묶어서 하나의 답글로 합침
    const combined = headingTextPairs
      .map((p) => {
        const keyLine = extractKeyLine(p.text);
        return `${p.heading}\n${keyLine}`;
      })
      .join('\n\n');

    // 500자 이내면 한 답글, 초과하면 2개로 분할
    if (combined.length <= MAX_CHARS) {
      points.push(combined);
    } else {
      const mid = Math.ceil(headingTextPairs.length / 2);
      const part1 = headingTextPairs.slice(0, mid)
        .map((p) => `${p.heading}\n${extractKeyLine(p.text)}`)
        .join('\n\n');
      const part2 = headingTextPairs.slice(mid)
        .map((p) => `${p.heading}\n${extractKeyLine(p.text)}`)
        .join('\n\n');
      points.push(part1.substring(0, MAX_CHARS));
      points.push(part2.substring(0, MAX_CHARS));
    }
  }

  // 3단계: callout과 keypoints 수집
  for (const section of sections) {
    if (section.type === 'callout') {
      const emoji = section.emoji || '💡';
      const calloutText = formalToInformal(
        `${emoji} ${section.title || ''}\n\n${section.content || ''}`
      );
      if (calloutText.length <= MAX_CHARS) {
        points.push(calloutText);
      }
    } else if (section.type === 'keypoints' && section.points) {
      const kpText = formalToInformal(
        section.points
          .map((p, i) => `${i + 1}. ${p.title}${p.desc ? '\n   → ' + p.desc : ''}`)
          .join('\n\n')
      );

      if (kpText.length <= MAX_CHARS) {
        points.push(kpText);
      } else {
        // 500자 초과 시 2개로 분할
        const mid = Math.ceil(section.points.length / 2);
        const part1 = formalToInformal(
          section.points.slice(0, mid)
            .map((p, i) => `${i + 1}. ${p.title}${p.desc ? '\n   → ' + p.desc : ''}`)
            .join('\n\n')
        );
        const part2 = formalToInformal(
          section.points.slice(mid)
            .map((p, i) => `${mid + i + 1}. ${p.title}${p.desc ? '\n   → ' + p.desc : ''}`)
            .join('\n\n')
        );
        points.push(part1.substring(0, MAX_CHARS));
        points.push(part2.substring(0, MAX_CHARS));
      }
    }
  }

  return points;
}

function extractKeyLine(text) {
  const lines = text.replace(/\n\n/g, '\n').split('\n').filter((l) => l.trim());

  // **볼드** 또는 ==하이라이트== 포함 줄 우선
  const emphasized = lines.find((l) => /\*\*.+?\*\*/.test(l) || /==.+?==/.test(l));
  if (emphasized) {
    const cleaned = emphasized.replace(/\*\*/g, '').replace(/==/g, '').trim();
    return formalToInformal(cleaned);
  }

  // 없으면 처음 2~3줄 합침
  const merged = lines.slice(0, 3).join('\n').replace(/\*\*/g, '').replace(/==/g, '');
  const trimmed = merged.length > 300 ? merged.substring(0, 297) + '...' : merged;
  return formalToInformal(trimmed);
}

function cleanHeading(heading) {
  return heading.replace(/^\d+[\.\)]\s*/, '').trim();
}

function buildCta(post, blogUrl) {
  const cat = (post.category || '').toLowerCase();
  const isTypeB = /피해|사기|예방/.test(cat);

  if (isTypeB) {
    return `비슷한 경험 있어?\n\n인테리어 피해사례 공유해줘.\n다른 사람들이 같은 피해 안 당하게.\n\n전체 글: ${blogUrl}`;
  }

  return `도움이 됐으면 인테리어 업체 경험도 후기로 남겨줘.\n다른 사람들 업체 고를 때 큰 도움이 되거든.\n\n전체 글: ${blogUrl}`;
}

// 메인 실행
async function main() {
  const TOKEN = process.env.THREADS_ACCESS_TOKEN;
  const USER_ID = process.env.THREADS_USER_ID;

  if (!TOKEN || !USER_ID) {
    console.error('[ERROR] 환경변수 필요: THREADS_ACCESS_TOKEN, THREADS_USER_ID');
    console.error('F:\\zcheck-content-pipeline\\.env 파일에 추가하세요.');
    console.error('');
    console.error('토큰 발급 방법은 docs/social-api-setup-guide.html 참조');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('사용법: node scripts/publish-threads.js <content.json>');
    console.log('예시:   node scripts/publish-threads.js content/remodeling-checklist-2026.json');
    process.exit(1);
  }

  const postPath = path.resolve(args[0]);
  if (!fs.existsSync(postPath)) {
    console.error(`[ERROR] 파일 없음: ${postPath}`);
    process.exit(1);
  }

  const post = JSON.parse(fs.readFileSync(postPath, 'utf-8'));
  console.log(`[THREADS] 포스트 로드: ${post.title}`);

  // --dry-run 모드: 실제 발행하지 않고 콘텐츠만 미리보기
  const dryRun = args.includes('--dry-run');

  // threads_chain 필드가 있으면 사전 작성된 반말 체인 사용
  const chain = post.threads_chain || buildThreadChain(post);
  console.log(`[THREADS] 답글 체인: ${chain.length}개 생성`);

  if (dryRun) {
    console.log('\n=== DRY RUN (미리보기) ===\n');
    chain.forEach((text, i) => {
      const label = i === 0 ? '메인 포스트' : `답글 #${i}`;
      console.log(`--- ${label} (${text.length}자) ---`);
      console.log(text);
      console.log('');
    });
    return;
  }

  // 실제 발행
  console.log('[THREADS] 메인 포스트 발행 중...');
  const mainPost = await postThread(USER_ID, TOKEN, chain[0]);
  console.log(`  [OK] 메인 포스트 ID: ${mainPost.id}`);

  let lastId = mainPost.id;
  for (let i = 1; i < chain.length; i++) {
    console.log(`[THREADS] 답글 #${i}/${chain.length - 1} 발행 중...`);
    await sleep(3000); // 답글 간 간격
    const reply = await postThread(USER_ID, TOKEN, chain[i], lastId);
    console.log(`  [OK] 답글 #${i} ID: ${reply.id}`);
    lastId = reply.id;
  }

  console.log(`\n[THREADS] 완료! ${chain.length}개 포스트 발행됨`);
  console.log(`  메인 포스트 ID: ${mainPost.id}`);

  return { mainPostId: mainPost.id, totalPosts: chain.length };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { buildThreadChain, main };
