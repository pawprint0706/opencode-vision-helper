# 공개 배포 및 최초 설정 TODO

작성 기준일: 2026-08-05

이 문서는 다음 사용자 경험을 최종 목표로 삼는다.

```text
npm install -g @pawprint0706/opencode-vision-helper
  -> opencode-vision-helper setup
  -> 클라우드 전송 동의
  -> vision_analyze 권한 ask/allow 선택
  -> OpenCode Zen 또는 Go와 이미지 입력 가능 모델 선택
  -> 설정 저장 및 OpenCode 전역 플러그인 등록
  -> CLI와 OpenCode의 vision_analyze 도구에서 사용
```

`Zen`은 OpenCode provider ID `opencode`, `Go`는 `opencode-go`에 대응한다.
OpenCode는 계속 인증, provider 연결, 모델 라우팅을 소유한다. 이 패키지는 API
키나 OpenCode 자격 증명을 읽거나 복사하거나 수정하지 않는다. `setup` 자체는
이미지를 전송하거나 유료 모델을 호출하지 않아야 한다.

## 완료 조건

- [ ] 깨끗한 환경에서 `npm install -g @pawprint0706/opencode-vision-helper`가
  CLI 실행 파일을 설치한다.
- [ ] README의 Quick start만 따라 최초 설정을 완료할 수 있다.
- [ ] `opencode-vision-helper setup`이 동의, 권한, provider, 모델을 순서대로
  선택받고 중단/거절을 안전하게 처리한다.
- [ ] 설정을 다시 실행해도 중복 플러그인, 중복 설정, 설정 손상이 생기지 않는다.
- [ ] 설정 후 CLI는 저장된 모델을 기본값으로 사용한다.
- [ ] OpenCode를 다시 시작하면 전역 `vision_analyze` 도구가 보인다.
- [ ] 일반 모드에서 override가 없을 때 `ask`는 매 호출 승인 UI를 표시하고
  `allow`는 별도 승인 없이 실행된다.
- [ ] 이미지 입력 가능 caller는 현재와 같이 `CALLER_VISION_CAPABLE`로 거절되고,
  분석 세션에서는 모든 도구가 비활성화된다.
- [ ] 설치, 재설정, 업그레이드, 제거가 사용자의 다른 OpenCode 설정과 플러그인을
  보존한다.
- [x] 기본 자동 테스트는 실제 provider 호출, 이미지 업로드, 자격 증명 접근을 하지
  않는다.

## 현재 구현과 차이

| 항목 | 현재 상태 | 필요한 변화 |
| --- | --- | --- |
| 전역 CLI | `bin`과 packed-artifact 테스트가 있음 | scoped 공개 패키지로 변경하고 실제 registry 설치 검증 |
| npm 배포 | scoped 이름과 공개 배포 메타데이터 적용 완료 | 실제 registry publish 및 clean install 검증 |
| 최초 설정 | 대화형 `setup`, 전역 등록, 설정 조회/동의 철회 구현 | 수동 fallback UX 추가 |
| 업로드 동의 | CLI/native 저장 동의 사용과 조회·철회 구현 | 실제 설치 환경 검증 |
| provider/모델 선택 | setup 저장, CLI/plugin 사용, doctor drift 진단 구현 | 실제 Go/Zen 검증 |
| 기본 모델 | override 우선순위와 doctor drift 진단 구현 | 실제 설치 환경 검증 |
| OpenCode 등록 | 제한적 병합, ownership manifest, exact 제거 구현 | 수동 fallback 완성 |
| 권한 설정 | 선택·병합·drift 진단과 제거 시 원래 값 복원 구현 | 수동 fallback 완성 |
| 제거/업그레이드 | 직접 등록과 legacy wrapper가 각각 exact ownership을 검증해 제거 | package upgrade lifecycle 검증 |

## 먼저 결정할 제품 정책

### P0. OpenCode 등록 방식

- [x] 공개 패키지의 권장 등록 방식은 전역 `opencode.json`의 `plugin` 배열에
  scoped 패키지 루트 `@pawprint0706/opencode-vision-helper`를 등록하는 것으로
  확정한다.

  OpenCode 1.18.13과 현재 upstream loader를 대조한 결과, npm spec에는 package
  subpath를 붙이지 않는다. 패키지의 `exports["./server"]`가 OpenCode server plugin
  entry인 `dist/plugin.js`를 가리키게 한다. OpenCode는 scoped npm package를 설치한
  뒤 이 entry를 로드한다.

  목표 설정 조각은 다음과 같다.

  ```json
  {
    "plugin": ["@pawprint0706/opencode-vision-helper"],
    "permission": {
      "vision_analyze": "ask"
    }
  }
  ```

