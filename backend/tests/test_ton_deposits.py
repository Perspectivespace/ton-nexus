"""Пополнения TON: мемо, идемпотентность.

На SQLite в памяти. Запуск из backend: python -m unittest discover -s tests
"""

import unittest

from app.services.ton_deposits import _generate_memo, _normalize_memo


class MemoTests(unittest.TestCase):
    def test_generate_format(self):
        m = _generate_memo()
        self.assertTrue(m.startswith("TN"))
        self.assertGreaterEqual(len(m), 6)

    def test_normalize_case_and_spaces(self):
        self.assertEqual(_normalize_memo("tn abc 123"), "TNABC123")
        self.assertEqual(_normalize_memo("pay TN0I1L extra"), "TN0111")
        self.assertEqual(_normalize_memo("  TNXYZ  "), "TNXYZ")
        self.assertIsNone(_normalize_memo("hello"))
        self.assertIsNone(_normalize_memo(""))


if __name__ == "__main__":
    unittest.main()
