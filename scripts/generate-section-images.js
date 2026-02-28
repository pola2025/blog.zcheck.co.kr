/**
 * 섹션별 고유 이미지 생성 (Gemini)
 * 사용법: node scripts/generate-section-images.js
 */
const https = require("https");
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

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.1-flash-image-preview";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const IMAGES_DIR = path.join(__dirname, "..", "images", "company-selection");

const BASE_STYLE =
  "Korean apartment interior aesthetic photography. Warm natural lighting, soft tones, cozy atmosphere, editorial magazine quality. 16:9 aspect ratio. No text overlay, no watermark, no people, no before-after split.";

const SECTIONS = [
  {
    name: "section2-portfolio",
    prompt: `${BASE_STYLE} A well-organized design portfolio book open on a marble table, showing colorful interior renovation photos. Beside it, fabric samples and color swatches are neatly arranged. Clean minimalist space with afternoon golden light.`,
  },
  {
    name: "section3-estimate",
    prompt: `${BASE_STYLE} Close-up of a clean white desk with printed interior renovation estimate documents, a calculator, and a pen. Soft focus background showing a Korean apartment living room. Professional, trustworthy, organized feeling.`,
  },
  {
    name: "section4-contract",
    prompt: `${BASE_STYLE} An elegant wooden desk with a neatly placed contract document, a premium pen, and reading glasses. A potted succulent nearby. Soft window light creating warm atmosphere. Trust and professionalism concept.`,
  },
  {
    name: "section5-review",
    prompt: `${BASE_STYLE} A cozy Korean cafe-style reading nook with a tablet showing review pages, a cup of coffee, and a small notebook. Warm ambient lighting, bookshelf in soft focus background. Research and careful decision-making mood.`,
  },
];

function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    });

    const url = new URL(ENDPOINT);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`Gemini API: ${json.error.message}`));
            return;
          }
          const parts = json.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find((p) => p.inlineData);
          if (!imagePart) {
            reject(new Error("이미지가 반환되지 않음"));
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

    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("타임아웃"));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!API_KEY) {
    console.error("GEMINI_API_KEY 없음");
    process.exit(1);
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  console.log(`[SECTION] ${SECTIONS.length}개 섹션 이미지 생성 시작\n`);

  for (let i = 0; i < SECTIONS.length; i++) {
    const { name, prompt } = SECTIONS[i];
    const imgPath = path.join(IMAGES_DIR, `${name}.png`);

    console.log(`[${i + 1}/${SECTIONS.length}] ${name}`);
    console.log(`  프롬프트: ${prompt.substring(0, 80)}...`);

    try {
      const result = await generateImage(prompt);
      const buffer = Buffer.from(result.base64, "base64");
      fs.writeFileSync(imgPath, buffer);
      console.log(
        `  완료: ${imgPath} (${(buffer.length / 1024).toFixed(0)}KB)`,
      );
    } catch (e) {
      console.error(`  실패: ${e.message}`);
      console.log("  5초 후 재시도...");
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const result = await generateImage(prompt);
        const buffer = Buffer.from(result.base64, "base64");
        fs.writeFileSync(imgPath, buffer);
        console.log(`  재시도 성공: ${imgPath}`);
      } catch (e2) {
        console.error(`  재시도도 실패: ${e2.message}`);
      }
    }

    if (i < SECTIONS.length - 1) {
      console.log("  5초 대기 (rate limit)...");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log("\n[SECTION] 완료!");
  console.log(`이미지 경로: ${IMAGES_DIR}`);
}

main();
