# Ollama Cloud 지원 (결정 사항)

날짜: 2026-08-13
상태: 구현 완료, 라이브 검증 완료

## 목표

`ollama-cloud`를 세 번째 지원 프로바이더로 추가한다. 모델 리스트 취득, 비전
지원 검사, 위임 분석 모델 선택, 호출자 검증에 모두 포함한다.

## 배경

- 현재 프로젝트는 `opencode-go`와 `opencode`(Zen)만 지원한다
  (`src/model.ts`의 `ALLOWED_PROVIDER_IDS`).
- 사용자의 OpenCode 세션은 `ollama-cloud`를 연결된 프로바이더로 노출하며,
  비전 모델 8개(`kimi-k2.5`, `gemma4:31b`, `qwen3.5:397b` 등)를 제공한다.
- 현재 세션의 호출 모델이 `ollama-cloud/deepseek-v4-flash:0731`이므로,
  호출자 검증도 ollama-cloud를 허용해야 네이티브 툴이 동작한다.

## 결정 사항

### D1. allowlist에 `ollama-cloud` 하드코딩 추가

- `ALLOWED_PROVIDER_IDS = ["opencode-go", "opencode", "ollama-cloud"]`.
- 호출자 검증(`tool.ts`), doctor 필터(`opencode.ts`), setup UI(`setup.ts`)는
  모두 이 상수를 통해 자동 확장된다.
- allowlist 일반화(모든 연결 provider 허용)나 config 기반 provider 확장은
  하지 않는다. 요구 범위가 "Ollama Cloud 하나"이므로, 추가 provider가 필요해지면
  그때 일반화를 재검토한다.
- 선택: 사용자 명시 (Q1-A)

### D2. 클라우드 업로드 동의 notice 버전 1 → 2

- `CLOUD_UPLOAD_NOTICE_VERSION = 2`.
- setup 동의 문구에 Ollama Cloud가 수신자로 포함됨을 명시한다.
- 기존 v1 동의(Go/Zen에 한정)는 재동의 전까지 유효하지 않다. 기존 사용자는
  setup 재실행 시 재동의를 거친다.
- 근거: 수신자 집합이 실제로 바뀌었으므로 기존 동의를 재사용하면 동의 범위를
  벗어난다. 이 프로젝트의 안전 설계는 "명시적 클라우드 전송 동의"가 핵심이다.
- 선택: 사용자 명시 (Q2-A)

### D3. ollama-cloud의 json_schema 지원은 라이브 검증으로 확정

- 기본 분석(프롬프트 없음)은 `format: { type: "json_schema", schema:
  REPORT_SCHEMA }`로 구조화 리포트를 요구한다.
- ollama-cloud가 json_schema structured output을 지원하는지는 코드만으로
  확인할 수 없다. 사용자 승인 하에 라이브 스모크 테스트로 검증한다.
- 검증 방법: `scripts/live-smoke.mjs`에 `--ollama-model` 옵션을 추가하고
  `--allow-live`로 실행한다.
- 선택: 사용자 명시 (Q3-A)

**검증 결과 (2026-08-13): 미지원 확정**

- `ollama-cloud/gemma4:31b`, `ollama-cloud/qwen3.5:397b` 모두 json_schema
  프롬프트에서 "Model did not produce structured output" 오류를 반환했다.
- `ollama-cloud/kimi-k2.5`는 2026-07-31에 은퇴한 모델이라 410 오류가 나므로
  라이브 검증에 사용하지 않는다.
- 텍스트 모드 분석은 `gemma4:31b`, `qwen3.5:397b`, `minimax-m3` 모두 정상
  동작했다.

### D4. 텍스트 폴백은 provider별 정적 플래그

- 라이브 검증으로 "ollama-cloud는 json_schema 미지원"이 확인되었으므로,
  ollama-cloud 모델은 처음부터 텍스트 모드로 분석한다.
- 실패 후 재시도 폴백은 하지 않는다. 진짜 구조화 실패(모델 오류)를 텍스트로
  은폐하고 이미지 재전송 비용이 발생하기 때문이다.
- Go/Zen은 구조화 모드 유지.
- 선택: 사용자 명시 (Q4-A), 라이브 검증으로 확정 (D3)

## 비목표 (Non-goals)

- allowlist 일반화(모든 연결 provider 허용)
- config 기반 provider 확장 목록
- 로컬 ollama 지원
- 임의 provider URL 지원
- provider 자격 증명 관리 (OpenCode 소유 유지)

## 수용 기준 (Acceptance criteria)

- `doctor`가 ollama-cloud 연결 시 `ollama-cloud/<id>` 비전 모델을
  `image_models`에 포함한다. **검증 완료:** doctor가 ollama-cloud 연결 및
  비전 모델 8개를 보고했다.
- `setup`이 ollama-cloud를 provider 선택지로 표시하고, v1 동의 사용자는
  재동의 문구를 거친다. **검증 완료:** doctor가 `consent_valid: false`로
  보고해 v1 동의 무효화가 동작한다.
- `ollama-cloud/deepseek-v4-flash:0731` 같은 호출 모델이
  `CALLER_MODEL_UNVERIFIED`로 거부되지 않는다.
- `--model ollama-cloud/<id>` 분석이 구조화 또는 텍스트 모드로 성공한다.
  **검증 완료:** `ollama-cloud/gemma4:31b` 라이브 스모크에서 텍스트 폴백
  결과를 반환했다.
- `npm run check && npm test && npm run build` 통과.

## 라이브 검증 기록 (2026-08-13, 사용자 승인)

- 환경: OpenCode 1.18.16, 포트 4096의 기존 TUI 서버는 사용자 지시로 종료 후
  검증.
- `doctor`: connected = `["opencode-go", "ollama-cloud", "opencode"]`,
  image_models에 ollama-cloud 모델 8개 포함.
- `npm run test:live -- --allow-live --go-model opencode-go/gpt-5.6-luna
  --zen-model opencode/mimo-v2.5-free --ollama-model ollama-cloud/gemma4:31b`:
  Go/Zen 구조화 리포트 + Ollama Cloud 텍스트 폴백 모두 성공.
- json_schema 직접 호출: `gemma4:31b`, `qwen3.5:397b` 모두
  "Model did not produce structured output". `kimi-k2.5`는 2026-07-31 은퇴
  (410).

## 미결 / 위험

- 없음 (차단 항목 없음). ollama-cloud json_schema 미지원은 라이브 검증으로
  확정했다.