- [x] package root의 일반 library export는 유지하고 `./server` export를 별도로
  추가한다. OpenCode 1.18.13 loader의 legacy named-function 호환 경로를 이용하므로
  기존 `VisionHelperPlugin` export도 유지한다. 실제 packed package를 OpenCode에서
  불러오는 통합 테스트를 release gate로 둔다.

- [x] 기존 wrapper installer는 공개 배포 전환 기간 동안 개발 checkout 및 구버전
  호환용으로 유지하되 일반 사용자 README에서는 npm 직접 등록만 안내한다. npm 직접
  등록의 세 운영체제 검증이 끝난 뒤 별도 버전에서 deprecate 여부를 다시 판단한다.
- [x] 직접 등록과 wrapper가 동시에 로드되어 도구가 중복 등록되지 않도록 감지한다.
  setup은 같은 global config directory의 legacy wrapper를 차단한다. 임의 프로젝트의
  local wrapper는 현재 작업 디렉터리에서 doctor가 ownership manifest와 함께 진단한다.

참고: [OpenCode Plugins](https://opencode.ai/docs/plugins/)

### P0. OpenCode 설정 수정 경계

현재 저장소 규칙은 사용자의 OpenCode config를 덮어쓰지 않고 mergeable snippet을
제공하도록 요구한다. `setup`은 전체 파일을 교체하지 않으며 사용자가 최종 화면에서
명시적으로 승인한 두 설정 조각만 병합한다.

- [x] **수동 fallback:** `setup`은 helper 전용 설정만 저장하고,
  `plugin`/`permission` snippet과 대상 파일을 보여 준 뒤 사용자가 병합하도록 한다.
  이 경로는 자동 병합 안전조건을 만족하지 못할 때 사용하며, 사용자가 병합 완료를
  확인하고 read-only 검증이 정확한 단일 등록과 legacy 중복 부재를 확인하기 전에는
  setup을 완전 성공으로 표시하지 않는다.
- [x] **기본 제한적 병합:** `plugin` 배열의 정확한 한 항목과
  `permission.vision_analyze`만 원자적으로 병합한다. setup 최종 확인 화면에 대상
  파일과 mergeable snippet을 먼저 표시한다. 다른 키, 주석, 순서, 줄바꿈을 보존하지
  못하면 파일을 수정하지 않고 위 수동 fallback으로 전환한다.

제한적 병합을 허용하더라도 다음 조건은 필수다.

- [x] `opencode.json`과 `opencode.jsonc`를 모두 인식한다. 둘 다 있으면 어느 파일도
  임의 선택하지 않고 수동 정리를 요구한다.
- [x] `jsonc-parser`의 최소 편집을 사용해 JSONC 주석, trailing comma, BOM, 기존
  줄바꿈과 들여쓰기를 보존한다.
- [x] symlink, 비정규 파일, 읽기 전용 파일, parse 오류, 동시 변경을 감지하면 쓰지
  않는다.
- [x] 기존 `plugin` 항목과 `permission.vision_analyze` 값을 먼저 보여 주고 충돌 시
  명시적으로 확인받는다.
- [x] 전체 config를 새 JSON으로 serialize해서 덮어쓰지 않는다.
- [x] 임시 파일과 atomic rename을 사용하고, 쓰기 직전 원본 hash를 다시 확인한다.
- [x] manifest에는 도구가 추가하거나 명시적으로 바꾼 정확한 항목/값과 원래 권한만
  기록하며 다른 설정을 소유했다고
  간주하지 않는다.
- [x] `unregister`는 현재 값이 manifest와 정확히 일치할 때만 해당 항목을 제거한다.
- [x] 조직 관리 설정, 프로젝트 설정, agent 설정이 전역값을 override할 수 있음을
  결과 화면에 알린다.

OpenCode는 JSON과 JSONC를 모두 지원하며 여러 위치의 설정을 병합한다.
[OpenCode Config](https://opencode.ai/docs/config/)

### P0. 1회 클라우드 동의의 의미

- [x] `setup`에서 받는 동의는 versioned informed consent로 저장한다. 동의가 유효한
  동안 사용자가 직접 실행한 `opencode-vision-helper analyze <image>`는 선택한
  이미지의 이번 전송을 요청한 것으로 간주한다. 따라서 정상 setup을 마친 CLI
  사용자는 매번 `--allow-upload`를 반복하지 않아도 된다.

- [x] 동의 문구에 최소한 다음을 표시한다.

  - 선택한 이미지가 OpenCode Go 또는 Zen의 클라우드 모델로 전송됨
  - provider 비용과 provider의 보존/개인정보 정책이 적용될 수 있음
  - 이미지 안의 텍스트는 신뢰하지 않으며 분석 세션의 모든 도구가 꺼짐
  - 동의를 거절하면 설정과 설치를 중단하고 이미지를 전송하지 않음

- [x] 저장 동의와 OpenCode runtime permission은 서로 다른 안전장치로 유지한다.

  - CLI는 유효한 저장 동의 또는 이번 실행의 `--allow-upload` 중 하나를 요구한다.
  - OpenCode native tool은 유효한 저장 동의를 먼저 확인한 뒤 기존
    `context.ask({ permission: "vision_analyze", ... })`를 항상 호출한다.
  - OpenCode `ask`는 모델 호출마다 UI 승인을 요구한다.
  - OpenCode `allow`는 setup에서 경고와 2차 확인을 거친 사용자가 선택한 지속적
    자동 승인이다.

- [x] 기존 `--allow-upload`는 삭제하지 않고 **현재 CLI 실행 한 번만의 명시 동의**로
  유지한다. 저장 동의가 없거나 만료된 경우에도 이 flag가 있으면 해당 CLI 분석은
  실행할 수 있지만 동의 상태를 파일에 저장하거나 OpenCode plugin 설치를 완료하지
  않는다. 기존 사용자와 CI는 이 경로를 계속 사용할 수 있다.
- [x] `--allow-upload`는 native tool의 동의나 permission을 대신하지 않는다. native
  tool은 CLI process flag를 볼 수 없으므로 setup에서 저장한 동의가 없으면
  `CONSENT_REQUIRED`로 fail closed한다.
- [x] `config reset-consent`를 공식 철회 명령으로 제공한다. `setup --reset`은 전체
  재설정 UX로 제공할 수 있지만 동의 철회 기능의 유일한 진입점으로 만들지 않는다.
- [x] 동의 문구 버전 `noticeVersion`과 `acceptedAt`을 저장한다. 현재 코드가 요구하는
  version과 다르거나 timestamp/schema가 유효하지 않으면 동의가 없는 것으로
  처리하고 재동의를 받는다.
- [x] `--yes`와 일반 환경 변수는 동의를 우회하지 못한다. 비대화형 setup을 추후
  지원할 때도 `--accept-cloud-upload-notice <version>`처럼 의도가 명확하고 version이
  일치하는 전용 flag를 model/permission 선택 flag와 함께 요구한다.
- [x] setup과 consent reset은 이미지 파일을 열거나 분석 session을 만들거나 provider
  prompt를 보내지 않는다. provider/model discovery는 OpenCode가 노출하는 연결 및
  capability metadata만 사용한다.

확정된 CLI 판정표:

| 저장 동의 | `--allow-upload` | CLI 분석 | 동의 저장 변경 |
| --- | --- | --- | --- |
| 유효 | 없음 | 허용 | 없음 |
| 유효 | 있음 | 허용 | 없음 |
| 없음/만료 | 있음 | 이번 실행만 허용 | 없음 |
| 없음/만료 | 없음 | `CONSENT_REQUIRED`로 거절 | 없음 |

확정된 native tool 판정표:

| 저장 동의 | OpenCode permission | native 분석 |
| --- | --- | --- |
| 유효 | `ask` | 매번 승인 후 허용 |
| 유효 | `allow` | 별도 UI 없이 허용 |
| 유효 | `deny` 또는 상위 override | 거절/도구 미노출 |
| 없음/만료 | 값과 무관 | permission 요청 전에 `CONSENT_REQUIRED`로 거절 |

### P0. 권한 선택의 의미

- [x] setup의 기본 선택은 `ask`로 하고 **권장** 표시를 붙인다. 사용자가 Enter만
  누르면 `ask`가 선택되어야 한다.
- [x] `allow`에는 이후 모델이 `vision_analyze`를 호출할 때 확인 UI 없이 이미지가
  업로드될 수 있다는 추가 경고와 2차 확인을 둔다. 첫 선택만으로 저장하지 않는다.
- [x] 대화형 2차 확인은 기본값을 거절로 둔다. 비대화형 setup에서 `allow`를
  선택하려면 `--permission allow` 외에 `--confirm-automatic-uploads` 같은 별도의
  명시 flag를 함께 요구한다. 일반 `--yes`는 이를 대신하지 못한다.
- [x] 선택값은 global OpenCode config의 `permission.vision_analyze`와 helper 설정의
  `openCode.permission`에 함께 기록한다. 실제 실행 시 OpenCode config가 권한 판정의
  authoritative source이고 helper 값은 setup 재실행 및 doctor의 drift 진단에만
  사용한다.
- [x] 선택값은 전역 기본값일 뿐이며 project/agent/managed 설정이 override할 수
  있음을 setup 결과에 표시한다. helper 저장값과 OpenCode의 resolved permission이
  다르면 `doctor`가 `permission_drift`를 보고해야 한다.
- [x] OpenCode auto mode에서는 `ask` 요청이 자동 승인될 수 있고 명시적 `deny`는
  그대로 유지된다는 점을 setup 결과와 README에 표시한다. 따라서 `ask`를 어떤
  실행 모드에서도 UI가 반드시 나타난다는 보장으로 표현하지 않는다.
- [x] 현재 tool 내부의
  `context.ask({ permission: "vision_analyze", patterns: [model] })` 호출은 유지한다.
  setup 선택을 근거로 이 런타임 안전장치를 제거하거나 plugin 내부에서 임의로
  `allow` 처리하지 않는다.
- [x] 기존 global 값이 `deny`, 다른 scalar, 또는 지원하지 않는 granular object이면
  자동 교체하지 않는다. 현재 값, 새 값, 영향을 보여 주고 사용자가 명시적으로
  교체를 승인해야 하며 안전하게 patch할 수 없으면 수동 snippet으로 전환한다.
- [x] setup 선택지는 목표 범위대로 `ask`와 `allow`만 제공한다. 사용자는 설치 후
  OpenCode config에서 `deny`를 설정해 도구를 숨길 수 있으며 uninstall 없이도
  비활성화할 수 있다.

확정된 권한 의미:

| 설정/상태 | 예상 동작 |
| --- | --- |
| global `ask`, 일반 모드, override 없음 | 모델 호출마다 OpenCode 승인 UI 표시 |
| global `ask`, auto mode | 명시적 deny가 없으면 OpenCode가 자동 승인할 수 있음 |
| global `allow`, override 없음 | 승인 UI 없이 호출 허용 |
| project/agent/managed `deny` | 전역 선택과 무관하게 거절되거나 도구 미노출 |
| helper 값과 resolved 값 불일치 | OpenCode 동작을 따르고 doctor가 drift 경고 |

참고: [OpenCode Permissions](https://opencode.ai/docs/permissions/)

## 사용자가 배포 전에 준비할 사항

### npm 및 릴리스 소유권

- [ ] npm 계정 `pawprint0706`이 존재하고 해당 scope에 publish할 권한이 있는지
  확인한다.
- [ ] 패키지 이름 `@pawprint0706/opencode-vision-helper`의 사용 가능 여부 또는 현재
  소유권을 확인한다.
- [ ] npm publish용 2FA를 활성화한다.
- [ ] 최초 배포 방식을 수동 `npm publish --access public` 또는 CI trusted
  publishing 중 선택한다.
- [ ] CI 배포를 선택하면 GitHub Actions OIDC trusted publisher, 최소 권한,
  provenance, 보호된 release/tag 절차를 설정하고 장기 publish token은 두지 않는다.
- [x] semver, changelog, Git tag, GitHub Release, deprecation/rollback 정책을 정한다.

공개 scoped 패키지의 최초 publish에는 public access 지정이 필요하다.
[npm scoped public package 문서](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)

### 지원 및 사용자 고지

- [x] 최소 Node.js 버전과 지원 OpenCode 기준을 확정한다. Node.js 요구사항은 20+,
  테스트한 SDK/plugin baseline은 OpenCode 1.18.13이며 업그레이드 후 doctor 검증을
  요구한다.
- [ ] Windows, macOS, Linux에서 전역 npm bin과 OpenCode global config 경로를
  확인한다.
- [x] OpenCode Go/Zen 연결은 사용자가 OpenCode `/connect`로 수행해야 한다는 점을
  명시한다.
- [x] 이미지 전송, 비용, 지원 포맷/크기, 세션 정리, 로그에 포함될 수 있는 정보,
  책임 범위를 README 또는 별도 privacy 문서에 적는다.
- [x] 사용자 지원 채널, issue template, security reporting 방법을 준비한다.

## 코드 변경 TODO

### P1. 패키지 공개 준비

- [x] `package.json` 이름을 `@pawprint0706/opencode-vision-helper`로 변경한다.
- [x] `private: true`를 제거한다.
- [x] `publishConfig.access: "public"`을 추가한다.
- [x] `repository`, `homepage`, `bugs`, `keywords`, `author` 등 registry 메타데이터를
  실제 값으로 추가한다.
- [x] `package-lock.json`의 root package 이름을 갱신한다.
- [x] wrapper import, dependency snippet, package 검증 경로 등 하드코딩된 unscoped
  package 이름을 전부 scoped 이름으로 바꾼다.
- [x] ownership ID와 npm package ID를 분리한다. 기존 manifest owner
  `opencode-vision-helper`는 설치 소유권 식별자로 유지할 수 있지만 dependency key와
  혼용하지 않는다.
- [x] 일반 library `.`와 호환용 `./plugin` export를 유지하고, OpenCode loader용
  `./server` export를 추가한다.
- [x] `files` allowlist를 `dist`, wrapper, adapter install/uninstall runtime으로
  제한하고 `npm pack --dry-run`으로 검사한다. live-smoke와 내부 package verification
  스크립트는 tarball에서 제외한다. 이후 setup 전용 runtime/template가 추가되면 같은
  packed-artifact gate에서 포함 여부를 계속 검증한다.
- [x] install-time lifecycle script(`postinstall`)는 추가하지 않는다. 전역 npm 설치만으로
  OpenCode 설정을 몰래 바꾸거나 네트워크 분석을 실행하지 않는다.

주요 영향 파일:

- `package.json`, `package-lock.json`
- `opencode/plugins/vision-helper.ts`
- `scripts/install-lib.mjs`, `scripts/verify-package.mjs`
- `README.md`, `docs/OPENCODE.md`, `docs/VALIDATION.md`
- package 이름을 기대하는 installer/tool 테스트

### P1. helper 설정 모듈

- [x] `src/config.ts`에 경로 결정, strict schema 검증, consent 판정, revision read와
  atomic write를 모은다. schema 1이 최초 버전이므로 migration은 아직 없으며 미래
  schema는 fail closed한다.
- [x] 설정 경로를 helper가 소유하는
  `~/.config/opencode-vision-helper/config.json`으로 확정하고 주입한 home/custom path를
  테스트한다. OpenCode config/auth 파일과 분리한다.
- [x] 다음과 같은 versioned schema를 정의한다.

```json
{
  "schema": 1,
  "consent": {
    "cloudUpload": true,
    "noticeVersion": 1,
    "acceptedAt": "ISO-8601 timestamp"
  },
  "openCode": {
    "permission": "ask",
    "model": "opencode-go/example-vision-model"
  }
}
```

동의를 철회한 상태는 다른 선택을 보존하기 위해 `"consent": { "cloudUpload": false }`
로 저장한다. 동의한 상태만 `noticeVersion`과 `acceptedAt`을 가진다.

- [x] 허용되지 않은 provider, 비어 있는 model, 알 수 없는 permission, 미래 schema를
  fail closed로 거절한다.
- [x] schema는 API key, token, provider credential, 이미지 경로와 분석 결과 필드를
  허용하지 않는다.
- [x] helper 디렉터리는 생성 시 0700, 설정/lock/temp 파일은 0600으로 만들고
  symlink/비정규 대상은 거절한다.
- [x] writer lock, revision 재확인, 임시 파일 + atomic rename으로 저장하고 실패 시
  기존 설정을 보존한다.
- [x] 동시 writer lock, stale revision, 손상된 JSON, 미래 schema 거절을 테스트한다.
  실제 이전 schema가 생기면 해당 버전 migration fixture를 추가한다.
- [x] CLI 우선순위는 `--model > OPENCODE_VISION_MODEL > 저장된 기본 모델`, native
  tool은 `tool 인자 > plugin option > OPENCODE_VISION_MODEL > 저장된 기본 모델`로
  확정하고 공통 resolver를 사용한다.

### P1. 대화형 `setup` 명령

- [x] `opencode-vision-helper setup`을 CLI parser와 help에 추가한다.
- [x] no-argument 실행은 기존처럼 help를 표시하고, 최초 설정은 명시적인 `setup`
  명령으로만 시작하도록 결정한다.
- [x] 입력/출력/TTY를 주입 가능한 서비스로 분리해 prompt 테스트가 실제 터미널에
  의존하지 않게 한다.
- [x] 비대화형 터미널에서는 필요한 선택을 명확한 오류로 반환한다. 추후 자동화용
  flags를 제공하더라도 클라우드 동의는 별도 명시 flag 없이는 성립하지 않게 한다.
- [x] 순서를 다음과 같이 고정한다.

  1. OpenCode 실행 가능 여부와 버전 확인
  2. 클라우드 전송 안내 및 동의
  3. `ask` 또는 `allow` 선택
  4. 연결된 `opencode`/`opencode-go` provider 조회
  5. 선택 provider의 `capabilities.input.image === true` 모델만 표시
  6. 선택 결과 요약 및 최종 확인
  7. helper 설정 원자적 저장
  8. OpenCode 전역 등록 또는 안전한 수동 병합 안내
  9. 재시작과 검증 명령 출력

- [x] 위 1~9를 연결했다. setup은 helper 설정 저장 후 제한적 전역 병합을 수행하고,
  사전 안전검사가 실패하면 수동 fallback으로 전환한다. 쓰기 단계 등록 실패 시에는
  helper 설정이 남았음을 오류 stage와 함께 명시한다.
- [x] 연결된 Go/Zen provider가 없으면 `/connect` 안내 후 아무 설정도 설치하지 않고
  종료한다. 자격 증명 파일을 직접 찾거나 읽지 않는다.
- [x] 이미지 모델이 없으면 provider 상태와 해결 방법만 보여 주고 종료한다.
- [x] provider/모델 목록은 정렬하고 사람이 읽을 label과 실제 ID를 함께 보여 준다.
- [x] 설정 중 `Ctrl+C`, EOF, 거절, OpenCode timeout을 안정적인 오류와 exit code로
  처리한다.
- [x] 거절은 쓰기 없이 종료하고, `Ctrl+C`와 EOF는 `SETUP_CANCELED` 오류로 변환한다.
  OpenCode timeout의 실제 터미널 회귀 검증은 남아 있다.
- [x] 재실행 시 기존의 유효한 동의를 유지하고 현재 permission/provider/model을
  기본 선택으로 표시하며, 결과가 같으면 설정 파일을 다시 쓰지 않는다.
- [ ] `setup --json`을 제공한다면 prompt를 섞지 말고 기계 판독 가능한 결과만
  stdout에 출력한다.

### P1. CLI 설정 사용

- [x] `analyze`가 명시 model/env가 없을 때 저장된 model을 읽는다.
- [x] 저장된 동의가 없거나 철회됐을 때 분석을 `CONSENT_REQUIRED`로 fail closed한다.
- [x] 기존 `--allow-upload`는 config를 쓰지 않는 현재 CLI 실행 한 번의 동의로 유지한다.
- [x] `doctor`에 다음 항목을 추가하되 자격 증명 내용은 노출하지 않는다.

  - helper config 존재/유효 여부
  - 저장된 provider/model의 현재 연결 및 image capability
  - OpenCode global plugin 등록 여부
  - 현재 전역 permission 값과 override 가능성
  - 재시작 필요 여부는 현재 안전하게 판정할 API가 없어 `unknown`으로 명시

- [x] `config show`와 `config reset-consent`를 추가한다. 동의 철회는 model/permission과
  OpenCode 등록을 보존하고 helper config의 consent만 원자적으로 `false`로 바꾼다.
- [x] 설정 및 동의 오류의 remediation 문구를 `setup` 기준으로 갱신한다.

### P1. OpenCode plugin의 저장 설정 사용

- [x] `src/plugin.ts`가 plugin option/tool argument/env에 model이 없을 때 helper 설정의
  model을 사용하도록 한다.
- [x] CLI와 plugin이 동일한 schema validator와 model resolver를 사용한다.
- [x] plugin 초기화 시 설정 파일이 없거나 손상된 경우 OpenCode 전체 시작을 깨뜨리지
  말고, tool 호출 시 안전한 `CONFIGURATION` 오류와 `setup` 안내를 반환한다.
- [x] plugin은 클라우드 동의가 없으면 permission UI 이전에 `CONSENT_REQUIRED`로
  fail closed한다.
- [x] `context.ask` 직전에 모델과 이미지가 전송된다는 metadata를 계속 제공한다.
- [x] caller capability gate, external-directory permission, attachment 처리, 모든 tool
  비활성화, 임시 세션 정리는 변경 후에도 유지한다.

### P1. 전역 설치 및 제거 lifecycle

- [x] 선택한 등록 방식에 맞춰 `setup`에서 전역 설치 함수를 호출한다.
- [x] 기본 setup은 `OPENCODE_CONFIG_DIR` 또는 `OPENCODE_CONFIG`를 암묵적으로 따르지
  않고 공식 global config
  `~/.config/opencode/opencode.json` 또는 기존 `opencode.jsonc`만 대상으로 한다.
  테스트와 library 호출에서는 명시적 config path를 주입할 수 있다.
- [x] 실제 쓰기 전에 대상 경로, 추가할 plugin entry, 권한값을 요약해 보여 준다.
- [x] 기존 설치가 정확히 같은 설정이면 idempotent 성공을 반환한다.
- [x] legacy global wrapper, 다른 permission, 중복 entry는 자동 교체하지 않고
  충돌을 보고하거나 명시 확인을 요구한다. 프로젝트별 legacy wrapper 감지와 수동
  fallback UX는 남아 있다.
- [x] 설정 저장 성공 후 OpenCode 등록이 실패하면 helper 설정이 남았음을 정확히
  알리고, config/manifest transaction에서 새로 바꾼 OpenCode config는 rollback한다.
- [ ] `OPENCODE_CONFIG_DIR` 또는 `OPENCODE_CONFIG`를 따르는 별도 opt-in이 필요한지
  공개 피드백 후 재검토한다. 현재 기본값은 공식 global config
  `~/.config/opencode/opencode.json`이다.
- [x] `unregister`와 legacy adapter uninstaller는 exact ownership을 확인해 helper가
  만든 plugin entry/wrapper/manifest만 제거한다.
- [x] `unregister` 기본 동작은 helper 설정, 선택 모델, 동의 기록을 보존한다. v1에서는
  helper config purge 옵션을 제공하지 않고 사용자가 별도로 관리하도록 결정한다.
- [x] 등록과 제거 구현 모두 OpenCode auth, 다른 plugin, agent, command, tool, project
  config를 대상에서 제외한다.
- [x] 완료 후 OpenCode 재시작 필요성과 `doctor` 검증 명령을 출력한다.

## 테스트 TODO

### 자동 테스트

- [x] setup prompt의 동의/거절, `ask`/`allow`, Go/Zen, 모델 0/1/N개, 재실행,
  취소를 모두 fake I/O로 테스트한다.
- [x] setup이 실제 이미지 분석 endpoint를 호출하지 않는다는 회귀 테스트를 둔다.
- [x] helper config의 schema, 권한, atomic write, symlink, corruption, migration,
  concurrent change 테스트를 추가한다.
- [x] JSON/JSONC 병합의 주석, trailing comma, 기존 배열/권한, Unicode,
  BOM, CRLF/LF, 충돌, 동시 변경 보존 테스트를 추가한다.
- [x] installer가 다른 OpenCode 설정과 auth sentinel을 byte-for-byte 보존하는 현재
  테스트를 유지한다.
- [x] scoped package 이름과 plugin subpath를 packed artifact consumer에서 import하고
  OpenCode fake fixture로 로드한다.
- [ ] 전역 npm 설치로 생성된 CLI shim을 Windows/macOS/Linux에서 실행한다.
- [x] 저장된 기본 모델과 명시 override 우선순위를 CLI와 native tool에서 테스트한다.
- [ ] project/agent override 때문에 global permission과 실제 permission이 다른 경우의
  안내를 테스트한다.
- [x] uninstall/upgrade가 사용자가 수정한 entry를 삭제하거나 덮어쓰지 않는지
  테스트한다.
- [x] `npm run check`, `npm test`, `npm run build`, `npm run verify:package`를 모두
  release gate로 유지한다.

### 명시 승인 후에만 수행할 live 테스트

- [ ] 실제 npm에 publish하기 전 `npm pack` tarball을 깨끗한 사용자 환경과 격리된
  HOME에서 전역 설치한다.
- [ ] 사용자가 명시적으로 승인한 synthetic image만 사용한다.
- [ ] Go와 Zen 각각에서 setup 모델 discovery와 CLI 분석을 검증한다.
- [ ] text-only caller가 `vision_analyze`를 호출하고 `ask` UI가 나타나는지 검증한다.
- [ ] 별도 격리 환경에서만 `allow` 동작을 검증한다.
- [ ] vision-capable caller가 upload/비용 발생 전에 거절되는지 검증한다.
- [ ] 분석 세션의 모든 tool deny와 성공/실패/취소 session cleanup을 검증한다.
- [ ] TUI, `opencode run`, Desktop에서 전역 플러그인 discovery를 검증한다.
- [ ] 제거 후 CLI package와 OpenCode 설정/플러그인 상태가 문서대로 남거나 제거되는지
  검증한다.

live 테스트는 현재 AGENTS.md 경계대로 매번 사용자 승인을 받아야 하며 외부 provider
호출을 기본 CI에 넣지 않는다.

## README 및 문서 TODO

- [x] README 첫 화면에 다음 Quick start를 추가한다.

```powershell
npm install -g @pawprint0706/opencode-vision-helper
opencode-vision-helper setup
opencode-vision-helper doctor
opencode-vision-helper analyze .\screen.png
```

- [x] setup 전에 OpenCode 설치와 `/connect`로 Go 또는 Zen 연결이 필요함을 설명한다.
- [x] setup 각 질문의 의미와 `ask` 권장 이유, `allow` 위험을 설명한다.
- [x] CLI 저장/1회 동의와 OpenCode native permission이 별개임을 설명한다.
- [x] config 파일 위치, model precedence, 재설정, 동의 철회, uninstall/purge 방법을
  문서화한다.
- [x] global 설정은 project/agent 설정에 의해 override될 수 있음을 설명한다.
- [x] OpenCode restart, plugin 미표시, provider 미연결, model 사라짐, JSONC 충돌,
  권한 prompt 미표시 문제의 troubleshooting을 추가한다.
- [x] 개발 checkout용 `adapter:install`과 `setup --config-only` 문서를 일반 사용자
  Quick start와 분리한다.
- [ ] README와 `docs/OPENCODE.md`의 private/unpublished 및 unscoped package 예시를
  공개 scoped package 기준으로 갱신한다.
- [ ] `docs/VALIDATION.md`에 publish된 artifact의 version, integrity/provenance,
  clean-install 결과를 기록한다.

## 릴리스 TODO

- [x] 모든 변경 후 focused test부터 실행한 뒤 다음 전체 gate를 통과시킨다.

```text
npm run check
npm test
npm run build
```

- [x] `npm pack --dry-run`과 tarball contents를 검토해 source map, test fixture,
  개인 경로, 로그, 임시 파일, credential이 포함되지 않았는지 확인한다.
- [x] tarball에서 CLI, setup, config, plugin export, install/uninstall을 검증한다.
- [ ] 최초 publish 전에 version과 changelog를 확정하고 Git tag/commit이 일치하는지
  확인한다.
- [ ] `npm publish --access public` 또는 승인된 trusted publishing workflow로
  배포한다.
- [ ] registry의 새 tarball을 cache 없는 격리 환경에서 설치해 검증한다. 로컬 checkout
  tarball 검증만으로 release 완료 처리하지 않는다.
- [ ] `npm view @pawprint0706/opencode-vision-helper`의 version, dist-tag, engines,
  repository, integrity를 확인한다.
- [ ] 실제 설치 명령과 README 명령을 그대로 복사해 end-to-end smoke test한다.
- [ ] 문제가 생기면 잘못된 version을 덮어쓰기보다 새 patch version으로 수정하고,
  심각한 경우 해당 version을 deprecate하는 절차를 따른다.

## 최종 수동 인수 시나리오

- [ ] OpenCode와 Node만 설치된 새 사용자 환경을 준비한다.
- [ ] OpenCode `/connect`로 Go 또는 Zen을 연결한다.
- [ ] npm global install 후 임의 디렉터리에서 CLI가 실행되는지 확인한다.
- [ ] setup에서 동의를 거절하면 어떤 설정/플러그인도 설치되지 않는지 확인한다.
- [ ] setup을 다시 실행해 `ask`, provider, 모델을 선택한다.
- [ ] OpenCode 재시작 후 text-only Go/Zen 모델에서 `vision_analyze`가 보이는지
  확인한다.
- [ ] synthetic image로 `ask` 승인 전에는 전송되지 않고 승인 후 결과가 오는지
  확인한다.
- [ ] CLI가 model 인자 없이 저장된 모델로 같은 synthetic image를 분석하는지
  확인한다.
- [ ] `allow`로 재설정할 때 추가 경고가 나오고 격리 환경에서 예상대로 동작하는지
  확인한다.
- [ ] setup 재실행, package patch upgrade, uninstall을 순서대로 수행해 다른 OpenCode
  config와 plugin이 보존되는지 확인한다.

이 시나리오가 세 운영체제에서 통과하고, 실제 publish artifact 검증 기록이 남아야
목표 사용자 흐름을 완료한 것으로 본다.
