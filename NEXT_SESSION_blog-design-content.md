# 세션 핸드오프: zipcheck_blog

**프로젝트**: zipcheck_blog
**경로**: F:\zipcheck_blog
**날짜**: 2026-02-06 02:10
**세션 요약**: 블로그 독립 도메인 배포 완료, 디자인 리뉴얼 진행 중

## 복사해서 사용:
```
zipcheck_blog 블로그 디자인/콘텐츠 작업 이어서.
NEXT_SESSION_blog-design-content.md 파일에 상세 컨텍스트 있음.
```

## 완료된 작업
- ✅ F:\zcheck-blog → F:\zipcheck_blog 프로젝트 이관
- ✅ GitHub 연결: pola2025/blog.zcheck.co.kr (SSH: github-pola2025)
- ✅ Vercel 배포: blog.zcheck.co.kr (zcheck-blog 프로젝트)
- ✅ Vercel SSO Protection 해제
- ✅ 불필요한 Vercel 프로젝트 삭제 (dist, flame)
- ✅ blog.zcheck.co.kr 도메인을 zipcheck → zcheck-blog 프로젝트로 이동
- ✅ 빌드 설정: npm run build → dist/ (Vercel)
- ✅ 로고 교체: logo.png(헤더), logo_white.png(다크푸터), 정사각로고(파비콘)
- ✅ "AI 기반" → "원가 기반" 전체 변경
- ✅ post.html 리디자인 (polarad.co.kr/marketing-news 참고)
  - 브레드크럼 + 큰 제목 + 날짜/저자 메타
  - article-content CSS (h2 밑줄, 리스트마커 민트, blockquote, 이미지)
  - 공유 버튼: 페이스북 + X + 링크복사 (카카오 제외)
  - CTA: 3열 레이아웃 (아이콘+텍스트+버튼)
  - 브랜드 컬러: 집첵 민트(#13A9BA)
- ✅ 다크 푸터 (logo_white.png, 네비 링크)

## 남은 작업

### 1. 본문 텍스트 중앙 정렬 (우선)
- 현재 왼쪽 정렬 → 어색함
- 본문 영역을 중앙 정렬로 변경 필요
- `.article-content p { text-align: center; }` 또는 본문 컨테이너 중앙 정렬

### 2. 본문 내 HTML 구조화 요소 추가
- 현재 본문이 텍스트만 나열됨 → 구조적 요소 필요
- 추가할 요소 후보:
  - **체크리스트 박스** (✅ 확인해야 할 항목)
  - **경고/팁 박스** (💡 알아두세요, ⚠️ 주의)
  - **번호 스텝 카드** (1단계, 2단계...)
  - **비교 테이블** (업체 A vs B)
  - **인용 블록** (전문가 의견)
  - **키포인트 하이라이트 박스**
- build.js의 `buildBodyHtml()` 함수에서 새 section type 추가 필요
- content JSON에 새 type 추가: `checklist`, `tip`, `warning`, `step`, `table`

### 3. 인덱스 페이지 리디자인
- polarad처럼 3열 그리드 카드
- 16:9 썸네일 + hover:scale-105
- 카테고리 배지 + 날짜

### 4. 썸네일/이미지 문제
- hero_image_local 경로가 F:\zcheck-content-pipeline\images\img1.png → 빌드 시 복사됨
- 본문 내 이미지 미지원 (build.js에서 type:'image' case가 break만 함)
- 이미지 생성 파이프라인: Gemini gemini-3-pro-image-preview로 5장 생성

### 5. 콘텐츠 파이프라인 완성
- content JSON → 네이버 블로그 → blog.zcheck.co.kr → Instagram → Threads
- F:\zcheck-content-pipeline 프로젝트와 연동

## 중요 컨텍스트
- **브랜딩**: "AI 기반" 사용 금지 → "원가 기반" 사용
- **공유**: 카카오 제외 (페이스북, X, 링크복사만)
- **디자인 참고**: https://www.polarad.co.kr/marketing-news (소스: F:\polasales\website)
- **로고 원본**: F:\GOI\logo.png / logo_white.png / 정사각로곡 복사.png
- **집첵 민트 컬러**: #13A9BA (로고 SVG의 teal gradient)

## 프로젝트 정보
- **경로**: F:\zipcheck_blog
- **GitHub**: pola2025/blog.zcheck.co.kr (SSH: github-pola2025)
- **Vercel**: zcheck-blog 프로젝트
- **도메인**: blog.zcheck.co.kr
- **빌드**: node scripts/build.js → dist/
- **개발서버**: npm run dev (port 3000)
- **GA4**: G-Z15NR826B7
- **Vercel 토큰**: $VERCEL_TOKEN (bashrc)

## 주의사항
- Vercel 빌드 시 dist/ 는 gitignore에 포함됨 → Vercel에서 자체 빌드
- logo.svg (F:\GOI\logos\logo.svg)는 추상 도형이라 잘못된 로고임 → 사용 금지
- content JSON의 hero_image_local은 절대경로(F:\...) → 빌드 시 복사됨
