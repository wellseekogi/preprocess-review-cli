"""Behavioral tests for actual local inference; dependency skips stay visible."""

import csv
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "runner.py"

try:
    import joblib
    import numpy as np
    import pandas as pd
    from sklearn.dummy import DummyClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    DEPENDENCIES = True
    DEPENDENCY_REASON = ""
except ImportError as error:
    DEPENDENCIES = False
    DEPENDENCY_REASON = "Actual sklearn inference tests skipped: " + str(error)


def run_command(args, env=None):
    return subprocess.run([sys.executable, str(RUNNER), *args], capture_output=True,
                          text=True, encoding="utf-8", timeout=40, env=env)


class HelpTests(unittest.TestCase):
    def test_help_explains_trusted_local_execution_and_limits(self):
        result = run_command(["--help"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("joblib", result.stdout)
        self.assertIn("100 MiB", result.stdout)
        self.assertIn("--before", result.stdout)
        self.assertIn("--attacks", result.stdout)


@unittest.skipUnless(DEPENDENCIES, DEPENDENCY_REASON)
class InferenceTests(unittest.TestCase):
    def setUp(self):
        self.scratch = Path(tempfile.mkdtemp(prefix=".runner-test-", dir=HERE)).resolve()
        self.before = self.scratch / "before.joblib"
        self.after = self.scratch / "after.joblib"
        self.data = self.scratch / "evaluation.csv"
        self.attacks = self.scratch / "attacks.csv"
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        labels = np.array([0, 0, 1, 1])
        self.model = Pipeline([("scale", StandardScaler()), ("classifier", LogisticRegression(random_state=0))]).fit(features, labels)
        candidate = Pipeline([("scale", StandardScaler()), ("classifier", DummyClassifier(strategy="constant", constant=0))]).fit(features, labels)
        joblib.dump(self.model, self.before)
        joblib.dump(candidate, self.after)
        self.clean_header = ["id", "label", "x", "y"]
        self.clean_rows = [["001", "0.0", 0, 0], ["002", "0", 0, 1], ["003", "1", 5, 5], ["004", "1.0", 5, 6]]
        self.write_csv(self.data, self.clean_header, self.clean_rows)
        self.write_csv(self.attacks, ["id", "clean_id", "attack_target", "x", "y"], [["a1", "001", "1.0", 5, 5]])
        self.environment = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    def tearDown(self):
        resolved = self.scratch.resolve()
        self.assertEqual(resolved.parent, HERE.resolve())
        self.assertTrue(resolved.name.startswith(".runner-test-"))
        sys.modules.pop("scan_fixture_models", None)
        while str(self.scratch) in sys.path:
            sys.path.remove(str(self.scratch))
        shutil.rmtree(resolved)

    @staticmethod
    def write_csv(path, header, rows):
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(rows)

    def run_scan(self, extra=None, attacks=False):
        args = ["--before", str(self.before), "--after", str(self.after), "--data", str(self.data)]
        if attacks:
            args.extend(["--attacks", str(self.attacks)])
        if extra:
            args.extend(extra)
        return run_command(args, self.environment)

    def expect_error(self, result, text=None):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "", "Failed runs must not publish a partial report")
        self.assertNotIn("Traceback", result.stderr)
        self.assertLess(len(result.stderr), 3000)
        if text:
            self.assertIn(text, result.stderr)

    def custom_model(self, mode, target=None):
        source = '''import numpy as np
from pathlib import Path
class ModeClassifier:
    classes_ = np.array([0, 1])
    n_features_in_ = 2
    def __init__(self, mode, target=None):
        self.mode, self.target = mode, target
    def predict(self, values):
        n = len(values)
        if self.mode == "matrix": return np.zeros((n, 1))
        if self.mode == "nan": return np.full(n, np.nan)
        if self.mode == "length": return np.zeros(max(0, n-1))
        if self.mode == "unknown": return np.full(n, 99)
        if self.mode == "string_prediction": return np.full(n, "0")
        if self.mode == "mutate":
            with open(self.target, "ab") as handle: handle.write(b"\\n")
        if self.mode == "noise": print("MODEL PRINT SHOULD BE STDERR")
        return np.zeros(n)
'''
        module_path = self.scratch / "scan_fixture_models.py"
        module_path.write_text(source, encoding="utf-8")
        sys.path.insert(0, str(self.scratch))
        importlib.invalidate_caches()
        module = importlib.import_module("scan_fixture_models")
        self.environment["PYTHONPATH"] = str(self.scratch) + os.pathsep + self.environment.get("PYTHONPATH", "")
        joblib.dump(module.ModeClassifier(mode, str(target) if target else None), self.after)

    def test_actual_inference_outputs_rows_runtime_and_exact_file_fingerprints(self):
        original = {path: path.read_bytes() for path in (self.before, self.after, self.data, self.attacks)}
        result = self.run_scan(attacks=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["provenance"], "measured")
        self.assertEqual(report["samplingAssumption"], "unspecified")
        self.assertEqual([row["id"] for row in report["clean"]], ["001", "002", "003", "004"])
        self.assertEqual([row["label"] for row in report["clean"]], ["0", "0", "1", "1"])
        self.assertEqual([row["baseline"] for row in report["clean"]], ["0", "0", "1", "1"])
        self.assertEqual([row["candidate"] for row in report["clean"]], ["0", "0", "0", "0"])
        self.assertEqual(report["attacks"], [{"id": "a1", "cleanId": "001", "target": "1", "baseline": "1", "candidate": "0"}])
        self.assertEqual(set(report["runtime"]), {"python", "sklearn", "numpy", "pandas", "joblib"})
        self.assertTrue(report["runMetadata"]["startedAt"].endswith("Z"))
        self.assertTrue(report["runMetadata"]["completedAt"].endswith("Z"))
        self.assertEqual(len(report["artifacts"]), 4)
        for artifact in report["artifacts"]:
            raw = original[Path(artifact["path"])]
            self.assertEqual(artifact["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(artifact["bytes"], len(raw))
        for path, raw in original.items():
            self.assertEqual(path.read_bytes(), raw, "Runner must not modify an input")

    def test_optional_attacks_remain_unmeasured_and_custom_id_label_names_work(self):
        self.write_csv(self.data, ["sample_id", "truth", "x", "y"], self.clean_rows)
        result = self.run_scan(["--id", "sample_id", "--label", "truth"])
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["attacks"], [])
        self.assertFalse(report["scope"]["attacksProvided"])
        self.assertEqual(len(report["artifacts"]), 3)

    def test_models_without_feature_names_receive_numeric_arrays(self):
        labels = np.array([0, 0, 1, 1])
        model = LogisticRegression(random_state=0).fit(np.array([[0, 0], [0, 1], [5, 5], [5, 6]]), labels)
        joblib.dump(model, self.before)
        joblib.dump(model, self.after)
        result = self.run_scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([row["baseline"] for row in json.loads(result.stdout)["clean"]], ["0", "0", "1", "1"])

    def test_duplicate_or_empty_ids_and_labels_are_rejected(self):
        changes = [(1, 0, "001"), (0, 0, ""), (0, 1, ""), (0, 1, "null"), (0, 1, "NaN")]
        for row, column, value in changes:
            with self.subTest(row=row, column=column, value=value):
                rows = [list(values) for values in self.clean_rows]
                rows[row][column] = value
                self.write_csv(self.data, self.clean_header, rows)
                self.expect_error(self.run_scan())

    def test_nonnumeric_empty_and_infinite_features_are_rejected(self):
        for value in ["", "text", "NaN", "inf", "-Infinity"]:
            with self.subTest(value=value):
                rows = [list(values) for values in self.clean_rows]
                rows[0][2] = value
                self.write_csv(self.data, self.clean_header, rows)
                self.expect_error(self.run_scan())

    def test_duplicate_headers_empty_data_and_role_collisions_are_rejected(self):
        self.write_csv(self.data, ["id", "label", "x", "x"], self.clean_rows)
        self.expect_error(self.run_scan(), "중복")
        self.write_csv(self.data, self.clean_header, [])
        self.expect_error(self.run_scan(), "데이터 행")
        self.write_csv(self.data, self.clean_header, self.clean_rows)
        self.expect_error(self.run_scan(["--id", "label"]), "충돌")

    def test_attack_references_duplicates_and_schema_are_checked(self):
        headers = ["id", "clean_id", "attack_target", "x", "y"]
        cases = [
            [["a1", "missing", "1", 5, 5]],
            [["a1", "001", "1", 5, 5], ["a2", "001", "1", 5, 6]],
            [["a1", "001", "1", 5, 5], ["a1", "002", "1", 5, 6]],
            [["a1", "001", "", 5, 5]],
            [["a1", "001", "9", 5, 5]],
        ]
        for rows in cases:
            with self.subTest(rows=rows):
                self.write_csv(self.attacks, headers, rows)
                self.expect_error(self.run_scan(attacks=True))
        self.write_csv(self.attacks, ["id", "clean_id", "attack_target", "x", "z"], [["a1", "001", "1", 5, 5]])
        self.expect_error(self.run_scan(attacks=True), "동일한 특성")

    def test_class_set_changes_and_unknown_clean_labels_fail(self):
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        incompatible = DummyClassifier(strategy="most_frequent").fit(features, [0, 0, 2, 2])
        joblib.dump(incompatible, self.after)
        self.expect_error(self.run_scan(), "classes_")
        joblib.dump(self.model, self.after)
        rows = [list(values) for values in self.clean_rows]
        rows[0][1] = "unmapped"
        self.write_csv(self.data, self.clean_header, rows)
        self.expect_error(self.run_scan(), "라벨")

    def test_feature_name_or_order_mismatch_is_not_silently_guessed(self):
        self.write_csv(self.data, ["id", "label", "y", "x"], self.clean_rows)
        self.expect_error(self.run_scan(), "feature_names_in_")

    def test_invalid_prediction_shapes_counts_nan_and_unknown_labels_fail(self):
        for mode in ["matrix", "length", "nan", "unknown", "string_prediction"]:
            with self.subTest(mode=mode):
                self.custom_model(mode)
                self.expect_error(self.run_scan())

    def test_model_print_does_not_corrupt_machine_readable_stdout(self):
        self.custom_model("noise")
        result = self.run_scan()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(result.stdout)["clean"]), 4)
        self.assertIn("MODEL PRINT SHOULD BE STDERR", result.stderr)

    def test_input_byte_change_during_prediction_aborts_report(self):
        self.custom_model("mutate", self.data)
        self.expect_error(self.run_scan(), "바이트가 변경")

    def test_string_class_names_preserve_leading_zero_in_clean_and_attacks(self):
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        model = LogisticRegression(random_state=0).fit(features, ["01", "01", "02", "02"])
        joblib.dump(model, self.before)
        joblib.dump(model, self.after)
        rows = [["001", "01", 0, 0], ["002", "01", 0, 1], ["003", "02", 5, 5], ["004", "02", 5, 6]]
        self.write_csv(self.data, self.clean_header, rows)
        self.write_csv(self.attacks, ["id", "clean_id", "attack_target", "x", "y"], [["a1", "001", "02", 5, 5]])
        result = self.run_scan(attacks=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual([row["label"] for row in report["clean"]], ["01", "01", "02", "02"])
        self.assertEqual([row["baseline"] for row in report["clean"]], ["01", "01", "02", "02"])
        self.assertEqual([row["candidate"] for row in report["clean"]], ["01", "01", "02", "02"])
        self.assertEqual(report["attacks"][0]["target"], "02")
        self.assertEqual(report["attacks"][0]["baseline"], "02")
        self.assertEqual(report["scope"]["classLabelKind"], "string")

    def test_different_numeric_looking_string_class_sets_are_not_merged(self):
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        before = LogisticRegression(random_state=0).fit(features, ["01", "01", "02", "02"])
        after = LogisticRegression(random_state=0).fit(features, ["1", "1", "2", "2"])
        joblib.dump(before, self.before)
        joblib.dump(after, self.after)
        self.expect_error(self.run_scan(), "classes_ 집합")
        after = LogisticRegression(random_state=0).fit(features, ["1.0", "1.0", "2.0", "2.0"])
        joblib.dump(after, self.after)
        self.expect_error(self.run_scan(), "classes_ 집합")

    def test_mixed_class_types_and_before_after_type_mismatch_are_rejected(self):
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        string_model = LogisticRegression(random_state=0).fit(features, ["0", "0", "1", "1"])
        joblib.dump(string_model, self.after)
        self.expect_error(self.run_scan(), "자료형")
        self.model.named_steps["classifier"].classes_ = np.array([0, "1"], dtype=object)
        joblib.dump(self.model, self.after)
        self.expect_error(self.run_scan(), "혼합")

    def test_regression_model_is_rejected_even_when_predictions_are_integers(self):
        from sklearn.linear_model import LinearRegression
        features = pd.DataFrame({"x": [0, 0, 5, 5], "y": [0, 1, 5, 6]})
        regressor = LinearRegression().fit(features, [0, 0, 0, 0])
        joblib.dump(regressor, self.after)
        self.expect_error(self.run_scan(), "classes_")

    def test_sklearn_version_mismatch_is_an_error_not_a_warning_only(self):
        import sklearn
        raw = self.after.read_bytes()
        version = sklearn.__version__.encode("ascii")
        self.assertIn(version, raw)
        self.after.write_bytes(raw.replace(version, b"0" * len(version)))
        self.expect_error(self.run_scan(), "호환되는")

    def test_missing_python_packages_give_an_installation_hint(self):
        args = [sys.executable, "-S", str(RUNNER), "--before", str(self.before), "--after", str(self.after), "--data", str(self.data)]
        result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=20, env=self.environment)
        self.expect_error(result, "requirements-scan.txt")

    def test_malformed_row_width_and_row_limit_fail_before_model_execution(self):
        self.write_csv(self.data, self.clean_header, [["001", "0", 0, 0, "extra"]])
        self.expect_error(self.run_scan(), "열 개수")
        self.write_csv(self.data, self.clean_header, ([str(index), "0", 0, 0] for index in range(100001)))
        self.expect_error(self.run_scan(), "100,000")

    def test_corrupt_or_missing_model_gives_bounded_error_without_traceback(self):
        self.after.write_bytes(b"not a joblib model")
        self.expect_error(self.run_scan(), "모델")
        self.after.unlink()
        self.expect_error(self.run_scan(), "읽을 수 없습니다")


if __name__ == "__main__":
    unittest.main(verbosity=2)
