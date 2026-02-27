/**
 * GitHub 이미지 아카이브 연동
 * - pola2025/zblogcontent-archive 레포에서 이미지 가져오기
 * - 매니페스트(사용 추적)를 아카이브 레포에 JSON으로 저장
 */

const ARCHIVE_REPO = "pola2025/zblogcontent-archive";
const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = `https://raw.githubusercontent.com/${ARCHIVE_REPO}/main`;
const MANIFEST_PATH = "usage-manifest.json";

function githubHeaders(token) {
  const h = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "zcheck-cron",
  };
  if (token) h["Authorization"] = `token ${token}`;
  return h;
}

/**
 * GitHub API로 metadata.json 읽기
 */
async function fetchArchiveCatalog(token) {
  const url = `${GITHUB_API}/repos/${ARCHIVE_REPO}/contents/images/metadata.json`;
  const res = await fetch(url, {
    headers: {
      ...githubHeaders(token),
      Accept: "application/vnd.github.v3.raw",
    },
  });
  if (!res.ok) throw new Error(`metadata.json fetch failed: ${res.status}`);
  const data = await res.json();
  return data.images || [];
}

/**
 * GitHub에서 매니페스트 읽기 (없으면 null)
 */
async function fetchManifest(token) {
  const url = `${GITHUB_API}/repos/${ARCHIVE_REPO}/contents/${MANIFEST_PATH}`;
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const file = await res.json();
  const decoded = Buffer.from(file.content, "base64").toString("utf-8");
  return { data: JSON.parse(decoded), sha: file.sha };
}

/**
 * GitHub에 매니페스트 저장
 */
async function saveManifest(token, manifest, sha) {
  const url = `${GITHUB_API}/repos/${ARCHIVE_REPO}/contents/${MANIFEST_PATH}`;
  const body = {
    message: "chore: update usage manifest",
    content: Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`manifest save failed: ${err}`);
  }
}

/**
 * metadata.json → 매니페스트 초기 동기화
 */
async function syncManifest(token) {
  const catalog = await fetchArchiveCatalog(token);
  const images = {};
  for (const img of catalog) {
    images[img.id] = {
      filename: img.filename,
      status: img.status,
      used_in: img.used_in || [],
      quality_score: img.quality_score || 0,
    };
  }
  const manifest = { last_synced: new Date().toISOString(), images };
  await saveManifest(token, manifest, null);
  console.log(`[archive] 매니페스트 초기화: ${catalog.length}개`);
  return { data: manifest, sha: null };
}

/**
 * 채널 미사용 approved 이미지 선택
 * @param {string} token - GitHub token
 * @param {string} channel - "blog" | "instagram" | "threads"
 * @returns {{ id, filename } | null}
 */
async function getUnusedImage(token, channel) {
  let { data: manifest, sha } = await fetchManifest(token);

  if (!manifest) {
    try {
      const synced = await syncManifest(token);
      manifest = synced.data;
      sha = synced.sha;
    } catch (e) {
      console.error("[archive] 동기화 실패:", e.message);
      return null;
    }
  }

  const entries = Object.entries(manifest.images);
  if (entries.length === 0) return null;

  // approved && channel 미사용
  let candidates = entries.filter(
    ([, img]) => img.status === "approved" && !img.used_in.includes(channel),
  );

  // 전부 사용됨 → 해당 채널만 리셋
  if (candidates.length === 0) {
    console.log(`[archive] ${channel} 전부 사용됨 → 리셋`);
    for (const [, img] of entries) {
      img.used_in = img.used_in.filter((c) => c !== channel);
    }
    await saveManifest(token, manifest, sha);
    candidates = entries.filter(
      ([, img]) => img.status === "approved" && !img.used_in.includes(channel),
    );
  }

  if (candidates.length === 0) return null;

  // quality_score 높은 순 → 상위 5개 중 랜덤
  candidates.sort(
    ([, a], [, b]) => (b.quality_score || 0) - (a.quality_score || 0),
  );
  const topN = candidates.slice(0, Math.min(5, candidates.length));
  const [id, img] = topN[Math.floor(Math.random() * topN.length)];

  return { id, filename: img.filename };
}

/**
 * 채널 사용 마킹
 */
async function markImageUsed(token, imageId, channel) {
  const { data: manifest, sha } = await fetchManifest(token);
  if (!manifest || !manifest.images[imageId]) return;

  if (!manifest.images[imageId].used_in.includes(channel)) {
    manifest.images[imageId].used_in.push(channel);
  }
  await saveManifest(token, manifest, sha);
  console.log(`[archive] ${imageId} → ${channel} 마킹`);
}

/**
 * GitHub raw에서 이미지 바이너리 다운로드 → base64 반환
 */
async function downloadArchiveImage(token, filename) {
  const url = `${GITHUB_RAW}/images/webp/${filename}`;
  const headers = { "User-Agent": "zcheck-cron" };
  if (token) headers["Authorization"] = `token ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok)
    throw new Error(`이미지 다운로드 실패: ${filename} (${res.status})`);

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return { base64, mimeType: "image/webp" };
}

module.exports = {
  fetchArchiveCatalog,
  getUnusedImage,
  markImageUsed,
  downloadArchiveImage,
};
