/**
 * 히어로 이미지가 없는 포스트에 Gemini로 이미지 자동 생성
 *
 * 사용법: node scripts/generate-hero-images.js
 * 환경변수: GEMINI_API_KEY (또는 .env에서 로드)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// .env 파일에서 직접 로드 (dotenv 불필요)
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
const CONTENT_DIR = path.join(__dirname, '..', 'content');
const IMAGES_DIR = path.join(__dirname, '..', 'images');

const BASE_STYLE = 'Korean apartment interior aesthetic photography. Warm natural lighting, soft tones, cozy atmosphere, editorial magazine quality. 16:9 aspect ratio. No text overlay, no watermark, no people, no before-after split.';

// 포스트 키워드 → 이미지 프롬프트 매핑
function buildHeroPrompt(post) {
  const keyword = post.target_keyword || '';
  const title = post.title || '';

  if (keyword.includes('업체') || keyword.includes('선정')) {
    return `${BASE_STYLE} Korean apartment consultation scene. Clean desk with interior design samples, fabric swatches, and a tablet showing floor plans. Professional and trustworthy mood. Afternoon sunlight through large windows.`;
  }
  if (keyword.includes('사기') || keyword.includes('피해')) {
    return `${BASE_STYLE} Korean apartment living room in progress of renovation. Partially finished walls, protective plastic sheets on floor, construction tools neatly arranged. Cautious and careful atmosphere. Warm but slightly dramatic lighting.`;
  }
  if (keyword.includes('견적') || keyword.includes('비용')) {
    return `${BASE_STYLE} Korean apartment living room with warm wood flooring, beige sofa, afternoon sunlight streaming through sheer curtains. Cozy and inviting mood.`;
  }
  // 기본
  return `${BASE_STYLE} Modern Korean apartment interior overview. Open living room with kitchen island, warm wood tones, plants, natural light. Welcoming editorial shot.`;
}

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

  // hero_image가 없는 포스트 찾기
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json'));
  const needsImage = [];

  for (const file of files) {
    const post = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'));
    if (!post.hero_image_local && !post.hero_image) {
      needsImage.push({ file, post });
    }
  }

  if (needsImage.length === 0) {
    console.log('모든 포스트에 히어로 이미지 있음. 생성 불필요.');
    return;
  }

  console.log(`[HERO] ${needsImage.length}개 포스트에 히어로 이미지 생성\n`);

  for (let i = 0; i < needsImage.length; i++) {
    const { file, post } = needsImage[i];
    const slug = post.slug;
    const imgPath = path.join(IMAGES_DIR, `${slug}.png`);
    const prompt = buildHeroPrompt(post);

    console.log(`[${i + 1}/${needsImage.length}] ${slug}`);
    console.log(`  프롬프트: ${prompt.substring(0, 80)}...`);

    try {
      const result = await generateImage(prompt);
      const buffer = Buffer.from(result.base64, 'base64');
      fs.writeFileSync(imgPath, buffer);
      console.log(`  완료: ${imgPath} (${(buffer.length / 1024).toFixed(0)}KB)`);

      // content JSON 업데이트
      post.hero_image_local = imgPath;
      post.hero_image = `/images/${slug}.png`;
      fs.writeFileSync(
        path.join(CONTENT_DIR, file),
        JSON.stringify(post, null, 2),
        'utf-8',
      );
      console.log(`  JSON 업데이트: ${file}`);
    } catch (e) {
      console.error(`  실패: ${e.message}`);
      // 재시도 1회
      console.log('  5초 후 재시도...');
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const result = await generateImage(prompt);
        const buffer = Buffer.from(result.base64, 'base64');
        fs.writeFileSync(imgPath, buffer);
        post.hero_image_local = imgPath;
        post.hero_image = `/images/${slug}.png`;
        fs.writeFileSync(path.join(CONTENT_DIR, file), JSON.stringify(post, null, 2), 'utf-8');
        console.log(`  재시도 성공: ${imgPath}`);
      } catch (e2) {
        console.error(`  재시도 실패: ${e2.message}`);
      }
    }

    // rate limit 대기
    if (i < needsImage.length - 1) {
      console.log('  10초 대기 (rate limit)...');
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  console.log('\n[HERO] 완료');
}

main();
