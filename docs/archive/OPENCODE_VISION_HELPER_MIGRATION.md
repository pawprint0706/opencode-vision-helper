# `opencode-vision-helper` 독립 프로젝트 마이그레이션 계획

> 작성일: 2026-08-04  
> 원본 프로젝트: `orca-vision-helper`  
> 대상 프로젝트: `opencode-vision-helper`  
> 상태: 신규 독립 저장소를 만들기 위한 방향·범위·실행 계획

## 1. 목적

`orca-vision-helper`의 범용 vision fallback 아이디어와 검증된 이미지 분석 자산을
선별해, OpenCode CLI·데스크톱 앱·IDE 표면에서만 사용하는 독립 프로젝트
`opencode-vision-helper`로 이전한다.

새 프로젝트는 비전 입력을 지원하지 않는 OpenCode 모델이 로컬 이미지 분석이
필요할 때 명시적으로 호출하는 보조 도구다. 이미지를 OpenCode Go 또는 OpenCode
Zen의 비전 모델에 전달하고, 호출한 모델이 소비할 수 있는 텍스트 또는 구조화된
리포트를 반환한다.

이 작업은 현재 저장소를 인플레이스 개명하거나 Orca 지원을 계속 확장하는 작업이
아니다. 새 저장소를 만들고 필요한 코드·테스트·설계만 이관하며,
`orca-vision-helper`의 향후 유지·보관·폐기 정책은 별도로 결정한다.

## 2. 목표 사용자와 사용 시나리오

### 목표 사용자

- OpenCode CLI/TUI에서 이미지 입력을 처리하지 못하는 모델을 사용하는 사용자
- OpenCode 데스크톱 앱 또는 IDE 확장에서 같은 fallback이 필요한 사용자
- OpenCode Go 또는 Zen 계정과 모델을 이미 연결한 사용자

### 기본 시나리오

```text
OpenCode의 비전 없는 모델
  → vision_analyze custom tool 호출
      → opencode-vision-helper
          → 도구가 비활성화된 별도 비전 분석 세션
              → opencode-go/<vision-model> 또는 opencode/<vision-model>
                  → 텍스트/구조화 리포트 반환
  → 원래 모델이 리포트를 읽고 작업 계속
```

### 수동 CLI 시나리오

```text
opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>] [--json]
```

CLI는 독립 실행 인터페이스로 유지한다. OpenCode 안에서 모델이 자동 호출하는 경로는
얇은 native custom tool 또는 plugin adapter가 담당한다.

## 3. 범위

### v1 포함

- 이미 존재하는 로컬 이미지 파일 분석
- OpenCode Go와 OpenCode Zen만 지원
- OpenCode에 연결된 자격 증명과 provider 설정 재사용
- OpenCode 모델 ID 형식 사용
  - `opencode-go/<model-id>`
  - `opencode/<model-id>`
- 이미지 입력 modality 확인
- 이미지 크기·픽셀 제한, 다운스케일, 안전한 정적 이미지 정규화
- 기본 UI 문제 분석용 구조화 리포트
- 자유 형식 프롬프트와 원문 보존
- OpenCode CLI·데스크톱 앱에서 사용할 native tool adapter
- 외부 이미지 전송 전 OpenCode permission을 통한 승인 가능성
- Windows, macOS, Linux 설치·제거

### v1 제외

- Orca 전용 기능·문서·명명
- OpenAI, Anthropic, OpenRouter, Ollama, custom provider 직접 지원
- 임의 base URL과 임의 bearer token 등록
- 자체 provider CRUD와 setup wizard
- 자체 OS keyring 저장
- 화면 캡처, 데스크톱 제어, 브라우저 자동화
- 범용 하네스용 전역 agent rule 배포
- MCP 서버
- 비전 모델을 일반 코딩 에이전트나 장기 실행 subagent로 사용하는 기능

## 4. 핵심 설계 결정

### D1. 새 독립 저장소로 만든다

