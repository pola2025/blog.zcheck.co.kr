# 세션 핸드오프: ZCheck Blog

**프로젝트**: zipcheck_blog
**경로**: F:\zipcheck_blog
**날짜**: 2026-02-11 15:00
**세션 요약**: 게시글별 조회수 카운터 + 중복발행 방지 구현 완료

## 복사해서 사용:
```
NEXT_SESSION_view-counter-deploy.md 파일에 상세 컨텍스트 있음.
```

## 완료된 작업
- ✅ Cloudflare Workers KV 기반 게시글별 조회수 API 추가 (`F:\GOI\workers\src\routes\counter.ts`)
- ✅ 포스트 페이지 조회수 표시 + 세션당 1회 자동 카운트
- ✅ 인덱스 페이지 카드별 조회수 표시 (batch fetch)
- ✅ Cron 중복발행 방지: Workers KV 기반 (`published/:slug/:date`)
- ✅ Workers 배포 완료 (v4c4b49a1)
- ✅ 블로그 Vercel 배포 완료 (https://blog.zcheck.co.kr)
- ✅ 불필요한 `api/views.js` (Upstash 방식) 삭제

## 남은 작업
- [ ] 실제 사이트에서 조회수 표시 UI 확인 (모바일/데스크톱)
- [ ] 기존 게시글 조회수 초기값 설정 (필요 시 KV에 직접 세팅)

## 중요 컨텍스트

### 새 Workers API 엔드포인트
- `GET /api/counter/view/:slug` → 조회수 +1
- `GET /api/counter/views?slugs=a,b,c` → 일괄 조회
- `GET /api/counter/published/:slug/:date` → 발행 여부 체크
- `PUT /api/counter/published/:slug/:date` → 발행 기록 (TTL 30일)

### KV 키 구조
- 조회수: `blog:views:{slug}`
- 발행기록: `blog:published:{slug}:{date}`

### 수정된 파일
- `F:\GOI\workers\src\routes\counter.ts` — 4개 엔드포인트 추가
- `templates/post.html` — 조회수 표시 + 스크립트
- `templates/index.html` — 카드별 조회수 + 스크립트
- `scripts/build.js` — 카드에 data-slug 추가
- `api/cron/publish-social.js` — Workers KV 기반 중복 체크

## 주의사항
- 2026-02-11 수동으로 중복발행 게시글 삭제한 이력 있음
- Vercel Cron 파일시스템은 read-only → result 파일 저장 불가 → Workers KV로 해결
- Upstash Redis는 사용하지 않음 (사용자 거부)
