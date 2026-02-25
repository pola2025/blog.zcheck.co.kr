# 다음 세션 요청문

```
지난 세션에서 Mac Claude(cluade-ctrl tmux) + nanoclaw(Codex tmux) 멀티에이전트 파이프라인을 구축했어.
NEXT_SESSION_nanoclaw-sora-pipeline.md 참고해서 이어서 진행해줘.
```

---

# 세션 핸드오프: nanoclaw Sora 이미지 파이프라인

**날짜**: 2026-02-25
**프로젝트**: zipcheck_blog + nanoclaw-archive

## 완료된 작업

### 인프라

- ✅ Windows → Mac SSH 원격제어 (tmux 기반)
- ✅ Mac 외장하드 프로젝트 세팅: `/Volumes/Untitled/zcheck-blog/`
- ✅ Mac 환경변수: `/Volumes/Untitled/zcheck-content-pipeline/.env` (경로 호환 해결)
- ✅ Codex tmux 세션: `nanoclaw` (작업 디렉토리: `/Volumes/Untitled/zcheck-blog`)
- ✅ Mac Claude tmux 세션: `cluade-ctrl` (할루시네이션 검증 + 아카이브 저장 담당)
- ✅ image-archive GitHub clone: `/Volumes/Untitled/nanoclaw-archive/image-archive/`
- ✅ Mac Claude에 Playwright MCP 설치 + Chromium 설치 완료

### 파이프라인 실증

- ✅ Codex 콘텐츠 JSON 생성 (interior-company-selection-test)
- ✅ Gemini 히어로 이미지 생성 (689KB, 품질 합격)
- ✅ 실제 발행: 블로그 배포 + Instagram + Threads 전부 성공

## 진행 중 (다음 세션에서 이어서)

### Mac Claude가 작성 중인 스크립트

- `/Volumes/Untitled/zcheck-blog/scripts/sora-generate.js`
- Playwright headed 모드로 sora.com 접속 → 이미지 생성 → `/tmp/sora_output/` 저장
- 완료 여부: Mac Claude가 세션 종료 전까지 계속 작업 중

### 다음 세션 TODO

1. **sora-generate.js 완성 확인**

   ```bash
   ssh pola@192.168.219.109 'ls /Volumes/Untitled/zcheck-blog/scripts/sora-generate.js'
   ```

2. **Sora 스크립트 테스트**

   ```bash
   ssh pola@192.168.219.109 '/usr/local/bin/tmux send-keys -t nanoclaw \
   "node scripts/sora-generate.js --prompt \"Korean apartment consultation scene\" --slug \"test-sora\"" Enter'
   ```

3. **Mac Claude 할루시네이션 검증 연결**
   - 생성 이미지 → Mac Claude에 경로 전달 → 검증 → archive 저장 → git push

4. **Instagram 중복 이미지 문제 해결**
   - 원인: `buildHeroPrompt()`가 키워드 기반 4~5개 프롬프트만 사용 → 시각적 중복
   - 해결: Sora로 교체 시 자연 해결 OR `generate-hero-images.js` 프롬프트 다양화

5. **Codex 샌드박스 파일 쓰기 영구 해결**
   - 현재: `-o /tmp/codex_output.txt` → SSH cp 방식으로 우회 중
   - 목표: Codex가 직접 content/\*.json 저장

## 핵심 경로

| 항목                    | 경로                                                            |
| ----------------------- | --------------------------------------------------------------- |
| 프로젝트 (Mac)          | `/Volumes/Untitled/zcheck-blog/`                                |
| image-archive (Mac)     | `/Volumes/Untitled/nanoclaw-archive/image-archive/zcheck-blog/` |
| image-archive (Windows) | `F:\image-archive\zcheck-blog\`                                 |
| .env (Mac)              | `/Volumes/Untitled/zcheck-content-pipeline/.env`                |
| GitHub image-archive    | `https://github.com/pola2025/image-archive.git`                 |
| GitHub token            | `[REDACTED - vault에서 확인]`                      |

## tmux 세션 접속 명령 (Windows Git Bash)

```bash
# Mac Claude (검증 담당)
ssh pola@192.168.219.109 && tmux attach -t cluade-ctrl

# nanoclaw (Codex, 콘텐츠+이미지 생성)
ssh pola@192.168.219.109 && /usr/local/bin/tmux attach -t nanoclaw
```

## 콘텐츠 파이프라인 전체 플로우 (확정)

```
nanoclaw (Codex)
  1. 주제 → content/<slug>.json 작성 (codex exec -o /tmp/output.txt → SSH cp)
  2. sora-generate.js → Sora 이미지 생성 → /tmp/sora_output/<slug>.png
  3. Mac Claude에 검증 요청 → 통과 시 image-archive 저장 + git push
  4. pipeline.js content/<slug>.json → 빌드 → Vercel 배포 → IG → Threads
```

## Instagram 중복 발행 이슈

- 기존 `remodeling-checklist-2026` 등 동일 이미지로 여러 포스트 노출 중
- 수동 삭제 또는 Sora 교체 후 재발행 검토 필요
