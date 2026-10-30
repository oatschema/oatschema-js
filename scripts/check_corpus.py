# SPDX-FileCopyrightText: 2026 The OATS Authors
# SPDX-License-Identifier: Apache-2.0

r"""Check the conformance corpus against oatschema-py, the reference implementation.

Run it with uv, which installs oatschema-py in a temporary environment:

    uv run --no-project --with 'oatschema[validate]==0.8.0.1' --with 'jsonschema-rs==0.59.0' \
        python scripts/check_corpus.py

It checks every verdict in ``conformance/`` with format checks on and off, prints each disagreement,
and exits with status 1 if there is one.
"""

import copy
import json
import sys
from importlib.metadata import version
from pathlib import Path

import oatschema

CORPUS = Path(__file__).resolve().parent.parent / "conformance"


def pointer(error: oatschema.ValidationError) -> str:
    return "".join(f"/{part}" for part in error.path)


def check_case(directory: Path, case: dict) -> list[str]:
    record = json.loads((directory / case["file"]).read_bytes())
    problems = []
    for check_formats, key in ((True, "valid"), (False, "valid_without_formats")):
        actual = oatschema.is_valid(record, case["schema"], case["version"], check_formats=check_formats)
        if actual != case[key]:
            problems.append(f"{case['file']}: {key} is {case[key]}, oatschema-py says {actual}")
    expected = case.get("error")
    if expected is not None:
        errors = list(oatschema.iter_errors(record, case["schema"], case["version"]))
        outside = [e for e in errors if not (pointer(e) + "/").startswith(expected["path"] + "/")]
        if outside:
            problems.append(f"{case['file']}: also fails outside {expected['path'] or '/'}: {outside[0]}")
        if not any(expected["message"] in e.message for e in errors):
            problems.append(f"{case['file']}: no error contains {expected['message']!r}")
    return problems


def check_formats(data: dict) -> list[str]:
    problems = []
    for case in data["cases"]:
        template = data["records"][case["format"]]
        record = copy.deepcopy(template["record"])
        node = record
        for part in template["path"][:-1]:
            node = node[part]
        node[template["path"][-1]] = case["value"]
        for check_formats, expected in ((True, case["valid"]), (False, True)):
            actual = oatschema.is_valid(record, template["schema"], data["version"], check_formats=check_formats)
            if actual != expected:
                problems.append(
                    f"{case['format']} {case['value']!r} with check_formats={check_formats}: "
                    f"expected {expected}, oatschema-py says {actual}"
                )
    return problems


def main() -> int:
    problems = []
    checked = 0
    for cases_file in sorted(CORPUS.glob("*/cases.json")):
        data = json.loads(cases_file.read_text(encoding="utf-8"))
        for case in data["cases"]:
            problems.extend(check_case(cases_file.parent, case))
            checked += 1
    formats = json.loads((CORPUS / "formats.json").read_text(encoding="utf-8"))
    problems.extend(check_formats(formats))
    checked += len(formats["cases"])
    for problem in problems:
        print(problem)
    engine = f"oatschema {oatschema.__version__}, jsonschema-rs {version('jsonschema-rs')}"
    print(f"{engine}: {checked} cases, {len(problems)} disagreements")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
