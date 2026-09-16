# CLI 0.3.0 구현 검증

- Node 명령·기존 규칙·측정 모듈 검사: 68개 통과, 실패·건너뜀 0개.
- 실제 Python 모델 추론·CSV·버전·클래스 의미·파일 무결성 검사: 21개 통과, 실패·건너뜀 0개.
- 격리된 npm 패키지 설치와 설치된 scan 데모 등: 7개 통과.
- 실제 Node CLI → Python 연결: 합성 sklearn Pipeline의 공격 회귀와 동일 경로 두 사례 확인.
- 실행 환경: Windows / Node.js 22.17.0 / npm 10.9.2 / Python 3.13.5 / scikit-learn 1.9.1 / NumPy 2.1.2 / pandas 2.3.0 / joblib 1.6.0.
- 원격 CI는 실행하지 않았습니다. GitHub 연결의 workflow 권한 제한으로 설정은 수동 등록용 예제입니다.

## 재검증

~~~text
npm test
npm run smoke:install
python python/test_runner.py
~~~

Python 검사는 requirements-scan.txt의 호환 의존성을 먼저 준비해야 합니다. 의존성이 없는 실행에서 건너뛴 검사를 통과로 해석하지 마세요.

이 검증은 소프트웨어 동작과 실제 추론 연결에 관한 것입니다. 합성 데모·합성 sklearn 시험 자료는 사용자 모델의 평가 결과나 논문 실험 재현이 아닙니다. 프레임워크의 현장 효과, 위험 등급의 타당성, 실제 사고확률의 보정, 법적 정확성을 검증한 연구 결과도 아닙니다. 다른 운영체제·환경에서 실행했다고 주장하지 않습니다.

manifest.json은 소스 배포 파일의 SHA-256 목록입니다. 외부 사전등록이나 신뢰할 수 있는 타임스탬프를 의미하지 않습니다.
