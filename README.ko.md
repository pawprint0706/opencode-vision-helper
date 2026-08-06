# opencode-vision-helper

**[English](README.md) · [한국어](README.ko.md)**

로컬 이미지를 검사할 수 없는 모델을 위한 OpenCode 네이티브 비전 폴백입니다.
기존 이미지 한 장을 전처리한 뒤, OpenCode SDK를 통해 이미지 입력이 가능한
OpenCode Go 또는 Zen 모델에 분석을 위임합니다.

## 상태

CLI와 네이티브 `vision_analyze` 플러그인 어댑터가 구현되어 있으며 자동화
테스트로 검증되었습니다. 합성 픽스처는 라이브 OpenCode Go·Zen 경로,
로컬/외부 경로에서 설치된 네이티브 도구를 통한 OpenCode TUI, OpenCode의 실제
메시지 파일 첨부 경로, OpenCode Desktop 파일 선택기 및 권한 UI에서도
검증되었습니다. 로컬 TUI 검증에서는 현재 OpenCode 호출자 메타데이터가
명시적으로 비전 미지원 모델을 허용하고, 업로드 전에 이미지 입력이 가능한
호출자를 거부한다는 것도 확인되었습니다. CLI 1.18.13의 헤드리스
`opencode run` 세션에서 두 동작이 모두 재현되었습니다. 비전 입력이 제한된
`opencode-go/deepseek-v4-flash` 세션은 분석을 `opencode-go/gpt-5.6-luna`에
위임했고, 강제로 지정한 `opencode-go/gpt-5.6-luna` 호출은
`CALLER_VISION_CAPABLE`로 거부되었습니다. 스코프드(scoped) 공개 패키지에는
모든 CI 실행마다 Windows, macOS, Linux에서 격리된 글로벌 CLI 심(shim) 설치
검사가 포함됩니다. 대화형 설정, 저장된 동의/모델 선택, 소유권이 추적되는
글로벌 등록도 구현되어 있습니다.

대상 흐름은 다음과 같습니다.

```text
이미지 입력이 없는 OpenCode 모델
  -> opencode-vision-helper CLI
  -> 이미지 입력이 가능한 Go 또는 Zen 모델을 사용하는 격리된 OpenCode 세션
  -> 텍스트 또는 검증된 구조화 보고서
```

인증, 모델 라우팅, 프로바이더 구성의 소유권은 OpenCode에 있습니다. 이
프로젝트는 API 키를 저장하지 않으며 임의의 프로바이더 URL을 제공하지
않습니다.

## 빠른 시작

다음 명령은 최초 레지스트리 게시 이후의 의도된 흐름입니다. 먼저 OpenCode를
설치하고 `/connect` 흐름으로 OpenCode Go 또는 Zen에 연결하세요.

```powershell
npm install -g @pawprint0706/opencode-vision-helper
opencode-vision-helper setup
opencode-vision-helper doctor
opencode-vision-helper analyze .\screen.png
```

`setup`은 클라우드 업로드 고지사항을 표시하고, `ask` 또는 `allow`를 물은 뒤,
연결된 이미지 입력 가능 모델을 선택하고, 헬퍼 설정을 저장하며, npm 플러그인
항목과 `permission.vision_analyze`만 글로벌 OpenCode 설정에 병합합니다. 설정
후 OpenCode를 다시 시작하세요. `ask`가 권장됩니다. `allow`는 더 구체적인
OpenCode 설정이 이를 재정의하지 않는 한, 이후 네이티브 도구 호출을 확인 UI
없이 허용합니다. 기존 설정을 안전하게 편집할 수 없으면 setup은 승인 후 헬퍼
설정만 저장하고 정확한 대상 경로와 병합 가능한 스니펫을 출력합니다. 사용자가
수동 병합을 확인하고, 읽기 전용 검사가 레거시 래퍼 중복 없이 정확한 패키지와
권한을 하나의 설정에서 찾을 때까지 setup은 미완료로 보고합니다.

Node.js 20 이상이 필요합니다. OpenCode 1.18.13이 테스트된 SDK/플러그인 기준
버전입니다. OpenCode를 업그레이드한 후 `doctor`를 실행하고 호환성 회귀를
보고하세요.