- 대상 저장소 이름은 `opencode-vision-helper`다.
- 기존 저장소의 history를 강제로 재작성하지 않는다.
- 재사용한 소스와 설계의 출처를 새 README 또는 소스 주석에 기록한다.
- 기존 MIT 라이선스와 필요한 저작권 고지를 유지한다.
- 초기 커밋은 scaffold, core migration, OpenCode integration처럼 의미 단위로 나눈다.

### D2. 사용자 인터페이스는 CLI를 유지한다

CLI는 수동 검증, 자동화, 문제 진단의 기준 인터페이스다. OpenCode custom tool은
CLI 계약과 같은 입력·출력을 제공하는 adapter로 취급한다.

MCP는 v1에 도입하지 않는다. 소비자가 OpenCode 하나이고 핵심 도구도 하나이므로,
OpenCode native tool보다 MCP의 상주 프로세스·등록·디버깅 비용이 더 크다.

### D3. 인증과 provider 상태는 OpenCode가 소유한다

새 프로젝트는 다음을 하지 않는다.

- 사용자 API 키 입력·저장·삭제
- OpenCode `auth.json`의 직접 수정
- OpenCode 키를 별도 keyring이나 설정 파일로 복사
- custom endpoint 또는 proxy credential 관리

OpenCode가 `/connect`로 등록한 Go/Zen 인증을 사용한다. 새 도구는 OpenCode
SDK/server가 보고하는 연결 provider와 model catalog만 소비한다.

### D4. 기본 경로는 raw Zen/Go HTTP가 아니라 OpenCode 런타임이다

OpenCode Zen은 모델에 따라 `/responses`, `/messages`, Gemini 계열 endpoint,
`/chat/completions`를 구분한다. 모든 모델을 하나의 OpenAI-compatible API로
일반화하지 않는다.

기본 구현은 OpenCode SDK 또는 실행 중인 OpenCode server에 별도 세션을 만들고,
다음을 명시한다.

- 선택한 `providerID`와 `modelID`
- text part와 image/file part
- 기본 분석일 때 JSON Schema output format
- 분석 세션의 모든 도구 비활성화
- 제한된 retry와 timeout/cancel 정책

이 방식으로 모델별 wire protocol, 인증, provider routing을 OpenCode에 위임한다.

### D5. 비전 분석 세션은 격리한다

분석용 세션에는 파일 편집, shell, web, task 및 `vision_analyze` 자체를 허용하지
않는다. 이미지와 prompt를 분석하고 결과만 반환해야 한다.

이 격리는 다음을 방지한다.

- 비전 모델이 `vision_analyze`를 다시 호출하는 재귀
- 이미지 안의 지시가 도구 실행으로 이어지는 prompt injection
- 단순 이미지 분석이 코드·파일 변경으로 확장되는 권한 상승

### D6. 도구는 비전 없는 OpenCode agent에만 노출한다

도구 설명만으로 사용 여부를 판단시키지 않는다. OpenCode agent permission을 사용해
적용 대상을 구성한다.

- 비전 없는 agent: `vision_analyze: "ask"` 또는 명시적 `allow`
- 비전 가능한 agent: `vision_analyze: "deny"`
- 민감 이미지 가능성이 있는 일반 환경: 기본값 `ask`

런타임에서도 선택된 분석 모델의 input modality에 `image`가 없으면 호출을 거부한다.

### D7. 구조화 출력과 자유 형식 출력을 분리한다

- 기본 분석: OpenCode SDK JSON Schema 검증과 제한된 retry 사용
- 자유 형식 `--prompt`: text 결과를 원문 그대로 반환
- 자유 형식 응답이 우연히 JSON이어도 report schema로 강제 변환하지 않음
- 구조화 결과가 끝까지 유효하지 않으면 오류와 원문 fallback을 명확히 구분

### D8. 캡처는 계속 범위 밖이다

도구는 이미 존재하는 파일만 분석한다. OpenCode UI, OS 또는 다른 도구가 생성한
스크린샷을 입력으로 받으며 자체 캡처 기능은 추가하지 않는다.

## 5. 권장 구현 형태

### 5.1 SDK-first 구조

OpenCode SDK가 JS/TS 우선이므로 새 저장소의 목표 구조는 TypeScript 기반 CLI와
OpenCode adapter를 우선 검토한다.

