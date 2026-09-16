#!/usr/bin/env python3
"""Run two trusted local scikit-learn models on explicitly supplied CSV rows.

Joblib loading and model prediction execute Python code. Use only model files
whose source you trust, in their compatible Python environment. This program
does not sandbox model code, install packages, download data, or modify inputs.
CSV files are limited to 50 MiB / 100,000 rows; models to 100 MiB each.
Numeric feature columns are passed in CSV order. No preprocessing is invented.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import stat
import sys
import warnings
from decimal import Decimal, InvalidOperation


MAX_CSV_BYTES = 50 * 1024 * 1024
MAX_MODEL_BYTES = 100 * 1024 * 1024
MAX_ROWS = 100_000
MAX_LABEL_LENGTH = 1024
NUMERIC_LABEL = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")


class ScanError(Exception):
    """An actionable input or execution failure, without a traceback by default."""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def short_error(value, limit=1600):
    text = str(value)
    text = re.sub(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]", " ", text)
    return text[:limit] + ("…" if len(text) > limit else "")


def dependencies():
    try:
        import joblib
        import numpy as np
        import pandas as pd
        import sklearn
        from sklearn.exceptions import InconsistentVersionWarning
    except (ImportError, ModuleNotFoundError) as error:
        raise ScanError(
            "Python 실행 의존성을 불러오지 못했습니다. 모델 학습 환경과 호환되는 "
            "numpy, pandas, scikit-learn, joblib을 설치하세요. 설치 예: "
            "python -m pip install -r requirements-scan.txt. 원인: " + short_error(error)
        ) from None
    return np, pd, sklearn, joblib, InconsistentVersionWarning


def fingerprint(filename, role, limit):
    try:
        path = Path(filename).expanduser().resolve(strict=True)
        with path.open("rb") as handle:
            before = os.fstat(handle.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise ScanError(role + ": 일반 파일만 지원합니다.")
            if before.st_size > limit:
                raise ScanError(role + ": 파일 크기가 " + str(limit // (1024 * 1024)) + " MiB 한도를 초과했습니다.")
            digest = hashlib.sha256()
            size = 0
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(chunk)
                if size > limit:
                    raise ScanError(role + ": 파일 크기 한도를 초과했습니다.")
                digest.update(chunk)
            after = os.fstat(handle.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns) or size != before.st_size:
            raise ScanError(role + ": 지문 계산 중 파일이 변경되었습니다. 안정된 복사본으로 다시 실행하세요.")
        return {"role": role, "path": str(path), "sha256": digest.hexdigest(), "bytes": size}
    except (OSError, ValueError) as error:
        raise ScanError(role + ": 파일을 읽을 수 없습니다. " + short_error(error)) from None


def verify_unchanged(artifacts):
    for artifact in artifacts:
        limit = MAX_MODEL_BYTES if artifact["role"].endswith("_model") else MAX_CSV_BYTES
        current = fingerprint(artifact["path"], artifact["role"], limit)
        if current["sha256"] != artifact["sha256"] or current["bytes"] != artifact["bytes"]:
            raise ScanError(artifact["role"] + ": 실행 중 파일 바이트가 변경되었습니다. 결과를 발행하지 않습니다.")


def scalar_label(value, where):
    if hasattr(value, "ndim") and getattr(value, "ndim") == 0 and hasattr(value, "item"):
        value = value.item()
    if value is None or not isinstance(value, (str, bool, int, float, Decimal)):
        raise ScanError(where + ": 문자열·불리언·유한한 숫자 스칼라 라벨만 지원합니다.")
    return value


def label_kind(value, where):
    value = scalar_label(value, where)
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    return "numeric"


def canonical_label(value, where, kind, from_csv=False):
    value = scalar_label(value, where)
    if kind == "string":
        if not isinstance(value, str):
            raise ScanError(where + ": 문자열 classes_와 다른 자료형의 라벨입니다.")
        if not value.strip():
            raise ScanError(where + ": 빈 문자열 라벨은 사용할 수 없습니다.")
        if len(value) > MAX_LABEL_LENGTH:
            raise ScanError(where + ": 라벨이 너무 깁니다.")
        # Text class names are exact identifiers: '01', '1', and '1.0' differ.
        return value
    if kind == "boolean":
        if from_csv and isinstance(value, str) and value in ("True", "False"):
            return value
        if not isinstance(value, bool):
            raise ScanError(where + ": 불리언 classes_에는 True 또는 False 라벨이 필요합니다.")
        return "True" if value else "False"
    if isinstance(value, bool):
        raise ScanError(where + ": 숫자 classes_에 불리언 라벨을 사용할 수 없습니다.")
    if isinstance(value, str):
        if not from_csv:
            raise ScanError(where + ": 숫자 classes_를 가진 모델은 숫자 예측 라벨을 반환해야 합니다.")
        raw = value.strip()
        if not raw or not NUMERIC_LABEL.fullmatch(raw):
            raise ScanError(where + ": 숫자 classes_와 일치하는 유한한 숫자 라벨이 필요합니다.")
    else:
        raw = str(value)
    if len(raw) > MAX_LABEL_LENGTH:
        raise ScanError(where + ": 라벨이 너무 깁니다.")
    try:
        number = Decimal(raw)
        if not number.is_finite() or not math.isfinite(float(number)):
            raise ScanError(where + ": 유한한 숫자 라벨만 지원합니다.")
        if number == 0:
            return "0"
        if abs(number.adjusted()) > MAX_LABEL_LENGTH:
            raise ScanError(where + ": 숫자 라벨 지수가 지원 범위를 벗어났습니다.")
        normalized = format(number, "f")
        if "." in normalized:
            normalized = normalized.rstrip("0").rstrip(".")
        if len(normalized) > MAX_LABEL_LENGTH:
            raise ScanError(where + ": 정규화된 숫자 라벨이 너무 깁니다.")
        return normalized
    except (InvalidOperation, OverflowError, ValueError):
        raise ScanError(where + ": 숫자 라벨을 해석할 수 없습니다.") from None

def read_csv(filename, role, pd):
    try:
        with open(filename, "r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, strict=True)
            header = next(reader, None)
            count = 0
            for row in reader:
                if not row:
                    continue
                count += 1
                if header is None or len(row) != len(header):
                    raise ScanError(role + ": CSV 행의 열 개수가 헤더와 다릅니다.")
                if count > MAX_ROWS:
                    raise ScanError(role + ": 행 수가 100,000개 한도를 초과했습니다.")
        if not header or any(not name or name != name.strip() for name in header):
            raise ScanError(role + ": 비어 있거나 앞뒤 공백이 있는 열 이름은 사용할 수 없습니다.")
        if len(header) != len(set(header)):
            raise ScanError(role + ": 중복된 열 이름이 있습니다.")
        frame = pd.read_csv(filename, dtype=str, keep_default_na=False, encoding="utf-8-sig", nrows=MAX_ROWS + 1)
        if frame.empty:
            raise ScanError(role + ": 데이터 행이 없습니다.")
        if len(frame) > MAX_ROWS:
            raise ScanError(role + ": 행 수가 100,000개 한도를 초과했습니다.")
        if list(frame.columns) != header:
            raise ScanError(role + ": CSV 열 구조를 해석할 수 없습니다.")
        return frame
    except (OSError, UnicodeError, csv.Error, ValueError, pd.errors.ParserError, pd.errors.EmptyDataError) as error:
        raise ScanError(role + ": UTF-8 CSV를 읽을 수 없습니다. " + short_error(error)) from None


def identifiers(frame, column, role, unique=True):
    if column not in frame.columns:
        raise ScanError(role + ": 필요한 식별자 열이 없습니다: " + column)
    values = [str(value).strip() for value in frame[column].tolist()]
    if any(not value for value in values):
        raise ScanError(role + ": 빈 식별자가 있습니다: " + column)
    if unique and len(values) != len(set(values)):
        raise ScanError(role + ": 중복 식별자가 있습니다: " + column)
    return values


def numeric_features(frame, names, role, np, pd):
    if not names:
        raise ScanError(role + ": 숫자 특성 열이 하나 이상 필요합니다.")
    result = frame.loc[:, names].copy()
    for name in names:
        try:
            result[name] = pd.to_numeric(result[name], errors="raise")
        except (ValueError, TypeError, OverflowError):
            raise ScanError(role + ": 숫자로 해석할 수 없는 특성 값이 있습니다. 열: " + name) from None
    try:
        if not np.isfinite(result.to_numpy(dtype=float)).all():
            raise ScanError(role + ": 비어 있거나 NaN·무한대인 특성 값이 있습니다.")
    except (ValueError, TypeError, OverflowError):
        raise ScanError(role + ": 유한한 숫자 특성만 지원합니다.") from None
    return result


def classes_for(model, role, np):
    try:
        values = getattr(model, "classes_", None)
    except Exception as error:
        raise ScanError(role + ": classes_를 읽을 수 없습니다. " + short_error(error)) from None
    if values is None:
        raise ScanError(role + ": 학습된 단일 출력 분류기의 classes_가 필요합니다. 회귀 모델과 클래스 정보를 제공하지 않는 모델은 지원하지 않습니다.")
    array = np.asarray(values, dtype=object)
    if array.ndim != 1 or len(array) == 0:
        raise ScanError(role + ": 단일 출력 분류기의 1차원 classes_만 지원합니다.")
    kinds = {label_kind(value, role + " classes_") for value in array}
    if len(kinds) != 1:
        raise ScanError(role + ": classes_에 문자열·숫자·불리언 자료형이 혼합되어 있습니다. 모호한 클래스 의미는 자동 변환하지 않습니다.")
    kind = next(iter(kinds))
    labels = [canonical_label(value, role + " classes_", kind) for value in array]
    if len(labels) != len(set(labels)):
        raise ScanError(role + ": 동일 자료형 내 클래스 라벨이 충돌합니다.")
    return {"kind": kind, "values": set(labels)}


def model_input(model, features, role, np):
    count = getattr(model, "n_features_in_", None)
    if count is not None and int(count) != len(features.columns):
        raise ScanError(role + ": 모델이 요구하는 특성 수와 CSV 특성 수가 다릅니다.")
    names = getattr(model, "feature_names_in_", None)
    if names is not None:
        expected = np.asarray(names)
        if expected.ndim != 1 or [str(name) for name in expected] != list(features.columns):
            raise ScanError(role + ": feature_names_in_와 CSV 특성 열의 이름·순서가 다릅니다. CSV 열 순서를 모델 입력과 일치시키세요.")
        return features.copy(deep=True)
    return features.to_numpy(copy=True)


def predict(model, features, role, known_classes, np):
    if not callable(getattr(model, "predict", None)):
        raise ScanError(role + ": predict 메서드가 있는 학습된 분류 모델이 필요합니다.")
    inputs = model_input(model, features, role, np)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            raw = model.predict(inputs)
        predictions = np.asarray(raw, dtype=object)
    except Exception as error:
        raise ScanError(role + ": 추론에 실패했습니다. " + short_error(error)) from None
    if predictions.ndim != 1:
        raise ScanError(role + ": predict 결과는 1차원 라벨 배열이어야 합니다.")
    if len(predictions) != len(features):
        raise ScanError(role + ": 예측 개수와 평가 행 수가 다릅니다.")
    result = [canonical_label(value, role + " 예측 " + str(index + 1), known_classes["kind"]) for index, value in enumerate(predictions)]
    if any(value not in known_classes["values"] for value in result):
        raise ScanError(role + ": classes_에 없는 예측 라벨이 있습니다.")
    return result


def load_model(filename, role, joblib, mismatch_warning):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", mismatch_warning)
            with contextlib.redirect_stdout(sys.stderr):
                return joblib.load(filename)
    except Exception as error:
        raise ScanError(role + ": 신뢰하는 모델을 호환되는 Python·패키지 환경에서 읽어야 합니다. " + short_error(error)) from None


def scan(args):
    started = utc_now()
    if any(not value or value != value.strip() for value in (args.id, args.label)):
        raise ScanError("--id와 --label에는 비어 있지 않은 정확한 열 이름을 지정하세요.")
    if len({args.id, args.label, "clean_id", "attack_target"}) != 4:
        raise ScanError("식별자·라벨·clean_id·attack_target 역할의 열 이름이 충돌합니다.")
    entries = [("baseline_model", args.before, MAX_MODEL_BYTES), ("candidate_model", args.after, MAX_MODEL_BYTES), ("clean_data", args.data, MAX_CSV_BYTES)]
    if args.attacks:
        entries.append(("attack_data", args.attacks, MAX_CSV_BYTES))
    artifacts = [fingerprint(filename, role, limit) for role, filename, limit in entries]
    paths = {item["role"]: item["path"] for item in artifacts}
    with contextlib.redirect_stdout(sys.stderr):
        np, pd, sklearn, joblib, mismatch_warning = dependencies()
        clean = read_csv(paths["clean_data"], "정상 평가 CSV", pd)
        for name in (args.id, args.label):
            if name not in clean.columns:
                raise ScanError("정상 평가 CSV: 필요한 열이 없습니다: " + name)
        names = [name for name in clean.columns if name not in (args.id, args.label)]
        if any(name in ("clean_id", "attack_target") for name in names):
            raise ScanError("특성 열 이름이 공격 메타데이터 열 이름과 충돌합니다.")
        clean_ids = identifiers(clean, args.id, "정상 평가 CSV")
        raw_labels = clean[args.label].tolist()
        clean_features = numeric_features(clean, names, "정상 평가 CSV", np, pd)
        attack_ids, clean_links, raw_targets = [], [], []
        attack_features = None
        if args.attacks:
            attacks = read_csv(paths["attack_data"], "공격 평가 CSV", pd)
            required = {args.id, "clean_id", "attack_target", *names}
            if set(attacks.columns) != required:
                raise ScanError("공격 평가 CSV: 식별자·clean_id·attack_target와 정상 평가의 동일한 특성 열만 있어야 합니다.")
            attack_ids = identifiers(attacks, args.id, "공격 평가 CSV")
            clean_links = identifiers(attacks, "clean_id", "공격 평가 CSV")
            known_ids = set(clean_ids)
            if any(value not in known_ids for value in clean_links):
                raise ScanError("공격 평가 CSV: 정상 평가에 없는 clean_id가 있습니다.")
            raw_targets = attacks["attack_target"].tolist()
            attack_features = numeric_features(attacks, names, "공격 평가 CSV", np, pd)
        baseline = load_model(paths["baseline_model"], "변경 전 모델", joblib, mismatch_warning)
        candidate = load_model(paths["candidate_model"], "변경 후 모델", joblib, mismatch_warning)
        baseline_classes = classes_for(baseline, "변경 전 모델", np)
        candidate_classes = classes_for(candidate, "변경 후 모델", np)
        if baseline_classes["kind"] != candidate_classes["kind"]:
            raise ScanError("변경 전후 모델의 classes_ 자료형이 다릅니다. 문자열·숫자·불리언 클래스 의미를 자동으로 합치지 않습니다.")
        if baseline_classes["values"] != candidate_classes["values"]:
            raise ScanError("변경 전후 모델의 classes_ 집합이 다릅니다. 클래스 의미 변경은 이 경로에서 자동 비교하지 않습니다.")
        known_classes = baseline_classes
        labels = [canonical_label(value, "정상 평가 라벨 " + str(index + 1), known_classes["kind"], from_csv=True) for index, value in enumerate(raw_labels)]
        targets = [canonical_label(value, "공격 대상 라벨 " + str(index + 1), known_classes["kind"], from_csv=True) for index, value in enumerate(raw_targets)]
        if any(value not in known_classes["values"] for value in labels):
            raise ScanError("정상 평가 라벨이 모델 classes_와 일치하지 않습니다. 라벨 의미·자료형을 확인하세요.")
        if any(value not in known_classes["values"] for value in targets):
            raise ScanError("공격 대상 라벨이 모델 classes_와 일치하지 않습니다.")
        before_clean = predict(baseline, clean_features, "변경 전 정상 평가", known_classes, np)
        after_clean = predict(candidate, clean_features, "변경 후 정상 평가", known_classes, np)
        clean_rows = [{"id": id_, "label": label, "baseline": old, "candidate": new} for id_, label, old, new in zip(clean_ids, labels, before_clean, after_clean)]
        attack_rows = []
        if attack_features is not None:
            before_attack = predict(baseline, attack_features, "변경 전 공격 평가", known_classes, np)
            after_attack = predict(candidate, attack_features, "변경 후 공격 평가", known_classes, np)
            attack_rows = [{"id": id_, "cleanId": clean_id, "target": target, "baseline": old, "candidate": new} for id_, clean_id, target, old, new in zip(attack_ids, clean_links, targets, before_attack, after_attack)]
        verify_unchanged(artifacts)
        runtime = {"python": platform.python_version(), "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__}
    return {
        "schemaVersion": 1,
        "provenance": "measured",
        "samplingAssumption": "unspecified",
        "clean": clean_rows,
        "attacks": attack_rows,
        "artifacts": artifacts,
        "runtime": runtime,
        "runMetadata": {"startedAt": started, "completedAt": utc_now()},
        "scope": {
            "evaluation": "fixed supplied rows; closed-set single-output classification; both models must provide classes_",
            "featureOrder": names,
            "classLabelKind": known_classes["kind"],
            "attacksProvided": bool(args.attacks),
            "attackSemantics": "targeted supplied attacks linked by clean_id; clean labels are inherited; no generated attacks",
            "limitations": [
                "No security measurement is inferred when attack rows are absent.",
                "File digests identify raw bytes, not semantic model identity or complete evaluation dependencies.",
                "Equal predictions on these rows do not establish safe reuse, determinism, or unseen-input safety.",
                "Sampling, acceptance thresholds, intended purpose, and regulatory applicability are not inferred.",
                "Trusted joblib model code executes in the selected Python environment without a sandbox."
            ]
        }
    }


class RunnerArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ScanError("명령 인수를 확인하세요: " + message)


def parser():
    result = RunnerArgumentParser(
        description="신뢰하는 로컬 scikit-learn 모델 두 개를 같은 숫자 CSV 행에서 실행합니다.",
        epilog="joblib은 Python 코드를 실행할 수 있습니다. 신뢰하는 모델과 호환되는 환경만 사용하세요. 입력 파일 수정·패키지 자동 설치·네트워크 접근은 수행하지 않습니다. CSV: 50 MiB/100,000행, 모델: 100 MiB."
    )
    result.add_argument("--before", required=True, help="변경 전 joblib 모델·Pipeline 파일")
    result.add_argument("--after", required=True, help="변경 후 joblib 모델·Pipeline 파일")
    result.add_argument("--data", required=True, help="식별자·정답·숫자 특성으로 구성된 정상 평가 UTF-8 CSV")
    result.add_argument("--attacks", help="선택 사항: 식별자·clean_id·attack_target·동일 특성의 공격 CSV")
    result.add_argument("--label", default="label", help="정답 열 이름 (기본: label)")
    result.add_argument("--id", default="id", help="정상·공격 표본 식별자 열 이름 (기본: id)")
    return result


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    try:
        args = parser().parse_args(argv)
        result = scan(args)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
        return 0
    except ScanError as error:
        sys.stderr.write("실행 오류: " + short_error(error) + "\n")
        return 1
    except Exception as error:
        sys.stderr.write("실행 오류: " + short_error(error) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
