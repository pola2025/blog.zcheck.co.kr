/**
 * 소셜 미디어 예약 발행 스케줄러
 *
 * instagram-final.json / threads-final.json을 읽어
 * Windows Task Scheduler에 예약 작업을 등록합니다.
 *
 * 사용법:
 *   node scripts/schedule-social.js              # 전체 등록
 *   node scripts/schedule-social.js --list        # 등록된 작업 확인
 *   node scripts/schedule-social.js --remove      # 등록된 작업 삭제
 *   node scripts/schedule-social.js --dry-run     # 미리보기
 *
 * 각 예약 작업은 지정된 날짜/시간에 publish-scheduled.js를 실행합니다.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_DIR = path.resolve(__dirname, '..', '..', 'zcheck-content-pipeline');
const BLOG_DIR = path.resolve(__dirname, '..');
const IG_FINAL = path.join(PIPELINE_DIR, 'content', 'social', 'instagram-final.json');
const TH_FINAL = path.join(PIPELINE_DIR, 'content', 'social', 'threads-final.json');
const SCHEDULE_DIR = path.join(BLOG_DIR, 'schedule');
const TASK_PREFIX = 'ZCheck_Social_';

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    listTasks();
    return;
  }
  if (args.includes('--remove')) {
    removeTasks();
    return;
  }

  const dryRun = args.includes('--dry-run');

  // 1. instagram-final.json + threads-final.json 로드
  const igPosts = JSON.parse(fs.readFileSync(IG_FINAL, 'utf-8')).posts;
  const thPosts = JSON.parse(fs.readFileSync(TH_FINAL, 'utf-8')).posts;

  console.log(`[스케줄러] IG ${igPosts.length}건, Threads ${thPosts.length}건 로드\n`);

  // 2. schedule/ 디렉토리에 개별 발행 JSON 생성
  if (!fs.existsSync(SCHEDULE_DIR)) {
    fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
  }

  for (let i = 0; i < igPosts.length; i++) {
    const ig = igPosts[i];
    const th = thPosts.find((t) => t.slug === ig.slug) || thPosts[i];
    const scheduleDate = ig.schedule_date; // "2026-02-11 09:00"

    // 발행용 JSON 생성: IG 캡션 + Threads 체인 + 이미지 URL
    const publishData = {
      slug: ig.slug,
      title: ig.slug,
      schedule_date: scheduleDate,
      hero_image: `/images/${ig.slug}.png`,
      instagram_caption: ig.caption,
      threads_chain: th.chain.map((c) => c.text),
    };

    const jsonPath = path.join(SCHEDULE_DIR, `${ig.slug}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(publishData, null, 2), 'utf-8');

    // 날짜/시간 파싱
    const [datePart, timePart] = scheduleDate.split(' ');
    const taskName = `${TASK_PREFIX}${ig.slug}`;
    const publishScript = path.join(BLOG_DIR, 'scripts', 'publish-scheduled.js');
    const nodeExe = process.execPath;

    console.log(`[${i + 1}/${igPosts.length}] ${ig.slug}`);
    console.log(`  일정: ${scheduleDate}`);
    console.log(`  JSON: ${jsonPath}`);

    if (dryRun) {
      console.log(`  [DRY RUN] schtasks 등록 생략\n`);
      continue;
    }

    // Windows Task Scheduler 등록
    // /SC ONCE: 1회 실행, /ST 시간, /SD 날짜
    const schDate = datePart.replace(/-/g, '/'); // 2026/02/11
    const cmd = `schtasks /Create /TN "${taskName}" /TR "\\"${nodeExe}\\" \\"${publishScript}\\" \\"${jsonPath}\\"" /SC ONCE /SD ${schDate} /ST ${timePart} /F`;

    try {
      execSync(cmd, { stdio: 'pipe' });
      console.log(`  [OK] 예약 등록 완료: ${taskName}\n`);
    } catch (e) {
      console.error(`  [ERROR] 예약 등록 실패: ${e.message}\n`);
    }
  }

  console.log('========================================');
  console.log(`총 ${igPosts.length}건 예약 ${dryRun ? '미리보기' : '등록'} 완료`);
  console.log('예약 확인: node scripts/schedule-social.js --list');
  console.log('예약 삭제: node scripts/schedule-social.js --remove');
}

function listTasks() {
  console.log('[스케줄러] 등록된 ZCheck 소셜 예약 작업:\n');
  try {
    const output = execSync(`schtasks /Query /FO LIST /V /TN "${TASK_PREFIX}*"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(output);
  } catch (e) {
    // schtasks에서 못 찾으면 각각 조회
    const igPosts = JSON.parse(fs.readFileSync(IG_FINAL, 'utf-8')).posts;
    let found = 0;
    for (const post of igPosts) {
      const taskName = `${TASK_PREFIX}${post.slug}`;
      try {
        const out = execSync(`schtasks /Query /TN "${taskName}" /FO LIST /V`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        console.log(out);
        found++;
      } catch {
        // 해당 작업 없음
      }
    }
    if (found === 0) {
      console.log('등록된 예약 작업이 없습니다.');
    }
  }
}

function removeTasks() {
  console.log('[스케줄러] ZCheck 소셜 예약 작업 삭제 중...\n');
  const igPosts = JSON.parse(fs.readFileSync(IG_FINAL, 'utf-8')).posts;
  for (const post of igPosts) {
    const taskName = `${TASK_PREFIX}${post.slug}`;
    try {
      execSync(`schtasks /Delete /TN "${taskName}" /F`, { stdio: 'pipe' });
      console.log(`  [OK] 삭제: ${taskName}`);
    } catch {
      console.log(`  [SKIP] 없음: ${taskName}`);
    }
  }
  console.log('\n삭제 완료.');
}

main();
