# 세션 핸드오프 - 이미지 안전장치 구축

날짜: 2026-02-25
슬러그: image-safety

## 완료 작업

### 문제
blog.zcheck.co.kr에서 6개 포스트 히어로 이미지 404 깨짐
- free-estimate-analysis, first-home-remodeling, estimate-reading-guide
- bathroom-remodeling, kitchen-remodeling, remodeling-meeting-preparation

### 원인
build.js가 매 실행마다 dist/를 완전 초기화(rmSync) → public/images/에 없던 이미지 누락

### 즉시 수정
6개 이미지를 dist/images/ → public/images/ 복사 후 재배포 (완료)

### build.js 개선 (scripts/build.js)
1. **A-2 폴백**: hero_image_local 소스 없으면 public/images/{slug}.png 자동 폴백
2. **자동 백업**: hero_image_local 복사 성공 시 public/images/에도 자동 백업
3. **B 검증**: validateBuild() - 빌드 후 dist/images/ 실제 존재 확인, 누락 시 process.exit(1)

## 현재 상태
- 이미지 9개 모두 정상 로딩 ✅
- 배포 완료 ✅
- 이미지 안전장치 적용됨 ✅

## 다음 세션 참고
- 신규 포스트 추가 시 public/images/ 수동 복사 불필요 (자동 백업됨)
- 이미지 누락 시 빌드 자체가 차단됨 (배포 불가)
- API 포스트(Airtable)의 thumbnail_url은 현재 모두 null → 외부 URL 검증 미포함
