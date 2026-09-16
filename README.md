# Preprocess Review CLI

전처리 변경 후 기존 평가 근거를 재사용할 수 있는지, 어떤 기술적 재시험과 규제 검토가 필요한지 정리하는 **터미널용 연구 도구**입니다. 웹 서버나 브라우저 없이 로컬 JSON을 읽고 한국어 검토 결과를 출력합니다.

패키지 버전 `0.2.0` · 판단 규칙 버전 `0.1.0` · Node.js `22` 이상.

## 바로 실행하기

[v0.2.0 릴리스](https://github.com/wellseekogi/preprocess-review-cli/releases/tag/v0.2.0)에서 `preprocess-review-cli-v0.2.0.zip`을 내려받아 압축을 푼 다음, `package.json`이 있는 폴더에서 터미널을 엽니다.

```powershell
node --version

# 원고에 보고된 패치 제거 전처리 해제 사례를 검토합니다.
node bin/preprocess-review.cjs check examples/paper-mask-removal.json

# 고정 평가의 제한적 재사용 조건을 설명하는 합성 사례입니다.
node bin/preprocess-review.cjs check examples/synthetic-exact-reuse.json

# 포함된 모든 사례를 요약합니다.
node bin/preprocess-review.cjs batch examples/cases.json
```

별도의 라이브러리를 설치할 필요가 없습니다. 기본 출력은 사람이 읽는 한국어 텍스트이며, 기술적 결과와 규제 검토 결과를 구분해서 보여 줍니다. 원고 사례는 기존 결과를 옮긴 자료이고, 합성 사례는 동작 설명용입니다. 이 명령이 모델 추론이나 보안 시험을 새로 실행하는 것은 아닙니다.
원고 예시의 실제 출력 중 일부입니다.

```text
[기술 평가]
INVALIDATED — 기존 평가 근거 무효화 — 실패 또는 회귀 확인

[규제 검토]
OUT_OF_SCOPE — 제43조(4)의 해당 경로 적용 대상 밖
```

이 예시는 원고의 실패 기록을 입력했으므로 기존 통과 근거를 재사용하지 않습니다. 출시 전 연구 사례로 입력되어 특정 규제 검토 경로 밖으로 표시되며, 일반적인 전처리 변경의 법적 면제를 뜻하지 않습니다.

## 내 사례 만들기

```powershell
node bin/preprocess-review.cjs template --out my-change.json

# 생성한 JSON에서 확인한 사실, 근거 참조와 지문을 직접 채운 뒤 실행합니다.
node bin/preprocess-review.cjs check my-change.json
node bin/preprocess-review.cjs check my-change.json --format md --out review.md
node bin/preprocess-review.cjs check my-change.json --format json --out review.json
```

빈 템플릿은 확인되지 않은 항목을 `unknown`으로 둡니다. 지문이나 근거가 부족하면 재사용을 보류합니다. 시험 하나의 통과나 모델 파일의 일치만으로 재사용을 승인하지 않습니다.

원한다면 현재 폴더를 로컬 명령으로 설치할 수 있습니다.

```powershell
npm install --global .
preprocess-review check examples/paper-mask-removal.json
```

여기서 `.`은 다운로드한 현재 폴더입니다. npm 레지스트리에 패키지를 공개한 상태가 아니므로 다운로드 없이 레지스트리 패키지명으로 설치하는 배포 방식은 제공하지 않습니다.

## 결과 읽기

| 기술적 코드 | 의미 |
| --- | --- |
| `REUSE_SCOPED` | 제출된 조건상 명시된 고정 평가 결과의 제한적 재사용 조건 충족 |
| `RETEST_REQUIRED` | 관련 평가 의존성이나 범위가 달라져 재시험 필요 |
| `HOLD` | 입력 오류 또는 근거 부족으로 판단 보류 |
| `INVALIDATED` | 회귀 또는 시험 실패가 입력되어 기존 통과 근거의 재사용 불가 |

규제 결과는 별도로 `REVIEW_REQUIRED`, `CONTEXT_REQUIRED`, `OUT_OF_SCOPE`, `DOCUMENTED_PATH`를 표시합니다. 문서화된 경로와 특정 조항 경로 밖이라는 결과는 법적 승인이나 전체 법률의 적용 제외를 뜻하지 않습니다.

## 자동화와 근거의 한계

```powershell
# 사람이 확인해야 하는 결과를 종료 코드 2로 구분합니다.
node bin/preprocess-review.cjs check my-change.json --strict

# 지정한 파일의 실제 SHA-256을 계산합니다.
node bin/preprocess-review.cjs fingerprint model.bin evaluation-inputs.bin
```

기본 모드에서는 검토 필요 결과도 정상 실행이면 종료 코드 `0`입니다. 입력·파일 오류는 `1`입니다. `--strict`는 기술적 결과가 `REUSE_SCOPED`이고 규제 결과가 `DOCUMENTED_PATH` 또는 `OUT_OF_SCOPE`일 때만 `0`, 그 외 유효한 검토 결과는 `2`로 구분합니다. **`--strict`의 `0`도 배포 허가나 법적 판정이 아닙니다.**

입력 JSON에 적은 시험 결과·지문·의존성 조건은 사용자의 선언입니다. `fingerprint`는 실제 파일 바이트를 계산하지만 해당 파일이 평가에 사용되었는지, 필요한 의존성이 빠짐없이 포함되었는지 확인하지 않습니다. 모델, 실제 검사 입력, 정답, 평가기, 정책, 실행 조건의 동일성은 명시된 고정 평가에 한해서 해석해야 합니다.

## 자세한 문서

- [명령·입력·종료 코드](docs/CLI.md)
- [분류체계·체크리스트와 법 조항 매핑](docs/FRAMEWORK.md)
- [향후 비교 평가 연구 계획](docs/RESEARCH_PROTOCOL.md)
- [다운로드·설치와 배포 정보](docs/RELEASE.md)

규제 매핑은 EU AI Act의 **2024년 제정문** Article 3(23), Article 43(4), Annex IV 2(f)를 참고한 연구용 제안입니다. 현행 법령을 자동 조회하지 않으며, 계속 학습 시스템의 예정된 변경에 관한 규정을 모든 계획된 변경의 면제로 적용하지 않습니다.

분류체계의 거버넌스 효과를 검증한 사용자 연구는 아직 없습니다. 원고의 단일 방어 기능 제거 기전, 합성 예시, 소프트웨어 동작 검사를 각각 다른 근거 수준으로 구분합니다. 소스와 다운로드 파일은 [GitHub](https://github.com/wellseekogi/preprocess-review-cli)에서 제공합니다. npm 레지스트리에는 게시하지 않습니다. 라이선스 선택 전 패키지 표시는 `UNLICENSED`입니다.
