# 나노클로 (Codex) 작업 컨텍스트

## 역할

자체 블로그(blog.zcheck.co.kr) 콘텐츠 자동 작성 및 발행 전담

## 프로젝트 경로

`/Volumes/Untitled/zcheck-blog/`

## 작업 플로우 (네이버 블로그 제외)

```
1. 콘텐츠 JSON 작성  →  content/<slug>.json
2. 히어로 이미지 생성  →  node scripts/generate-hero-images.js
3. 파이프라인 실행  →  node scripts/pipeline.js content/<slug>.json
   └── 블로그 빌드 → Vercel 배포 → Instagram 발행 → Threads 발행
```

## 콘텐츠 JSON 포맷

```json
{
  "slug": "영문-슬러그",
  "title": "한국어 제목 (25자 이내, SEO 키워드 포함)",
  "meta_description": "검색 설명 150자 이내",
  "category": "인테리어 가이드",
  "target_keyword": "메인 SEO 키워드",
  "tags": ["태그1", "태그2", "태그3", "태그4"],
  "published_at": "ISO8601 날짜",
  "published": true,
  "hero_image_local": null,
  "hero_image": null,
  "body_sections": [ ... ],
  "source": "codex-pipeline"
}
```

## body_sections 타입

- `{"type": "text", "content": "본문 (==하이라이트== **볼드** 지원)"}`
- `{"type": "heading", "content": "소제목"}`
- `{"type": "callout", "emoji": "💡 또는 ⚠️", "title": "제목", "content": "설명"}`
- `{"type": "keypoints", "title": "핵심 포인트", "points": [{"title": "...", "desc": "..."}]}`

## 콘텐츠 작성 규칙

- 타겟: 30~40대 인테리어 관심 아파트 거주자
- 톤: 친근하고 실용적, 전문적이지만 어렵지 않게
- 분량: text 섹션 4~6개, 총 1500~2500자
- 키포인트: 3~5개 (heading-text 쌍에서 자동 생성됨)
- callout: 최대 1개 (경고⚠️ 또는 팁💡)
- 마지막 text 섹션은 집첵 무료 견적 분석 서비스 CTA 포함
- 이미지는 hero_image_local: null 로 두면 generate-hero-images.js가 자동 생성

## 주제 풀 (미발행 아이템 우선)

- 아파트 리모델링 업체 선정 기준
- 인테리어 평수별 비용 가이드
- 욕실 리모델링 순서
- 주방 인테리어 셀프 vs 업체
- 인테리어 계약서 체크리스트
- 신혼 아파트 인테리어 우선순위

## 실행 명령어

```bash
cd /Volumes/Untitled/zcheck-blog

# 이미지 생성
export PATH=/usr/local/bin:/usr/bin:/bin
node scripts/generate-hero-images.js

# 파이프라인 (빌드+배포+IG+Threads)
node scripts/pipeline.js content/<slug>.json

# 드라이런 (실제 발행 없이 확인)
node scripts/pipeline.js content/<slug>.json --dry-run
```

## 환경변수

`.env` 위치: `/Volumes/Untitled/zcheck-blog/.env` (자동 로드됨)
