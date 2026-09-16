> v0.3.0의 실제 모델 자동 진단은 [scan 사용법](AUTO_SCAN.md)을 참고하세요. 아래는 기존 체크리스트 명령의 설명입니다.

# 명령줄 사용 설명서

대상: 패키지 `0.3.0`, 판단 규칙 `0.1.0`, Node.js `22` 이상.

## 실행 방식

다운로드한 폴더에서 `node bin/preprocess-review.cjs` 뒤에 명령을 붙입니다. `npm install --global .`으로 현재 폴더를 로컬 설치한 뒤에는 같은 인자를 `preprocess-review` 뒤에 붙일 수 있습니다. 런타임에 외부 서비스나 웹 서버가 필요하지 않습니다.

```text
node bin/preprocess-review.cjs check input.json [--format text|json|md] [--out report] [--force] [--strict]
node bin/preprocess-review.cjs batch cases.json [--format text|json|csv] [--out report] [--force] [--strict]
node bin/preprocess-review.cjs template [--out case.json] [--force]
node bin/preprocess-review.cjs fingerprint path...
```

`assess`는 `check`의 별칭, `init`은 `template`의 별칭입니다. 아래 설명은 기본 명령 이름을 사용합니다. `--help` 또는 명령 뒤의 `--help`로 도움말을, `--version`으로 패키지와 규칙 버전을 확인할 수 있습니다.

## 1. 단일 사례 검토

```powershell
node bin/preprocess-review.cjs check examples/paper-mask-removal.json
node bin/preprocess-review.cjs check examples/synthetic-exact-reuse.json --format json
node bin/preprocess-review.cjs check my-change.json --format md --out review.md
```

기본 `text` 출력은 한국어로 기술적 결과와 규제 검토 결과를 따로 보여 줍니다. 결과 코드뿐 아니라 판단 이유, 누락 근거와 후속 조치를 읽어야 합니다. JSON은 다른 프로그램과 연결하거나 전체 결과를 보존할 때, Markdown은 사람이 검토하는 보고서를 보관할 때 사용합니다.

`check`는 입력 기록을 규칙과 비교합니다. 모델 추론, 평가 데이터 생성, 공격 실행 또는 원문 보고서 검증을 자동 수행하지 않습니다.

## 2. 여러 사례 처리

```powershell
node bin/preprocess-review.cjs batch examples/cases.json
node bin/preprocess-review.cjs batch examples/cases.json --format csv --out cases-summary.csv
node bin/preprocess-review.cjs batch examples/cases.json --format json --out cases-review.json
```

배치 입력은 사례 객체를 하나 이상 원소로 갖는 **최상위 JSON 배열**입니다. 빈 배열은 입력 오류로 처리합니다. 기본 형식은 `text`입니다. CSV는 요약 비교에 적합하며, 전체 근거와 입력을 보존하려면 원본 사례 JSON 및 JSON 보고서도 함께 보관합니다. CSV의 셀 구분·따옴표·수식으로 해석될 수 있는 문자열은 내보내기에서 처리합니다.

## 3. 빈 사례 생성

```powershell
node bin/preprocess-review.cjs template --out my-change.json
```

출력은 JSON입니다. 생성 직후에는 주요 항목이 `unknown`, 지문은 빈 값이므로 재사용 판단이 보류되는 것이 정상입니다. 편집기로 실제 확인한 사실과 참조 자료를 채운 다음 `check`를 실행하세요. 이름이 있는 변경 유형을 선택했다는 이유로 다른 질문에 자동으로 `yes`를 채우지 않습니다.

입력은 다음 구조를 사용합니다.

| 영역 | 핵심 내용 |
| --- | --- |
| `schemaVersion` | 입력 형식 버전 `1.0` |
| `metadata` | 사례 ID·제목·시스템·검토자·변경 요약·출처 |
| `context` | 고위험 여부, 출시·사용 개시, 이전 평가, 계획, 목적·준수 영향과 근거 참조 |
| `evidence` | 재사용하려는 평가 주장, 기존 통과 결과, 결정성·의존성·평가 범위, 변경 전후 지문 |
| `change` | 변경 유형, 보호조치·입력 집단 변화, 알려진 회귀, 시험 목록 |

대부분의 판단 질문은 `yes`, `no`, `unknown` 중 하나입니다. 누락된 삼중 상태는 `unknown`으로 정규화됩니다. 잘못된 열거 값이나 지문 형식은 입력 오류입니다. 시험 상태는 `pass`, `fail`, `not_run`, `unknown`을 구분하며 실제 실행 기록의 참조도 남깁니다.

메타데이터의 `provenance`는 `paper`, `synthetic`, `user` 중 하나입니다. 출처 값은 진위를 인증하지 않습니다. 원고 사례나 합성 사례를 편집해 내 사례로 사용한다면 `user`로 구분하고 `source`·`notes`에 원출처와 수정 내용을 남기세요.

## 4. 파일 지문 계산

```powershell
node bin/preprocess-review.cjs fingerprint model.bin evaluation-inputs.bin runtime-manifest.json
```

명령은 지정한 로컬 파일의 실제 바이트를 읽고 SHA-256을 계산합니다. 출력은 계산한 파일 경로, 바이트 수와 지문 등을 포함하는 JSON입니다. 이 명령은 계산한 값을 사례 파일에 자동 입력하거나 해당 파일의 의미를 확인하지 않습니다.

