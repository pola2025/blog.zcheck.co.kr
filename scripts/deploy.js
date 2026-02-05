/**
 * Cloudflare Pages 배포 스크립트
 *
 * 사용법: node scripts/deploy.js
 *
 * 1. build.js 실행
 * 2. wrangler pages deploy dist/
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function deploy() {
  console.log('[DEPLOY] 빌드 시작...');
  execSync('node scripts/build.js', { cwd: ROOT, stdio: 'inherit' });

  console.log('\n[DEPLOY] Cloudflare Pages 배포...');
  try {
    execSync(
      `npx wrangler pages deploy "${DIST}" --project-name=zcheck-blog --branch=main`,
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID:
            process.env.CLOUDFLARE_ACCOUNT_ID || '84c47a81c611371cb85cbc90d1e9abb4',
        },
      },
    );
    console.log('\n[DEPLOY] 배포 완료!');
    console.log('  URL: https://blog.zcheck.co.kr');
  } catch (e) {
    console.error('[DEPLOY] 배포 실패:', e.message);
    process.exit(1);
  }
}

deploy();
