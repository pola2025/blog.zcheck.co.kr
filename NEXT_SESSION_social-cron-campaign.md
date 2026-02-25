# 세션 핸드오프: 집첵 Vercel Cron + 캠페인

**프로젝트**: zipcheck_blog
**경로**: F:\zipcheck_blog
**날짜**: 2026-02-11 23:30
**세션 요약**: CRON_SECRET 설정 + Cron 재발행 방지 버그 수정 + 캠페인 7일치 schedule JSON 생성 완료

## 복사해서 사용:
```
2/12 kitchen-remodeling Cron 자동발행 결과 확인하고, 2/11 중복 발행된 IG/Threads 포스트 정리해줘.
NEXT_SESSION_social-cron-campaign.md 파일에 상세 컨텍스트 있음.
```

## 완료된 작업
- ✅ CRON_SECRET 생성 및 Vercel production 환경변수 설정
- ✅ Cron 함수 버그 수정: result 파일 존재 시 skip 로직 추가
- ✅ Cron 함수에 발행 후 result 파일 쓰기 시도 로직 추가
- ✅ 캠페인 schedule JSON 7개 생성 (D1~D7, 2/15~2/21)
- ✅ Vercel 재배포 2회 (CRON_SECRET 반영 + 버그 수정)
- ✅ Cron 엔드포인트 검증: 인증 없이 401, 올바른 시크릿으로 200 + SKIP 확인

## 남은 작업
- [ ] **2/12 자동발행 확인**: kitchen-remodeling이 09:00 KST에 Cron으로 발행되는지 확인
- [ ] **2/11 중복 포스트 삭제**: 테스트 중 first-home-remodeling + free-estimate-analysis가 IG/Threads에 한 번 더 발행됨 → 수동 삭제 필요
- [ ] **캠페인 일별 이미지** (선택): 현재 모든 캠페인 포스트가 `/images/free-estimate-analysis.png` 공용 사용 중. 일별 고유 이미지 원하면 생성 필요

## 발행 일정

| 날짜 | 슬러그 | 상태 |
|------|--------|------|
| 2/11 | first-home-remodeling | ✅ 발행 완료 (수동) + ⚠️ 중복 발행됨 |
| 2/11 | free-estimate-analysis | ✅ 발행 완료 (수동) + ⚠️ 중복 발행됨 |
| 2/12 | kitchen-remodeling | ⏰ Vercel Cron |
| 2/13 | bathroom-remodeling | ⏰ Vercel Cron |
| 2/14 | estimate-reading-guide | ⏰ Vercel Cron |
| 2/15 | free-analysis-d1-problem | ⏰ Vercel Cron (캠페인) |
| 2/16 | free-analysis-d2-solution | ⏰ Vercel Cron (캠페인) |
| 2/17 | free-analysis-d3-numbers | ⏰ Vercel Cron (캠페인) |
| 2/18 | free-analysis-d4-comparison-trap | ⏰ Vercel Cron (캠페인) |
| 2/19 | free-analysis-d5-education | ⏰ Vercel Cron (캠페인) |
| 2/20 | free-analysis-d6-behind | ⏰ Vercel Cron (캠페인) |
| 2/21 | free-analysis-d7-twist | ⏰ Vercel Cron (캠페인) |

## Cron 구조

```
매일 00:00 UTC (09:00 KST)
  → /api/cron/publish-social 호출 (CRON_SECRET 인증)
  → schedule/ 디렉토리에서 오늘 날짜 매칭 JSON 검색
  → result 파일 존재 시 SKIP (재발행 방지)
  → IG + Threads 발행
  → result 파일 쓰기 시도 (read-only 환경에서는 실패 무시)
  → 텔레그램 알림
```

## 주요 파일

| 파일 | 설명 |
|------|------|
| api/cron/publish-social.js | Cron 함수 (result 체크 + 발행 + 알림) |
| schedule/*.json | 발행 스케줄 데이터 |
| schedule/*-result.json | 발행 결과 (이미 발행된 포스트 마커) |
| scripts/deploy.js | 빌드 + Vercel 배포 |

## CRON_SECRET

- 값: `17fbd687e1753e3aed00cacc98da7fada74aa91c5b4adcc2966f23d7497a5298`
- Vercel production 환경변수에 설정됨
- Vercel이 Cron 호출 시 Authorization: Bearer {secret} 헤더로 자동 전송

## 주의사항
- Vercel Hobby 플랜: Cron 1개, 1일 1회 제한
- Vercel Serverless 파일시스템은 read-only → result 파일 쓰기는 배포 시 포함된 것만 유효
- deploy.js가 dist 초기화 시 .vercel 삭제 → vercel link 자동 재설정
- 캠페인 IG 이미지: 모두 free-estimate-analysis.png 공용 사용
