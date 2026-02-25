/**
 * Vercel 배포 스크립트
 *
 * 사용법: node scripts/deploy.js
 *
 * 1. build.js 실행 (dist/ 생성)
 * 2. dist/ 내부에서 vercel deploy --prod
 *
 * 환경변수: VERCEL_TOKEN (또는 F:\GOI\.env에서 참조)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || 'sXCm9dVqTSDq8P9AVRnBJtDw';

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function deploy() {
  console.log('[DEPLOY] 빌드 시작...');
  execSync('node scripts/build.js', { cwd: ROOT, stdio: 'inherit' });

  // dist/에 vercel.json 복사 (cron 설정 포함)
  const vercelConfig = {
    cleanUrls: true,
    trailingSlash: false,
    buildCommand: '',
    installCommand: '',
    outputDirectory: '.',
    crons: [
      {
        path: '/api/cron/publish-social',
        schedule: '0 0 * * *',
      },
    ],
  };
  fs.writeFileSync(
    path.join(DIST, 'vercel.json'),
    JSON.stringify(vercelConfig, null, 2),
  );

  // api/ 디렉토리 복사 (Vercel Serverless Functions)
  const apiSrc = path.join(ROOT, 'api');
  const apiDest = path.join(DIST, 'api');
  if (fs.existsSync(apiSrc)) {
    copyDirSync(apiSrc, apiDest);
    console.log('[DEPLOY] api/ 디렉토리 복사 완료');
  }

  // schedule/ 디렉토리 복사 (발행 스케줄 데이터)
  const schSrc = path.join(ROOT, 'schedule');
  const schDest = path.join(DIST, 'schedule');
  if (fs.existsSync(schSrc)) {
    copyDirSync(schSrc, schDest);
    console.log('[DEPLOY] schedule/ 디렉토리 복사 완료');
  }

  // dist/에 .vercel 링크 설정
  const vercelDir = path.join(DIST, '.vercel');
  if (!fs.existsSync(vercelDir)) {
    console.log('[DEPLOY] Vercel 프로젝트 링크...');
    execSync(
      `npx vercel link --project zcheck-blog --token ${VERCEL_TOKEN} --yes`,
      { cwd: DIST, stdio: 'inherit' },
    );
  }

  console.log('\n[DEPLOY] Vercel 배포...');
  try {
    const result = execSync(
      `npx vercel deploy --prod --token ${VERCEL_TOKEN} --yes --force`,
      { cwd: DIST, encoding: 'utf8' },
    );
    console.log(result);
    console.log('\n[DEPLOY] 배포 완료!');
    console.log('  URL: https://blog.zcheck.co.kr');
  } catch (e) {
    console.error('[DEPLOY] 배포 실패:', e.message);
    process.exit(1);
  }
}

deploy();
