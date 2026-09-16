# Preprocess Review CLI

전처리 변경 전후 모델을 실행해 **오류율·예측 변경률·공격 시험 성공률과 검사 정책의 위험 수준**을 보여 주는 터미널용 연구 도구입니다. 수치를 사람이 JSON에 옮겨 적지 않아도 됩니다.

버전 `0.3.0` · Node.js `22` 이상. 실제 모델 평가는 Python `3.10` 이상과 모델 학습 환경에 맞는 라이브러리가 필요합니다.

## 바로 체험하기

[v0.3.0 릴리스](https://github.com/wellseekogi/preprocess-review-cli/releases/tag/v0.3.0)에서 ZIP을 풀고, `package.json`이 있는 폴더에서 실행합니다.

~~~text
node bin/preprocess-review.cjs scan --demo
~~~

추가 설치 없이 합성 전처리·분류 함수를 실제 실행하는 예제입니다. 정상 오류율은 그대로지만 방어 전처리를 해제한 뒤 준비된 공격의 성공률이 올라가는 상황을 보여 줍니다. **사용자 모델 진단이나 논문 실험의 재현 결과가 아닙니다.**

## 내 모델 자동 진단

첫 지원 범위는 **scikit-learn 분류 모델 또는 전처리를 포함한 Pipeline의 joblib 파일 + 숫자 CSV**입니다. 변경 전후의 실행 가능한 경로를 두 파일로 준비하고, 평가 데이터에 정답을 포함해야 합니다. 임의 프로젝트 코드나 모든 모델 형식을 자동 해석하지는 않습니다.

모델 학습에 사용한 Python 환경에 필요한 라이브러리가 있다면 그 환경을 그대로 사용하세요. 새 평가 환경에서는 다운로드한 폴더에서 설치합니다.

~~~text
python -m pip install -r requirements-scan.txt
~~~

학습 당시와 다른 scikit-learn 버전으로 저장된 모델을 읽으려 하면 중단합니다. `--python`으로 알맞은 환경의 실행 파일을 지정할 수 있습니다. joblib은 코드를 실행할 수 있으므로 본인이 신뢰하는 모델만 사용하세요.

다음 파일을 같은 폴더에 둡니다.

- `before.joblib`: 변경 전 모델과 전처리.
- `after.joblib`: 변경 후 모델과 전처리.
- `evaluation.csv`: `id,label,특성 열들`을 갖는 정상 평가 데이터.
- `attacks.csv`(선택): `id,clean_id,attack_target,동일 특성 열들`을 갖는 준비된 공격 데이터.

~~~text
node bin/preprocess-review.cjs scan ./my-evaluation
~~~

로컬 명령으로 한 번 설치하면 프로젝트 폴더에서 아래 명령만 실행할 수 있습니다.

~~~text
npm install --global .
preprocess-review scan
~~~

다른 파일명을 쓰면 경로만 지정합니다. 측정 수치나 위험 수준을 직접 적지 않습니다.

~~~text
preprocess-review scan --before old.joblib --after new.joblib --data test.csv --attacks attacks.csv
preprocess-review scan --format json --out diagnosis.json
~~~

[입력 CSV 형식·모델 지원 범위·판정 기준](docs/AUTO_SCAN.md)을 참고하세요. 공격 데이터가 없으면 정상 성능만 측정하고 보안 위험을 낮음으로 단정하지 않습니다. 시험 데이터와 어떤 공격을 평가할지는 사용자가 선택해야 합니다.

## 결과의 의미

- **측정 비율:** 제공한 표본의 정상 오류율, 예측 변경률, 새 오류와 준비된 공격의 성공 비율.
- **위험 등급:** 관측된 악화·변화와 표본 범위에 따른 공개된 연구용 검사 규칙. 통계적으로 보정된 사고 확률이 아닙니다.
- **근거 기록:** 읽은 모델·데이터의 SHA-256, 실행 환경, 표본 수, 분모와 제외 사유를 JSON에 보관합니다.

법적 재인증 여부나 알 수 없는 공격의 성공확률을 자동 확정하지 않습니다. `--assume-iid`를 직접 지정한 경우에만 표집 가정에 조건부인 Wilson 95% 구간을 표시합니다.

## 기존 거버넌스 체크리스트

기술적 평가 근거 재사용과 규제 검토 항목을 별도로 정리하는 v0.2 명령도 유지합니다.

~~~text
node bin/preprocess-review.cjs check examples/paper-mask-removal.json
node bin/preprocess-review.cjs template --out my-change.json
~~~

`check`는 입력된 선언을 분류하며 모델 시험을 실행하지 않습니다. `scan`은 지원하는 모델 경로를 실제 실행합니다. 원고에서 옮긴 체크리스트 사례 1개, 합성 체크리스트 9개, 새 합성 실행 데모를 서로 다른 근거로 구분합니다.

## 문서

- [자동 진단 사용법](docs/AUTO_SCAN.md)
- [기존 명령·입력·종료 코드](docs/CLI.md)
- [분류체계와 2024년 EU AI Act 제정문 매핑](docs/FRAMEWORK.md)
- [후속 연구 계획](docs/RESEARCH_PROTOCOL.md)
- [다운로드와 배포 정보](docs/RELEASE.md)
- [구현 검증 기록](VALIDATION.md)

소스와 배포 파일은 [GitHub](https://github.com/wellseekogi/preprocess-review-cli)에서 제공합니다. npm 레지스트리에는 게시하지 않습니다. 라이선스 선택 전 상태 `UNLICENSED`입니다. 거버넌스 효과나 위험 등급의 현장 타당성에 대한 사용자 연구는 아직 수행하지 않았습니다.
