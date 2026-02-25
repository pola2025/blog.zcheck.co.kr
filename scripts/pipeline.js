/**
 * ZCheck 콘텐츠 파이프라인 오케스트레이터
 *
 * 하나의 콘텐츠 JSON으로 4개 플랫폼 순차 발행:
 *   1. 블로그 빌드 (blog.zcheck.co.kr)
 *   2. Vercel 배포
 *   3. Instagram 발행 (이미지 + 캡션)
 *   4. Threads 발행 (텍스트 답글 체인)
 *
 * 사용법:
 *   node scripts/pipeline.js <content.json> [--skip-build] [--skip-deploy] [--dry-run]
 *
 * 옵션:
 *   --skip-build   빌드 단계 건너뛰기 (이미 빌드된 경우)
 *   --skip-deploy  배포 단계 건너뛰기 (이미 배포된 경우)
 *   --dry-run      실제 발행 없이 콘텐츠 미리보기
 *   --threads-only Threads만 발행
 *   --ig-only      Instagram만 발행
 */

const { execSync } = require("child_process");
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

const PROJECT_DIR = path.resolve(__dirname, "..");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  try {
    execSync(cmd, {
      cwd: opts.cwd || PROJECT_DIR,
      stdio: "inherit",
      timeout: opts.timeout || 120000,
    });
    return true;
  } catch (e) {
    console.error(`  [FAIL] 명령 실패: ${cmd}`);
    return false;
  }
}

function checkEnvVars() {
  const status = {
    threads: !!(
      process.env.THREADS_ACCESS_TOKEN && process.env.THREADS_USER_ID
    ),
    instagram: !!(process.env.IG_ACCESS_TOKEN && process.env.IG_USER_ID),
    telegram: !!(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
    ),
  };
  return status;
}