JSON의 `fingerprints.before`와 `fingerprints.after`에는 다음 여섯 항목을 기록합니다.

| 키 | 지문이 대표해야 하는 대상 |
| --- | --- |
| `model` | 해당 평가에 사용된 모델의 평가 관련 상태 |
| `inputs` | 전처리 후 평가기에 실제 전달되는 고정 검사 입력 전체 |
| `labels` | 정답과 입력 사이의 순서·대응 관계 |
| `evaluator` | 평가 계산을 정의하는 평가기 |
| `policy` | 평가 정책과 통과 기준 |
| `runtime` | 결과에 영향을 줄 수 있는 실행 조건의 명세 |

보안 평가의 `inputs`는 정상 입력만이 아니라 해당 평가의 공격·회귀 입력도 포함해야 합니다. 원시 데이터 파일의 해시만으로 전처리 이후 평가 입력의 동일성을 입증할 수 없습니다. 여러 파일이나 배열을 하나의 대상에 포함하려면 구성 항목·순서·자료형·형상·직렬화 방식을 모호하지 않게 정의해야 합니다.

`runtime-manifest.json`이라는 이름의 파일을 해시했다고 실행 환경이 완전하게 표현되는 것은 아닙니다. 하드웨어, 수치 라이브러리, 외부 상태 등 평가에 실제로 관련된 조건을 검토자가 확인해야 합니다.

지문은 64자리 16진수 SHA-256이어야 하며 대소문자는 정규화됩니다. 알 수 없거나 빈 지문 두 개를 같은 것으로 판단하지 않습니다. 도구가 비교하는 것은 **제출된 지문 문자열**입니다. `fingerprint`로 실제 계산한 값이어도 올바른 평가 파일과의 연결, 의존성의 완전성, 시험 실행과 통과는 별도 근거가 필요합니다.

여섯 지문과 결정적 계산 조건의 동일성은 명시한 **고정 평가 결과**의 재사용에 한정됩니다. 신규 입력, 미평가 공격, 운영 환경 전체의 안전성을 의미하지 않습니다.

## 5. 종료 코드와 `--strict`

| 코드 | 기본 모드 | `--strict` 모드 |
| --- | --- | --- |
| `0` | 유효한 입력에 대한 검토 실행 완료. 추가 검토가 필요해도 `0` | 기술적 `REUSE_SCOPED`와 규제 `DOCUMENTED_PATH` 또는 `OUT_OF_SCOPE`를 모두 충족 |
| `1` | 입력·파일·명령 인자 오류 | 같은 오류. 주의 상태 `2`보다 우선 |
| `2` | 사용하지 않음 | 입력은 유효하지만 위의 제한된 통과 조합을 충족하지 않아 사람이 확인할 필요가 있음 |

`--strict`는 `check`·`assess`·`batch`에서만 사용할 수 있습니다. 배치에서 `--strict`를 쓰면 모든 사례가 제한된 통과 조합을 만족해야 `0`입니다. 사례 중 입력 오류가 있으면 `1`, 입력 오류는 없지만 사람이 확인해야 하는 사례가 있으면 `2`입니다.

```powershell
node bin/preprocess-review.cjs check my-change.json --strict
$LASTEXITCODE
```

PowerShell에서 `$LASTEXITCODE`로 직전 명령의 종료 코드를 확인할 수 있습니다. `--strict`는 자동화 과정에서 검토 대상을 구분하는 옵션입니다. **종료 코드 `0`을 실제 배포 승인이나 새 적합성 평가 면제로 연결해서는 안 됩니다.**

## 6. 출력과 오류 처리

- `--out`이 없으면 표준 출력으로 결과를 보냅니다. 오류 안내는 표준 오류로 보냅니다.
- `--out`으로 지정한 파일이 이미 있으면 덮어쓰지 않습니다. 교체하려는 경우에만 `--force`를 함께 사용합니다.
- 입력 파일 자체를 출력으로 덮어쓰는 것은 `--force`가 있어도 허용하지 않습니다.
- JSON 입력은 UTF-8을 사용하며 BOM도 읽을 수 있습니다. 입력 크기는 최대 2MB입니다.
- 규칙은 모순되거나 미확인인 항목을 별도로 표시합니다. 하나의 결과 코드만 떼어 내서 전체 검토가 끝난 것으로 해석하지 마세요.

## 7. 결과의 적용 범위

기술적 `REUSE_SCOPED`는 제출된 조건에 따른 제한된 결과입니다. `HOLD`는 부족한 근거 또는 형식 오류, `RETEST_REQUIRED`는 관련 변화, `INVALIDATED`는 신고된 실패·회귀를 다룹니다. 규제 검토는 다른 축이며 어느 결과도 실질적 변경 여부를 법적으로 확정하지 않습니다.

현재 매핑은 2024년 제정 EU AI Act의 선택한 조항에 대한 연구용 대응입니다. 변경 계획이 있다는 사실만으로 예외를 적용하지 않습니다. Article 43(4)의 예정된 변경 규정은 계속 학습하는 시스템과 기술문서의 조건을 구체적으로 다룹니다. 자세한 조건과 한계는 [FRAMEWORK.md](FRAMEWORK.md), 아직 수행하지 않은 효과 검증 계획은 [RESEARCH_PROTOCOL.md](RESEARCH_PROTOCOL.md)를 참고하세요.
