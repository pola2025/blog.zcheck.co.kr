# 다음 세션 요청문

```
NEXT_SESSION_vercel-cron-full-auto.md 참고해서 Vercel Cron 완전자동화 구현해줘
```

---

# 세션 핸드오프: Vercel Cron 완전자동화

**날짜**: 2026-02-25
**목표**: Mac 자동화 포기 → Vercel Cron 기반 블로그 완전자동화

## 설계 확정

### 흐름

```
[매일 21:00 UTC = 06:00 KST]
/api/cron/auto-generate  ← 신규 작성
  1. Workers KV "blog:topic:queue" → 오늘 주제 꺼내기
  2. Gemini API → content JSON 생성 (글 + IG캡션 + Threads체인)
  3. Gemini API → hero image 생성 (base64)
  4. POST workers /api/images/blog-upload → R2 저장 → URL 반환
  5. POST workers /api/blog/posts → Airtable 저장 (thumbnail_url 포함)
  6. Workers KV "blog:today:slug" = slug 저장
  7. POST Vercel Deploy Hook → Vercel 재빌드 트리거

[Vercel 자동 빌드 ~2분]
  build.js → /api/blog/posts → 새 글 포함 → dist/ 생성

[매일 00:00 UTC = 09:00 KST]
/api/cron/publish-social  ← 기존 수정
  Workers KV "blog:today:slug" 조회
  Workers /api/blog/posts/{slug} → IG캡션 + Threads체인 가져오기
  hero_image가 http로 시작하면 그대로 사용 (버그 수정)
  IG + Threads 발행 → KV 발행 기록
```

## 사용 서비스 (신규 없음, 기존만)

| 서비스                 | 용도                 | 비고                                    |
| ---------------------- | -------------------- | --------------------------------------- |
| Gemini API             | 콘텐츠 + 이미지 생성 | Vercel env에 GEMINI_API_KEY 있음        |
| Cloudflare R2          | 이미지 저장          | `zipcheck-uploads` 버킷                 |
| Cloudflare KV          | 주제 큐 + today_slug | `blog:topic:queue`, `blog:today:slug`   |
| Workers Airtable proxy | 콘텐츠 저장/조회     | `zipcheck-api.zipcheck2025.workers.dev` |
| Vercel Deploy Hook     | 재빌드 트리거        | Dashboard에서 URL 발급 필요             |

**Claude API 없음 → Gemini으로 콘텐츠 생성**

## 구현 순서

### Step 1: Workers 엔드포인트 추가 (`F:\GOI\workers`)

- `POST /api/images/blog-upload` → R2에 base64 이미지 저장, public URL 반환
- `GET /api/blog/topic-queue` → KV에서 주제 큐 조회
- `PUT /api/blog/topic-queue` → KV에 주제 큐 저장
- `GET /api/blog/today` → KV "blog:today:slug" 조회
- `PUT /api/blog/today` → KV "blog:today:slug" 저장

### Step 2: Vercel 프로젝트 설정 변경

- Build Command: `node scripts/build.js`
- Output Directory: `dist`
- Install Command: (없음 또는 `npm install`)
- Deploy Hook URL 발급 → Vercel env `VERCEL_DEPLOY_HOOK_URL`에 저장

### Step 3: `/api/cron/auto-generate.js` 신규 작성

- Gemini 텍스트 생성: content JSON (slug, title, body_sections, instagram_caption, threads_chain)
- Gemini 이미지 생성: hero image
- Workers R2 업로드 → thumbnail_url 획득
- Workers Airtable POST → 포스트 저장
- Workers KV → today_slug 저장
- Deploy Hook POST → 재빌드 트리거

### Step 4: `/api/cron/publish-social.js` 수정

- 기존 `schedule/*.json` 파일 방식 → Workers KV `blog:today:slug` 조회 방식으로 변경
- Workers `/api/blog/posts/{slug}` → IG캡션, Threads체인, hero_image 가져오기
- hero_image URL 처리: `http`로 시작하면 그대로 사용 (기존 버그 수정)

### Step 5: `vercel.json` cron 추가

```json
{
  "crons": [
    { "path": "/api/cron/auto-generate", "schedule": "0 21 * * *" },
    { "path": "/api/cron/publish-social", "schedule": "0 0 * * *" }
  ]
}
```

### Step 6: 주제 큐 초기값 입력

Workers KV `blog:topic:queue`에 미발행 주제 10개 입력:

- 인테리어 계약서 체크리스트
- 신혼 아파트 인테리어 우선순위
- 아파트 평수별 인테리어 비용 가이드
- 욕실 리모델링 순서
- 주방 인테리어 셀프 vs 업체
- 인테리어 시공 기간 단축 방법
- 인테리어 자재 직구 vs 업체 구매
- 아파트 베란다 확장 주의사항
- 인테리어 AS 보증 확인법
- 인테리어 중간 점검 체크리스트

## 핵심 경로

| 항목                      | 경로                                   |
| ------------------------- | -------------------------------------- |
| Workers 프로젝트          | `F:\GOI\workers\`                      |
| Workers 라우트            | `F:\GOI\workers\src\routes\`           |
| Vercel Cron API           | `F:\zipcheck_blog\api\cron\`           |
| blog.ts (Airtable proxy)  | `F:\GOI\workers\src\routes\blog.ts`    |
| R2 images route           | `F:\GOI\workers\src\routes\images.ts`  |
| counter.ts (KV 패턴 참고) | `F:\GOI\workers\src\routes\counter.ts` |

## 주의사항

- Workers R2 버킷명: `zipcheck-uploads`
- KV 키 네이밍: `blog:topic:queue`, `blog:today:slug`, `blog:published:{slug}:{date}`
- R2 이미지 경로: `blog-hero/{slug}.png`
- Workers public URL: `https://zipcheck-api.zipcheck2025.workers.dev/images/blog-hero/{slug}.png`
- Gemini 이미지 생성 모델: `/image-gen` 스킬 참조
- build.js의 `thumbnail_url`이 http URL이면 hero_image로 그대로 사용됨 (이미 구현됨)
- Vercel Deploy Hook은 Dashboard > Project Settings > Git > Deploy Hooks에서 생성