```text
opencode-vision-helper/
  src/
    cli.ts                 # analyze / doctor
    opencode-client.ts     # SDK/server session 호출
    imaging.ts             # 입력 제한, resize, 정규화
    report.ts              # JSON Schema와 출력 형식
    errors.ts              # 안정적인 CLI 오류 계약
    model-selection.ts     # Go/Zen + image modality 검증
  opencode/
    tools/
      vision-analyze.ts    # native custom tool adapter
    agents/
      vision-helper.md     # 선택 사항: 격리된 분석 agent 설정
  tests/
  scripts/
    install.*
    uninstall.*
  docs/
```

TypeScript 전환이 이미지 전처리 품질이나 CLI 배포성을 크게 떨어뜨린다면 다음
대안을 spike에서 비교한다.

1. Python 이미지 코어 + 작은 TypeScript SDK bridge
2. Python CLI가 `opencode run --file`을 호출하는 방식

두 번째 방식은 빠른 prototype에는 적합하지만 SDK의 JSON Schema output과 세션
제어를 충분히 활용하기 어려울 수 있으므로 기본안으로 확정하지 않는다.

### 5.2 CLI 계약

```text
opencode-vision-helper analyze <image>
    [--prompt <text>]
    [--model opencode-go/<id>|opencode/<id>]
    [--json]

opencode-vision-helper doctor
```

`analyze` 규칙:

- `--model`은 1회성 override이며 OpenCode 기본 모델을 변경하지 않는다.
- provider prefix는 `opencode-go` 또는 `opencode`만 허용한다.
- 분석 모델은 반드시 image input을 지원해야 한다.
- 기본 prompt일 때만 구조화 schema를 사용한다.
- custom prompt는 원문 text를 반환한다.
- 입력 경로가 worktree 밖이면 OpenCode permission과 OS 경로 검증을 모두 따른다.

`doctor` 규칙:

- OpenCode 설치·server/SDK 가용성 확인
- Go/Zen 연결 상태 확인
- 선택 모델 존재 여부와 image modality 확인
- 실제 이미지 업로드나 과금 요청은 하지 않음
- 키 값이나 `auth.json` 내용을 출력하지 않음

### 5.3 native custom tool 계약

도구 이름은 충돌 가능성이 낮은 `vision_analyze`를 사용한다.

입력 후보:

```json
{
  "image": "absolute-or-worktree-relative-path",
  "prompt": "optional question",
  "model": "optional opencode-go/... or opencode/..."
}
```

OpenCode 데스크톱 앱에서 첨부한 파일이 항상 사용자에게 의미 있는 로컬 경로로
노출되지 않을 수 있다. plugin adapter를 사용하는 경우 tool context의 session과
message ID로 현재 message의 file part를 조회해 `image` 인자를 생략할 수 있는지
spike에서 검증한다.

출력은 모델이 다시 읽기 쉬운 text를 기본으로 하며, 오류는 최소한 다음 필드를
포함하는 안정적인 JSON 또는 동등한 tool error로 반환한다.

```json
{
  "status": "error",
  "error_code": "MODEL_NOT_VISION_CAPABLE",
  "retryable": false,
  "message": "...",
  "next_action": "..."
}
```

## 6. 기존 프로젝트에서의 자산 이관

### 그대로 또는 개념적으로 재사용

- 이미지 입력 크기와 픽셀 수 제한
- 장축 기준 다운스케일 알고리즘
- PNG/JPEG 정규화 원칙
- 이미지 안의 지시를 신뢰하지 않는 분석 instruction
- UI 문제 분석용 summary/issues schema
- 오류 코드와 `retryable`/`next_action` 출력 개념
- 외부 전송과 민감 이미지에 대한 안전 원칙
- 외부 네트워크 없는 fake server·fixture 기반 테스트 방식

### 수정 후 재사용