## CLI

```powershell
opencode-vision-helper doctor --json
opencode-vision-helper analyze .\screen.png --model opencode-go/<model-id> --allow-upload
opencode-vision-helper analyze .\screen.png --model opencode/<model-id> --prompt "Read the heading" --allow-upload
```

모델 우선순위는 `--model`, `OPENCODE_VISION_MODEL`, 그다음 `setup`이 저장한
모델 순입니다. 유효한 저장 동의가 있으면 `--allow-upload`를 반복하지 않아도
명시적 CLI `analyze` 명령이 허용됩니다. 해당 플래그는 단일 호출용 동의
경로이며 설정을 기록하지 않습니다. 기본 프롬프트는 검증된 JSON 보고서를
사용하고, `--prompt`는 프로바이더의 자유 형식 텍스트를 반환합니다.

성공 결과와 도움말은 stdout에 쓰이고 종료 코드 0을 반환합니다. 오류는 안정적인
JSON 객체로 stderr에 쓰이고 종료 코드 1을 반환합니다. `doctor`는 OpenCode
상태, 헬퍼 동의/설정 유효성, 저장된 모델의 연결 및 이미지 입력 가능 여부,
글로벌 플러그인 등록, 권한 드리프트를 보고합니다. 필요한 준비 검사 중 하나라도
실패하면 종료 코드 1을 반환합니다. 또한 현재 프로젝트의 소유권 인식 레거시
래퍼를 확인하고, 글로벌 npm 플러그인과 함께 로드되는 것을 거부합니다. 프로젝트
또는 에이전트 설정이 보고된 글로벌 권한을 여전히 재정의할 수 있으며, 안전하게
관찰할 수 없으면 재시작 필요 여부를 알 수 없음으로 보고합니다.

전체 인터페이스는 다음과 같습니다.

```text
opencode-vision-helper analyze <image> [--prompt <text>] [--model <provider/model>]
                                      [--json] [--allow-upload] [--keep-session]
                                      [--timeout <seconds>]
opencode-vision-helper doctor
opencode-vision-helper setup [--config-only]
opencode-vision-helper unregister [--json]
opencode-vision-helper config show [--json]
opencode-vision-helper config reset-consent [--json]
```

`opencode-go/<model-id>`와 `opencode/<model-id>` 모델 식별자만 범위에
포함됩니다. 분석 세션에서는 모든 OpenCode 도구와 세션 권한이 비활성화됩니다.
MCP, 화면 캡처, 데스크톱 제어, 임의의 프로바이더 URL은 v1에 포함되지 않습니다.

`config show`는 헬퍼가 소유한 동의, 권한, 모델 설정만 보고합니다.
`config reset-consent`는 동의만 `false`로 원자적으로 변경하며 선택된 모델과
권한은 유지합니다. 초기화 후 CLI 분석에는 단일 호출용 `--allow-upload` 플래그가
필요하며, 네이티브 도구는 setup을 다시 실행하기 전까지 비활성화된 채로
유지됩니다.

글로벌 npm 패키지를 제거하기 전에 `opencode-vision-helper unregister`를
실행하세요. 이 명령은 setup이 만든 소유권 매니페스트를 요구하며, 해당
매니페스트가 소유한 플러그인 항목과 권한 값만 제거합니다. 교체된 권한은 정확한
이전 JSON 값으로 복원됩니다. 관련 없는 플러그인, 설정, 자격 증명, JSONC
주석은 보존됩니다. 헬퍼 설정, 선택된 모델, 클라우드 업로드 동의는 저장된 채로
유지됩니다. 소유된 값이 변경되었거나 직접 플러그인 항목에 소유권 매니페스트가
없으면, 해당 항목의 소유권을 가져가거나 삭제하지 않고 제거를 중단합니다. 이후
OpenCode를 다시 시작하고, 원하면
`npm uninstall -g @pawprint0706/opencode-vision-helper`를 실행하세요. v1에는
purge 명령이 없습니다. 등록 해제 후 저장된 동의와 모델도 지우려면 헬퍼가
소유한 `~/.config/opencode-vision-helper/config.json` 파일을 별도로 삭제할 수
있습니다. 이 정리 과정에서 OpenCode의 설정이나 인증 파일은 절대 제거하지
마세요.

