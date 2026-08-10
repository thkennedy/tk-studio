"""Tests for the minimal YAML subset (ST-2.1 foundation; registry reuses it)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import miniyaml  # noqa: E402


class LoadTests(unittest.TestCase):
    def test_flat_mapping_with_comments(self):
        text = (
            "# header comment\n"
            "user_name: tim\n"
            "role: developer  # trailing comment\n"
            "count: 3\n"
            "ratio: 0.5\n"
            "flag: true\n"
            "empty: null\n"
        )
        self.assertEqual(miniyaml.loads(text), {
            "user_name": "tim", "role": "developer", "count": 3,
            "ratio": 0.5, "flag": True, "empty": None,
        })

    def test_nested_mapping_and_list(self):
        text = (
            "projects:\n"
            "  tk-studio:\n"
            "    root: D:/Code/tk-studio\n"
            "    labels:\n"
            "      - alpha\n"
            "      - beta\n"
        )
        self.assertEqual(miniyaml.loads(text), {
            "projects": {"tk-studio": {
                "root": "D:/Code/tk-studio", "labels": ["alpha", "beta"],
            }},
        })

    def test_quoted_strings(self):
        self.assertEqual(
            miniyaml.loads('a: "x: y # z"\nb: \'it\'\'s\'\n'),
            {"a": "x: y # z", "b": "it's"},
        )

    def test_hash_without_leading_space_not_comment(self):
        self.assertEqual(miniyaml.loads("a: value#tail\n"), {"a": "value#tail"})

    def test_apostrophes_in_plain_prose_are_literal(self):
        # ST-059 (PROP-022): a mid-word or unpaired quote never opens a
        # quoted region — the kb envelope's description failed exactly here
        # ("unterminated quote" on the possessive).
        text = (
            "description: the validator's accepted shape\n"
            "lyric: rock 'n roll all night\n"
            'aside: the "quoted" word stays  # comment goes\n'
        )
        self.assertEqual(miniyaml.loads(text), {
            "description": "the validator's accepted shape",
            "lyric": "rock 'n roll all night",
            "aside": 'the "quoted" word stays',
        })

    def test_windows_path_value(self):
        self.assertEqual(
            miniyaml.loads("vault: C:\\Users\\tim\\vault\n"),
            {"vault": "C:\\Users\\tim\\vault"},
        )

    def test_empty_document(self):
        self.assertEqual(miniyaml.loads(""), {})
        self.assertEqual(miniyaml.loads("# only comments\n\n"), {})

    def test_key_with_empty_value_is_none(self):
        self.assertEqual(miniyaml.loads("key:\n"), {"key": None})

    def test_rejects_unsupported_constructs(self):
        bad = [
            "a: {flow: map}\n",
            "a: [1, 2]\n",
            "a: &anchor v\n",
            "a: |\n  block\n",
            "- top level list\n",
            "items:\n  - key: value\n",
            "\ta: tabbed\n",
            "a: 1\na: 2\n",
            'a: "unterminated\n',
        ]
        for text in bad:
            with self.assertRaises(miniyaml.MiniYamlError, msg=text):
                miniyaml.loads(text)


class DumpTests(unittest.TestCase):
    def test_round_trip(self):
        data = {
            "user_name": "tim",
            "role": "developer",
            "nested": {"machine_id": "Tim-PC", "count": 2, "on": False},
            "labels": ["a b", "c:d", "plain"],
            "nothing": None,
        }
        self.assertEqual(miniyaml.loads(miniyaml.dumps(data)), data)

    def test_special_strings_quoted_and_stable(self):
        data = {"a": "true", "b": "3", "c": "# not comment", "d": "x: y", "e": ""}
        self.assertEqual(miniyaml.loads(miniyaml.dumps(data)), data)

    def test_windows_path_round_trip(self):
        data = {"vault": "C:\\Users\\tim\\vault", "posix": "/home/tim/vault"}
        self.assertEqual(miniyaml.loads(miniyaml.dumps(data)), data)

    def test_rejects_non_mapping_top_level(self):
        with self.assertRaises(miniyaml.MiniYamlError):
            miniyaml.dumps(["list"])  # type: ignore[arg-type]

    def test_rejects_list_of_collections(self):
        with self.assertRaises(miniyaml.MiniYamlError):
            miniyaml.dumps({"items": [{"k": "v"}]})


if __name__ == "__main__":
    unittest.main()