| 기존 자산 | 새 프로젝트에서의 변경 |
|---|---|
| `imaging.py` | 언어에 맞게 port하고 `downscale=off`를 “무리사이즈”로 정확히 정의 |
| `report.py` | 임의 객체 보정을 제거하고 SDK JSON Schema 검증을 우선 사용 |
| `errors.py` | OpenCode SDK/server/session/model 오류 중심으로 단순화 |
| `cli.py` | `analyze`, `doctor`만 남기고 provider CRUD 제거 |
| `config.py` | 자체 provider registry 제거, 최소 model 선택만 허용하거나 OpenCode 설정으로 흡수 |
| 설치 테스트 | 문구 검사가 아니라 실제 파일 소유권·rollback 동작 테스트로 전환 |

### 이관하지 않음

- `auth.py`와 keyring 의존성
- 다중 provider catalog
- OpenAI-compatible, Anthropic, Ollama 직접 backend
- `setup`, `provider add/update/remove/list`
- custom base URL과 keyless gateway 지원
- Orca 전용 agent discovery rule
- Codex, Claude, Cursor 대상 설치·제거 안내
- VGMCP 또는 Orca 조사 기록 중 새 범위와 무관한 부분

## 7. 기존 리뷰 항목의 처리 계획

`PROJECT_REVIEW_2026-08-04.md`에서 확인한 항목은 다음처럼 처리한다.

| 리뷰 항목 | 마이그레이션 처리 |
|---|---|
| R1 전역 명령 소유권 | 새 installer/uninstaller가 exact target/content를 검증하도록 필수 반영 |
| R2 키체인 삭제 실패 | 자체 키 저장·삭제를 제거해 구조적으로 해소 |
| R3 유형 변경 후 키 재사용 | provider 변경/custom URL 기능을 제거해 구조적으로 해소 |
| R4 자유 형식 JSON 손실 | text 경로를 구조화 parser보다 먼저 분리 |
| R5 불완전 JSON 승인 | SDK JSON Schema validation과 required field 사용 |
| R6 설정 의미 검증 | 최소 설정만 유지하고 model prefix/modality/range를 엄격히 검증 |
| R7 XDG 제거 불일치 | 별도 config를 최소화하고 OpenCode 경로와 설치 manifest를 단일 기준으로 사용 |
| R8 부분 실패 rollback | 설치 preflight와 staged install/rollback 테스트 필수화 |
| R9 문서 불일치 | 지연 시간을 보장값으로 쓰지 않고 정규화 동작을 정확히 기술 |

## 8. 설치·제거 원칙

새 프로젝트가 OpenCode 전역 설정 아래에 파일을 추가하는 경우 사용자 승인을
받고 정확한 소유권을 기록한다.

권장 방식:

- 설치 manifest에 프로젝트가 생성한 exact path와 content hash 기록
- 기존 동명 tool, plugin, command를 절대 덮어쓰지 않음
- 충돌 검사는 패키지 설치·설정 변경보다 먼저 수행
- 설치 중 실패하면 이번 실행에서 만든 파일만 rollback
- 제거 시 manifest와 현재 파일 내용을 대조
- 사용자가 수정했거나 다른 설치가 소유한 파일은 삭제하지 않고 중단
- OpenCode의 다른 설정과 인증 파일은 제거 대상에 포함하지 않음
- package 제거와 tool/agent 제거 범위를 분리해 선택 가능하게 함

OpenCode 설정 파일 전체를 생성하거나 덮어쓰지 않는다. 필요한 permission 안내는
사용자가 병합할 수 있는 최소 snippet과 안전한 merge 절차로 제공한다.

## 9. 보안·개인정보 원칙

- cloud 분석은 선택한 이미지가 OpenCode Go/Zen에 전송됨을 명확히 고지
- 일반 설치 동의와 민감 이미지 1건의 업로드 승인을 구분
- native tool permission 기본 권장값은 `ask`
- OpenCode credential을 로그, 오류, 환경 dump에 포함하지 않음
- raw `auth.json`을 직접 읽어야 하는 fallback은 기본 설계에 포함하지 않음
- 심볼릭 링크와 정규화된 절대 경로를 검증해 의도하지 않은 파일 전송 방지
- 최대 파일 크기와 최대 픽셀 수를 decode 전에 가능한 범위까지 확인
- SVG, PDF, 동영상, 애니메이션은 v1에서 거부하거나 명시적 첫 프레임 정책을 문서화
- 이미지와 비전 응답은 모두 untrusted data로 취급
- 분석용 OpenCode 세션에서는 모든 tool 실행을 차단
- 오류 메시지에 이미지 base64, request header, credential path 내용을 포함하지 않음