네이티브 도구는 명시적 로컬 경로를 사용하거나, `image`를 생략하면 현재
OpenCode 사용자 메시지에 첨부된 유일한 이미지를 사용합니다. 로컬/파일 URL
첨부는 정규화된 경로 권한을 따르고, base64 이미지 데이터는 임시 파일을 만들지
않고 메모리에서 정규화됩니다. 이미지를 읽기 전에 어댑터는 현재 OpenCode
메시지에서 호출 모델을 식별하고 같은 서버의 모델 메타데이터를 확인합니다.
`capabilities.input.image`가 명시적으로 `false`일 때만 실행되며, 이미지 입력이
가능한 호출자에게는 이미지를 직접 분석하라고 안내하고, 메타데이터가 없거나
검증할 수 없으면 안전하게 실패(fail closed)합니다. 네이티브 도구는 또한 현재
저장된 클라우드 업로드 동의를 요구하며, 누락되거나 오래된 동의는 이미지 읽기나
권한 프롬프트 전에 `CONSENT_REQUIRED`를 반환합니다. 클라우드 분석 직전에
도구는 선택된 모델에 대해 OpenCode의 `vision_analyze` 권한을 요청합니다.
`ask`가 권장 정책이고 `deny`는 도구가 노출되지 않도록 합니다.

분석은 기본적으로 120초 후 타임아웃됩니다. `--timeout`은 1~1800초를
허용합니다. `Ctrl+C`는 프로바이더 작업을 중단한 뒤, 헬퍼가 임시 OpenCode
세션을 중지하고 제거하려 시도합니다. 분석은 성공했지만 세션 삭제가 실패하면
결과에 보존된 세션 ID와 정리 경고가 포함됩니다. `doctor`는 같은 기본 시간
제한을 사용하고 `Ctrl+C`를 지원하지만, 이미지를 업로드하거나 유료 모델
프롬프트를 시작하지 않습니다.

## 데이터 처리 및 제한

setup과 doctor는 이미지를 업로드하거나 유료 모델 프롬프트를 시작하지 않습니다.
분석은 선택된 이미지만 읽고 로컬에서 정규화한 후, 정규화된 이미지와 프롬프트를
선택된 OpenCode Go 또는 Zen 클라우드 모델로 보냅니다. 프로바이더 요금 및 데이터
보존 정책이 적용될 수 있습니다. 헬퍼는 버전이 지정된 동의, 선택된 권한, 모델
ID만 저장하며 자격 증명의 소유자는 OpenCode입니다.

50 MiB 이하, 디코딩된 픽셀 수 8천만 이하인 PNG, JPEG, WebP 입력이 허용됩니다.
애니메이션 및 다중 페이지 이미지는 거부됩니다. 이미지는 방향이 보정되고
기본적으로 긴 변 1568픽셀로 조정된 뒤 PNG 또는 JPEG으로 인코딩됩니다. 임시
분석 세션은 최선의 노력으로 삭제되며, 정리 실패 시 세션 ID와 경고가 반환되어
호출자가 관리하는 로그에도 나타날 수 있습니다. 전송 권한이 없는 이미지나
프롬프트를 제출하지 마세요.

## 문제 해결

| 증상 | 조치 |
| --- | --- |
| Go/Zen 연결 해제됨 | OpenCode `/connect` 사용, `setup` 재실행, 그다음 `doctor --json` 실행. 헬퍼는 자격 증명을 스스로 복구하지 않습니다. |
| 저장된 모델이 사라지거나 이미지 입력 기능 상실 | `setup`을 다시 실행하고 현재 목록에 있는 이미지 입력 가능 모델을 선택하세요. |
| `vision_analyze`가 없음 | OpenCode 재시작, `doctor --json` 실행 후 보고된 글로벌 직접/프로젝트 래퍼 중복 또는 프로젝트/에이전트 재정의를 해결하세요. |
| setup이 JSONC 또는 설정 파일 두 개 모호성 보고 | 표시된 수동 폴백을 따르고, 관련 없는 설정을 보존하며, `opencode.json`/`opencode.jsonc`를 의도한 글로벌 파일 하나로 통합하세요. |
| `ask` 프롬프트가 나타나지 않음 | `config show`로 저장된 동의, `doctor`로 해석된 권한, 프로젝트/에이전트/관리형 재정의를 확인하세요. OpenCode 자동 모드는 자체 정책에 따라 승인할 수 있습니다. |
| `unregister`가 소유권 드리프트 보고 | 강제 삭제하지 마세요. 헬퍼가 소유한 값을 복원하거나 의도한 스니펫만 수동으로 검토 후 제거하세요. |

