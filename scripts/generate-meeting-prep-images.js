/**
 * 인테리어 업체 미팅 준비 포스트용 이미지 5장 생성
 * 1장 히어로 + 4장 섹션 이미지
 */
const https = require('https');
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

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3-pro-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const SLUG = 'remodeling-meeting-preparation';
const IMAGES_DIR = path.join(__dirname, '..', 'images', 'meeting-preparation');
const ARCHIVE_DIR = path.join('F:', 'image-archive', 'zcheck-blog', `2026-02-07_${SLUG}`);

const BASE_STYLE = 'Korean apartment interior aesthetic photography. Warm natural lighting, soft tones, cozy atmosphere, editorial magazine quality. 16:9 aspect ratio. No text overlay, no watermark, no people, no before-after split.';

const IMAGES = [
  {
    name: 'hero',
    prompt: `${BASE_STYLE} A clean wooden desk prepared for an interior consultation meeting. Floor plan blueprint, a notebook with handwritten notes, a coffee cup, color swatches, and a tablet showing apartment interior photos. Organized and professional preparation mood. Morning sunlight through sheer curtains.`,
  },
  {
    name: 'section1-floorplan',
    prompt: `${BASE_STYLE} Close-up of an apartment floor plan blueprint spread on a light wood table. A measuring tape and pencil beside it. Soft afternoon sunlight. Clean, precise, architectural feeling. Korean apartment context.`,
  },
  {
    name: 'section2-reference',
    prompt: `${BASE_STYLE} A tablet and smartphone on a cozy desk showing beautiful interior design reference photos. Pinterest-style mood board on screen. Beside them, a small notebook with bookmarked pages. Warm ambient lighting, creative inspiration mood.`,
  },
  {
    name: 'section3-budget',
    prompt: `${BASE_STYLE} A minimalist desk scene with a simple calculator, a neat budget planning notebook, and a pen. Clean white desk surface. A small plant in the corner. Calm, organized financial planning atmosphere. Soft natural light.`,
  },
  {
    name: 'section4-questions',
    prompt: `${BASE_STYLE} A notebook opened to a page with a neatly written checklist, a quality pen placed on top. A cup of warm tea beside it. Cozy Korean apartment living room in soft focus background. Thoughtful preparation and careful planning mood.`,
  },
];

function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    });

    const url = new URL(ENDPOINT);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`Gemini API: ${json.error.message}`));
            return;
          }
          const parts = json.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find((p) => p.inlineData);
          if (!imagePart) {
            reject(new Error('이미지가 반환되지 않음'));
            return;
          }
          resolve({
            base64: imagePart.inlineData.data,
            mimeType: imagePart.inlineData.mimeType,
          });
        } catch (e) {
          reject(new Error(`파싱 실패: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('타임아웃')); });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!API_KEY) {
    console.error('GEMINI_API_KEY 없음');
    process.exit(1);
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  console.log(`[IMG] ${IMAGES.length}장 이미지 생성 시작\n`);
  console.log(`  프로젝트: ${IMAGES_DIR}`);
  console.log(`  아카이브: ${ARCHIVE_DIR}\n`);

  const results = [];

  for (let i = 0; i < IMAGES.length; i++) {
    const { name, prompt } = IMAGES[i];
    const imgPath = path.join(IMAGES_DIR, `${name}.png`);
    const archivePath = path.join(ARCHIVE_DIR, `${String(i + 1).padStart(2, '0')}_${name}.png`);

    console.log(`[${i + 1}/${IMAGES.length}] ${name}`);

    try {
      const result = await generateImage(prompt);
      const buffer = Buffer.from(result.base64, 'base64');

      // 아카이브 원본 저장 (먼저)
      fs.writeFileSync(archivePath, buffer);
      console.log(`  아카이브: ${archivePath} (${(buffer.length / 1024).toFixed(0)}KB)`);

      // 프로젝트 저장
      fs.writeFileSync(imgPath, buffer);
      console.log(`  프로젝트: ${imgPath}`);

      results.push({ name, path: imgPath, success: true });
    } catch (e) {
      console.error(`  실패: ${e.message}`);
      console.log('  10초 후 재시도...');
      await new Promise((r) => setTimeout(r, 10000));
      try {
        const result = await generateImage(prompt);
        const buffer = Buffer.from(result.base64, 'base64');
        fs.writeFileSync(archivePath, buffer);
        fs.writeFileSync(imgPath, buffer);
        console.log(`  재시도 성공`);
        results.push({ name, path: imgPath, success: true });
      } catch (e2) {
        console.error(`  재시도 실패: ${e2.message}`);
        results.push({ name, path: imgPath, success: false });
      }
    }

    if (i < IMAGES.length - 1) {
      console.log('  5초 대기...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(`\n[IMG] 완료! ${results.filter(r => r.success).length}/${IMAGES.length}장 성공`);
  console.log(`이미지 경로: ${IMAGES_DIR}`);
  console.log(`아카이브: ${ARCHIVE_DIR}`);
}

main();