## 10. 단계별 마이그레이션

### Phase 0. 기술 spike와 결정 확정

목표:

- OpenCode SDK로 Go와 Zen 비전 모델 각각 1개 호출
- local file 또는 data URL file part 전달
- JSON Schema structured output 확인
- 모든 tool이 비활성화된 격리 세션 확인
- OpenCode CLI와 데스크톱 앱 custom tool에서 동일 경로 확인
- timeout, cancel, provider auth 오류 형태 확인
- GUI 첨부 파일의 message file part 접근 가능성 확인

완료 조건:

- raw Zen/Go API 없이 양쪽 provider에서 이미지 분석 성공
- SDK-first 단일 runtime 또는 Python+bridge 중 구현 스택 결정
- Go의 공개되지 않은 endpoint 가정에 의존하지 않음

### Phase 1. 새 저장소 scaffold

- 새 저장소와 패키지 이름 생성
- LICENSE, README 초안, 개발 지침, formatter/linter/test runner 설정
- CI에서 Windows, macOS, Linux 또는 현실적인 최소 플랫폼 matrix 정의
- release artifact와 설치 소유권 manifest 형식 정의

### Phase 2. 이미지·리포트 코어 이관

- 입력 파일 검증과 전처리 port
- 기본 prompt와 trust boundary port
- JSON Schema 기반 report 정의
- 자유 형식 text 경로 분리
- 오류 taxonomy와 CLI exit code 확정
- 기존 fixture를 새 언어·구조에 맞게 이전

### Phase 3. OpenCode 연동

- provider/model catalog 조회
- Go/Zen prefix 제한
- image modality 검증
- 격리 세션 생성과 종료/정리 정책
- structured output와 retry
- SDK/server 오류 매핑
- 비용·모델·provider 메타데이터의 최소 출력 결정

### Phase 4. CLI 완성

- `analyze`
- `doctor`
- human text와 `--json` 출력 계약
- UTF-8 stdio와 Windows 경로 검증
- cancellation과 timeout
- 외부 제공자 호출 없는 integration test server 또는 SDK mock

### Phase 5. OpenCode native adapter

- 전역 또는 프로젝트별 custom tool
- 필요하면 SDK client를 직접 받는 plugin adapter
- agent permission 예시
- desktop attachment 경로 처리
- tool recursion 차단 테스트
- 비전 가능한 agent에서 도구를 deny하는 설정 예시

### Phase 6. 설치·제거와 문서

- 플랫폼별 installer/uninstaller
- preflight, exact ownership, rollback 실행 테스트
- OpenCode `/connect` 선행 조건
- CLI 사용법과 native tool 등록법
- 이미지 전송·과금·민감정보 안내
- 기존 `orca-vision-helper`와의 차이 및 병행 설치 정책

### Phase 7. 전환 검증과 원본 프로젝트 처리

- 대표 비전 없는 OpenCode 모델에서 end-to-end 검증
- Go와 Zen 각각 최소 1개 비전 모델 검증
- CLI, TUI/custom tool, desktop 흐름 검증
- 새 프로젝트 release 후 원본 저장소의 유지·archive·deprecated 여부 별도 결정
- 원본 삭제나 사용자 설치 제거는 별도의 명시적 승인 없이는 수행하지 않음

## 11. 테스트 전략

### 단위 테스트

- 이미지 크기, 픽셀 수, 포맷, 손상 파일
- resize on/off와 출력 크기
- model ID prefix와 modality 검증
- 자유 형식 text 보존
- strict report schema
- SDK 오류 → 안정적인 error code 매핑
- 경로 정규화와 symlink 처리

### 통합 테스트