일반적인 결함은 저장소의 [이슈 트래커](https://github.com/pawprint0706/opencode-vision-helper/issues)를
사용하세요. 취약점은 공개 이슈가 아니라 [SECURITY.md](SECURITY.md)의 비공개
절차로 보고하세요.

## 개발

실사용에는 Node.js 20+와 기존 OpenCode 설치가 필요합니다.

```powershell
npm install
npm run check
npm test
npm run build
npm run verify
node .\dist\cli.js --help
```

라이브 스모크 테스트는 옵트인이며, 항상 명시적 가드와 Go 모델 하나, Zen 모델
하나가 필요합니다. 합성 픽스처를 생성하고 삭제합니다.

```powershell
npm run test:live -- --allow-live `
  --go-model opencode-go/<model-id> `
  --zen-model opencode/<model-id>
```

빌드 후 공개 npm 등록을 추가하지 않고 동의와 모델을 저장한 뒤, 현재 프로젝트에
개발 어댑터를 설치하세요.

```powershell
node .\dist\cli.js setup --config-only
npm run adapter:install -- --scope project
```

인스톨러는 자체 플러그인 래퍼와 소유권 매니페스트만 씁니다. 병합 가능한 패키지와
권한 스니펫을 출력하며 `opencode.json`, `.opencode/package.json`, OpenCode
인증은 절대 편집하지 않습니다. 의존성을 병합한 후 인스톨러가 출력한 정확한
`npm install --prefix ...` 명령을 실행하고 OpenCode를 다시 시작하세요. 소유한
어댑터 파일은 `npm run adapter:uninstall -- --scope project`로 제거합니다.
글로벌 범위와 정확한 소유권 동작은 [docs/OPENCODE.md](docs/OPENCODE.md)에
문서화되어 있습니다.

테스트는 집중된 가짜 클라이언트와, 로컬 가짜 OpenCode 서버에 대해 생성된 SDK를
모두 사용합니다. OpenCode 자격 증명을 읽거나 외부 프로바이더에 이미지를 보내지
않습니다. 프로바이더 인증의 유일한 소유자는 OpenCode로 유지됩니다.

CI는 Node.js 20과 24로 Windows, macOS, Linux에서 동일한 기본 검증을
실행합니다. 실제 아티팩트를 패킹하고 임시 컨슈머에 설치한 뒤 플러그인
내보내기를 가져오고, 컨슈머의 설정이나 인증 센티널을 변경하지 않고 설치/제거를
실행합니다. 라이브 프로바이더 테스트는 의도적으로 제외됩니다.

활성 마이그레이션 계획은 [docs/MIGRATION.md](docs/MIGRATION.md)를 참조하세요.
네이티브 도구의 어댑터 수명 주기와 권한 예시는
[docs/OPENCODE.md](docs/OPENCODE.md)를 참조하세요. 자동화된 증거와 명시적으로
승인된 라이브 릴리스 체크리스트는 [docs/VALIDATION.md](docs/VALIDATION.md)를
참조하세요. 버전, 태그, 레지스트리, 출처(provenance), 게시 후 절차는
[docs/RELEASING.md](docs/RELEASING.md)를 참조하세요.

## 출처(Provenance)

이미지 전처리 제약, 보고서 형태, 신뢰할 수 없는 이미지 경계는 MIT 라이선스
`orca-vision-helper` 프로젝트에서 파생되었습니다. 프로바이더, 자격 증명, 수명
주기 설계는 OpenCode 네이티브 아키텍처로 대체되었습니다.
