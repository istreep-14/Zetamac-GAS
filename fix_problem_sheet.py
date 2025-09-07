#!/usr/bin/env python3
import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional

SESSION_HEADER = "Timestamp,ClientId,URL,Duration,Score,ProblemsJson,Mode,MappedDuration,Score_120"
PROB_SHEET_HEADER = [
    "Timestamp",
    "ClientId",
    "Operation",
    "a",
    "b",
    "c",
    "Duration",
    "Score",
    "Mode",
    "MappedDuration",
    "URL",
    "ProblemIndex",
]

# Regex to parse arithmetic questions like "30 + 93", "2 × 60", "588 ÷ 7".
QUESTION_RE = re.compile(r"\s*(\d+)\s*([+\-−×xX*÷/])\s*(\d+)\s*")

OP_SYMBOL_TO_NAME = {
    "+": "add",
    "-": "sub",
    "−": "sub",  # unicode minus
    "×": "mul",
    "x": "mul",
    "X": "mul",
    "*": "mul",
    "÷": "div",
    "/": "div",
}

OP_TYPE_TO_NAME = {
    "addition": "add",
    "subtraction": "sub",
    "multiplication": "mul",
    "division": "div",
}


def parse_question(question: str) -> Optional[Tuple[str, int, int]]:
    """Parse question text like "30 + 93" into (operation, a, b).

    Returns None if it cannot be parsed.
    """
    m = QUESTION_RE.fullmatch(question)
    if not m:
        return None
    a_str, op_sym, b_str = m.group(1), m.group(2), m.group(3)
    op = OP_SYMBOL_TO_NAME.get(op_sym)
    if not op:
        return None
    try:
        a_val = int(a_str)
        b_val = int(b_str)
    except ValueError:
        return None
    return op, a_val, b_val


def extract_session_records(raw_text: str) -> List[Dict]:
    """Extract session records from custom-delimited raw text.

    Input uses a non-standard format:
    - Header line: SESSION_HEADER
    - Records separated by "<>"
    - Each record contains 5 leading CSV fields, then a JSON array (ProblemsJson), then 3 trailing fields

    Returns a list of dicts with keys:
      timestamp, client_id, url, duration, score, problems (list), mode, mapped_duration, score_120
    """
    # Normalize line breaks and collapse into a single string (some inputs may have newlines inside)
    text = raw_text.replace("\r", "")

    # Trim to the first occurrence of the known session header
    idx = text.find(SESSION_HEADER)
    if idx == -1:
        raise ValueError("Session header not found in input.")
    text = text[idx + len(SESSION_HEADER):]

    # Split records by the custom delimiter
    parts = [p.strip() for p in text.split("<>")]

    sessions: List[Dict] = []
    for rec in parts:
        if not rec:
            continue
        # Some parts might accidentally include another header occurrence; skip those
        if rec.startswith(SESSION_HEADER):
            continue

        # Find the ProblemsJson bounds
        lb = rec.find("[")
        rb = rec.rfind("]")
        if lb == -1 or rb == -1 or rb < lb:
            # Not a valid record
            continue

        prefix = rec[:lb].rstrip(", ")
        json_str = rec[lb:rb + 1]
        suffix = rec[rb + 1:].lstrip(", ")

        # Parse the five prefix CSV fields: Timestamp,ClientId,URL,Duration,Score
        prefix_fields = [f.strip() for f in prefix.split(",")]
        if len(prefix_fields) < 5:
            # malformed
            continue
        timestamp = prefix_fields[0]
        client_id = prefix_fields[1]
        url = prefix_fields[2]
        duration_str = prefix_fields[3]
        score_str = prefix_fields[4]

        # Parse ProblemsJson
        try:
            problems = json.loads(json_str)
        except json.JSONDecodeError:
            # Some inputs may contain stray characters; attempt a simple fix by removing non-ASCII quotes
            raise

        # Parse the three suffix fields: Mode,MappedDuration,Score_120
        suffix_fields = [f.strip() for f in suffix.split(",") if f.strip() != ""]
        # Some records may end abruptly; pad with empties
        while len(suffix_fields) < 3:
            suffix_fields.append("")
        mode = suffix_fields[0] if len(suffix_fields) >= 1 else ""
        mapped_duration_str = suffix_fields[1] if len(suffix_fields) >= 2 else ""
        score_120_str = suffix_fields[2] if len(suffix_fields) >= 3 else ""

        # Coerce numeric fields
        def to_int(s: str) -> Optional[int]:
            try:
                return int(s)
            except Exception:
                return None

        duration = to_int(duration_str)
        score = to_int(score_str)
        mapped_duration = to_int(mapped_duration_str)
        score_120 = to_int(score_120_str)

        sessions.append({
            "timestamp": timestamp,
            "client_id": client_id,
            "url": url,
            "duration": duration,
            "score": score,
            "problems": problems,
            "mode": mode,
            "mapped_duration": mapped_duration,
            "score_120": score_120,
        })

    return sessions


def build_problem_sheet_rows(sessions: List[Dict]) -> List[List[str]]:
    rows: List[List[str]] = []

    for session in sessions:
        timestamp = session["timestamp"]
        client_id = session["client_id"]
        url = session["url"]
        duration = session["duration"]
        score = session["score"]
        mode = session["mode"]
        mapped_duration = session["mapped_duration"]

        problems: List[Dict] = session["problems"] or []
        for idx, p in enumerate(problems, start=1):
            question = p.get("question", "")
            op_type = p.get("operationType", "")

            # Skip synthetic or unknown problems
            if op_type == "unknown" or question.startswith("final-missed-"):
                continue

            parsed = parse_question(question)
            op_name_from_sym: Optional[str] = None
            a_val: Optional[int] = None
            b_val: Optional[int] = None
            if parsed:
                op_name_from_sym, a_val, b_val = parsed

            # Prefer operationType mapping when available
            op_name: Optional[str] = OP_TYPE_TO_NAME.get(op_type)
            if not op_name and op_name_from_sym:
                op_name = op_name_from_sym

            # If we still cannot determine operation or operands, skip the row
            if not op_name or a_val is None or b_val is None:
                continue

            row = [
                str(timestamp),
                str(client_id),
                str(op_name),
                str(a_val),
                str(b_val),
                "",  # c not used for binary ops
                str(duration) if duration is not None else "",
                str(score) if score is not None else "",
                str(mode),
                str(mapped_duration) if mapped_duration is not None else "",
                str(url),
                str(idx),  # Use index within the session's ProblemsJson
            ]
            rows.append(row)

    return rows


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Fix problem sheet from session data with embedded ProblemsJson.")
    parser.add_argument("--input", required=True, help="Path to the raw session data text file")
    parser.add_argument("--output", required=True, help="Path to write the corrected problem sheet CSV")
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    raw_text = input_path.read_text(encoding="utf-8")

    try:
        sessions = extract_session_records(raw_text)
    except Exception as e:
        print(f"Failed to parse session data: {e}", file=sys.stderr)
        return 3

    rows = build_problem_sheet_rows(sessions)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(PROB_SHEET_HEADER)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))