- fake OpenCode server를 사용한 session create → prompt → result
- file part와 JSON Schema request 형식
- structured output 실패와 제한된 retry
- timeout/cancel
- 도구 비활성화와 재귀 호출 방지
- CLI `analyze`/`doctor` exit code와 stdout/stderr 계약

### 설치·제거 테스트

- 외부 설치가 소유한 동명 command/tool/plugin 보존
- 수정된 설치 파일 보존과 비정상 종료
- 부분 설치 실패 rollback
- Windows 줄바꿈과 shim exact match
- POSIX symlink real target 확인
- OpenCode auth/config가 제거 후에도 변경되지 않음

### 선택적 실제 연동 테스트

- 명시적 credential·비용·이미지 전송 승인이 있는 환경에서만 실행
- Go와 Zen 각각 고정된 소형 fixture 사용
- 모델 ID와 응답 시간은 보장값으로 고정하지 않음
- CI 기본 경로에서는 외부 provider를 호출하지 않음

## 12. 완료 기준

v1 마이그레이션은 다음 조건을 모두 만족하면 완료로 본다.

- 새 독립 저장소와 패키지가 `opencode-vision-helper` 이름을 사용
- 사용자-facing 문서와 코드에 필수적인 경우를 제외하고 Orca 의존·명명 제거
- CLI `analyze`와 `doctor`가 Windows, macOS, Linux의 지원 환경에서 동작
- OpenCode Go와 Zen의 image-capable model을 OpenCode 런타임을 통해 호출
- OpenCode에 등록된 인증을 복사·수정·삭제하지 않음
- raw custom base URL과 provider CRUD가 존재하지 않음
- 기본 구조화 출력이 schema validation을 통과
- 자유 형식 응답이 원문 그대로 보존
- 분석 세션에서 모든 tool이 비활성화되고 재귀 호출이 불가능
- OpenCode native custom tool이 비전 없는 agent에서 호출 가능
- tool permission으로 `ask`/`allow`/`deny`를 구성 가능
- 설치·제거가 다른 설치의 파일을 덮어쓰거나 삭제하지 않음
- 외부 provider 없는 전체 자동 테스트와 정적 검사가 통과
- 승인 없는 실제 credential 접근·설치·제거·cloud 이미지 전송이 없음

## 13. MCP 재검토 조건

다음 중 하나 이상이 실제 요구가 될 때 별도 설계로 검토한다.

- OpenCode 외 여러 클라이언트가 같은 도구를 사용해야 함
- 이미지 분석 외에 여러 tool/resource/prompt를 제공함
- 장기 실행 프로세스, 공유 캐시, 원격 배포가 필요함
- OpenCode native tool/plugin API로 충족하기 어려운 표준화 요구가 생김

그 전까지 MCP는 보류하며 CLI와 OpenCode native adapter를 기준 구현으로 유지한다.

## 14. 선행 확인이 필요한 쟁점

구현을 시작하기 전에 Phase 0에서 다음을 확정해야 한다.

1. 최종 구현 언어와 배포 형식: TypeScript 단일 runtime 또는 Python+SDK bridge
2. OpenCode SDK가 실행 중인 desktop session의 file part를 plugin에서 안정적으로 조회하는 방법
3. 분석 세션을 child session으로 보존할지 완료 후 삭제할지
4. 기본 vision model을 고정할지 사용자 설정으로 둘지
5. `ask`를 installer 권장값으로만 둘지 자동 병합 가능한 permission snippet을 제공할지
6. 별도 설정 파일 없이 OpenCode config 또는 환경 변수만으로 model 선택을 표현할 방법

이 결정들은 provider 범위를 다시 넓히지 않는 한 v1 경계를 바꾸지 않는다.

## 15. 공식 참고 자료

- [OpenCode 소개](https://opencode.ai/docs/)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [OpenCode Zen 모델별 endpoint](https://opencode.ai/docs/zen/)
- [OpenCode Agents와 permissions](https://opencode.ai/docs/agents/)

공식 문서는 변경될 수 있으므로 구현 시작과 release 전에 현재 OpenCode 버전의
SDK 타입, model catalog, custom tool/plugin API를 다시 확인한다.

