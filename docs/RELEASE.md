# 다운로드·설치와 배포 정보

패키지 버전 `0.2.0` · 판단 규칙 버전 `0.1.0` · Node.js `22` 이상.

- [GitHub 저장소](https://github.com/wellseekogi/preprocess-review-cli)
- [v0.2.0 릴리스와 다운로드](https://github.com/wellseekogi/preprocess-review-cli/releases/tag/v0.2.0)
- [GitHub Actions 수동 등록용 설정](ci-workflow.yml)

## ZIP으로 실행하기

릴리스에서 `preprocess-review-cli-v0.2.0.zip`을 내려받아 압축을 풀고, `package.json`이 있는 폴더에서 터미널을 엽니다. 별도 라이브러리 설치 없이 실행할 수 있습니다.

~~~text
node bin/preprocess-review.cjs check examples/paper-mask-removal.json
node bin/preprocess-review.cjs batch examples/cases.json
node bin/preprocess-review.cjs template --out my-change.json
~~~

저장소를 복제하려면 다음 명령을 사용합니다.

~~~text
git clone https://github.com/wellseekogi/preprocess-review-cli.git
cd preprocess-review-cli
node bin/preprocess-review.cjs --help
~~~

저장소의 Code → Download ZIP은 기본 브랜치의 최신 소스를 받습니다. 같은 버전의 결과를 재현하려면 v0.2.0 릴리스 첨부 파일이나 해당 태그를 사용합니다.

## 선택적 명령 설치

다운로드한 소스 폴더에서 다음 명령을 실행하면 `preprocess-review` 명령을 사용할 수 있습니다.

~~~text
npm install --global .
preprocess-review --version
~~~

또는 릴리스의 `preprocess-review-cli-0.2.0.tgz`를 내려받고, 그 파일이 있는 폴더에서 설치합니다.

~~~text
npm install --global ./preprocess-review-cli-0.2.0.tgz
preprocess-review --version
~~~

npm 레지스트리에는 게시하지 않습니다. `package.json`의 `private: true`는 레지스트리의 우발적 게시를 막으며 로컬 설치는 허용합니다.

## 배포 검증

~~~text
npm test
npm run smoke:install
~~~

로컬 Windows, Node.js 22.17.0, npm 10.9.2에서 41개 동작 검사와 5개 설치 검사를 통과했습니다. 원격 GitHub Actions는 실행하지 않았습니다. 게시에 사용한 GitHub 연결에 `workflow` 권한이 없어 자동 검사 설정은 `docs/ci-workflow.yml`에 수동 등록용으로 제공합니다. 저장소 관리자가 이 파일을 `.github/workflows/test.yml`로 등록하면 Linux·Windows·macOS 및 Node.js 22·24 조합에서 같은 검사를 실행할 수 있습니다. 해당 환경에서 모두 통과했다는 기록은 아닙니다.

`manifest.json`은 소스 ZIP의 파일별 SHA-256 목록입니다. npm TGZ에는 저장소 전용 dotfile 일부가 포함되지 않습니다. 릴리스 첨부 `SHA256SUMS.txt`로 다운로드 파일의 바이트를 비교할 수 있습니다. 이러한 지문은 평가 근거의 진위나 외부 사전등록을 보증하지 않습니다.

## 연구 범위와 라이선스

이 도구는 입력된 근거를 분류하는 연구용 판단 지원 도구입니다. 원고에서 옮긴 사례 1개와 합성 사례 9개를 포함하며, 모델 추론이나 보안 시험을 새로 실행하지 않습니다. 소프트웨어 검사 통과는 거버넌스 효과나 법적 정확성을 입증한 사용자 연구 결과가 아닙니다.

법령 매핑은 EU AI Act의 2024년 제정문에 고정되어 있습니다. 향후 법령·지침·해석을 반영할 때는 검토한 판본과 날짜, 변경 규칙, 기존 사례에 미치는 영향을 함께 기록해야 합니다.

라이선스 선택 전 상태로 `UNLICENSED`를 표시합니다. 별도의 오픈소스 라이선스를 부여하지 않았습니다. 소스 공개와 수정·재배포 권한 부여는 다르며, 외부 자료와 인용 문헌의 권리는 별도입니다.

## 버전 관리

명령 인터페이스와 배포 구조는 패키지 버전으로, 분류 규칙과 해석은 규칙 버전으로 추적합니다. 보고서를 비교할 때 입력 스냅샷과 두 버전을 함께 보관하세요.