async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.error(`  [WARN] 텔레그램 알림 실패: ${e.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));

  if (args.length === 0) {
    console.log("ZCheck 콘텐츠 파이프라인 오케스트레이터");
    console.log("");
    console.log("사용법: node scripts/pipeline.js <content.json> [옵션]");
    console.log("");
    console.log("옵션:");
    console.log("  --skip-build    빌드 단계 건너뛰기");
    console.log("  --skip-deploy   배포 단계 건너뛰기");
    console.log("  --dry-run       실제 발행 없이 미리보기");
    console.log("  --threads-only  Threads만 발행");
    console.log("  --ig-only       Instagram만 발행");
    console.log("");
    console.log("예시:");
    console.log(
      "  node scripts/pipeline.js content/remodeling-checklist-2026.json",
    );
    console.log(
      "  node scripts/pipeline.js content/remodeling-checklist-2026.json --dry-run",
    );
    console.log(
      "  node scripts/pipeline.js content/remodeling-checklist-2026.json --threads-only --skip-build",
    );
    process.exit(0);
  }

  const skipBuild = flags.includes("--skip-build");
  const skipDeploy = flags.includes("--skip-deploy");
  const dryRun = flags.includes("--dry-run");
  const threadsOnly = flags.includes("--threads-only");
  const igOnly = flags.includes("--ig-only");

  const contentPath = path.resolve(args[0]);
  if (!fs.existsSync(contentPath)) {
    console.error(`[ERROR] 파일 없음: ${contentPath}`);
    process.exit(1);
  }

  const post = JSON.parse(fs.readFileSync(contentPath, "utf-8"));

  // SEO 리라이팅: blog_content_path가 있으면 자체 블로그용 리라이팅 콘텐츠 사용
  let blogPost = post;
  if (post.blog_content_path && post.seo_rewrite) {
    const blogContentPath = path.resolve(post.blog_content_path);
    if (fs.existsSync(blogContentPath)) {
      blogPost = JSON.parse(fs.readFileSync(blogContentPath, "utf-8"));
      console.log(
        `[SEO] 자체 블로그용 리라이팅 콘텐츠 로드: ${blogContentPath}`,
      );
    } else {
      console.log(`[SEO] 리라이팅 콘텐츠 없음, 원본 사용: ${blogContentPath}`);
    }
  }

  console.log("========================================");
  console.log(" ZCheck 콘텐츠 파이프라인");
  console.log("========================================");
  console.log(`콘텐츠: ${post.title}`);
  console.log(`슬러그: ${post.slug}`);
  console.log(`카테고리: ${post.category || "미지정"}`);
  if (post.seo_rewrite) console.log(`[SEO 리라이팅: ON]`);
  if (dryRun) console.log("[모드: DRY RUN - 실제 발행 없음]");
  console.log("");

  // 환경변수 상태 확인
  const env = checkEnvVars();
  console.log("[환경변수 상태]");
  console.log(`  Threads API:   ${env.threads ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log(`  Instagram API: ${env.instagram ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log(`  Telegram:      ${env.telegram ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log("");

  const results = {
    airtable: null,
    build: null,
    deploy: null,
    instagram: null,
    threads: null,
  };

  // Step 0: Airtable 동기화 (관리자 대시보드에서 관리 가능하도록)
  if (!dryRun && !threadsOnly && !igOnly) {
    console.log("[0/4] Airtable 동기화...");
    try {
      const { syncPost } = require("./sync-to-airtable.js");
      await syncPost(post);
      results.airtable = "success";
      console.log("");
    } catch (e) {
      console.error(`  [WARN] Airtable 동기화 실패 (계속 진행): ${e.message}`);
      results.airtable = "failed";
      console.log("");
    }
  }

  // Step 1: 블로그 빌드 (deploy.js 내부에서 실행 → 여기서는 SKIP)
  // deploy.js가 build.js를 포함하므로 이중 실행 방지
  console.log("[1/4] 블로그 빌드... deploy.js에 위임");
  results.build = "delegated";
  console.log("");

  // Step 2: Vercel 배포
  if (!skipDeploy && !dryRun && !threadsOnly && !igOnly) {
    console.log("[2/4] Vercel 배포...");
    const ok = run("node scripts/deploy.js");
    results.deploy = ok ? "success" : "failed";
    if (!ok) {
      console.error(
        "[WARN] 배포 실패. 소셜 미디어 발행은 이미지 URL이 필요하므로 주의.",
      );
    } else {
      // 배포 후 CDN 캐시 반영 대기
      console.log("  [대기] CDN 반영 대기 (15초)...");
      await new Promise((r) => setTimeout(r, 15000));
    }
    console.log("");
  } else {
    console.log("[2/4] Vercel 배포... SKIP");
    results.deploy = "skipped";
    console.log("");
  }

  // Step 3: Instagram 발행
  if (!threadsOnly) {
    console.log("[3/4] Instagram 발행...");
    if (!env.instagram) {
      console.log("  [SKIP] IG_ACCESS_TOKEN / IG_USER_ID 미설정");
      results.instagram = "skipped";
    } else {
      try {
        const igArgs = [contentPath];
        if (dryRun) igArgs.push("--dry-run");
        const { main: igMain } = require("./publish-instagram.js");
        // publish-instagram의 main은 process.argv를 사용하므로 직접 호출
        process.argv = ["node", "publish-instagram.js", ...igArgs];
        await igMain();
        results.instagram = "success";
      } catch (e) {
        console.error(`  [ERROR] Instagram 발행 실패: ${e.message}`);
        results.instagram = "failed";
      }
    }
    console.log("");
  } else {
    console.log("[3/4] Instagram 발행... SKIP (--threads-only)");
    results.instagram = "skipped";
    console.log("");
  }

  // Step 4: Threads 발행
  if (!igOnly) {
    console.log("[4/4] Threads 발행...");
    if (!env.threads) {
      console.log("  [SKIP] THREADS_ACCESS_TOKEN / THREADS_USER_ID 미설정");
      results.threads = "skipped";
    } else {
      try {
        const thArgs = [contentPath];
        if (dryRun) thArgs.push("--dry-run");
        process.argv = ["node", "publish-threads.js", ...thArgs];
        const { main: thMain } = require("./publish-threads.js");
        await thMain();
        results.threads = "success";
      } catch (e) {
        console.error(`  [ERROR] Threads 발행 실패: ${e.message}`);
        results.threads = "failed";
      }
    }
    console.log("");
  } else {
    console.log("[4/4] Threads 발행... SKIP (--ig-only)");
    results.threads = "skipped";
    console.log("");
  }

  // 결과 요약
  console.log("========================================");
  console.log(" 파이프라인 결과");
  console.log("========================================");
  const statusEmoji = (s) =>
    s === "success"
      ? "✅"
      : s === "failed"
        ? "❌"
        : s === "skipped"
          ? "⏭️"
          : "❓";
  console.log(
    `  Airtable:  ${statusEmoji(results.airtable)} ${results.airtable || "skipped"}`,
  );
  console.log(`  빌드:      ${statusEmoji(results.build)} ${results.build}`);
  console.log(`  배포:      ${statusEmoji(results.deploy)} ${results.deploy}`);
  console.log(
    `  Instagram: ${statusEmoji(results.instagram)} ${results.instagram}`,
  );
  console.log(
    `  Threads:   ${statusEmoji(results.threads)} ${results.threads}`,
  );
  console.log("");

  // 텔레그램 알림
  if (!dryRun && env.telegram) {
    const blogUrl = `https://blog.zcheck.co.kr/${post.slug}/`;
    const msg =
      `<b>콘텐츠 파이프라인 완료</b>\n\n` +
      `<b>${post.title}</b>\n` +
      `${blogUrl}\n\n` +
      `빌드: ${statusEmoji(results.build)} | 배포: ${statusEmoji(results.deploy)}\n` +
      `Instagram: ${statusEmoji(results.instagram)} | Threads: ${statusEmoji(results.threads)}`;
    await sendTelegramNotification(msg);
    console.log("[알림] 텔레그램 알림 전송됨");
  }
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
