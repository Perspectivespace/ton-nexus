import unittest

from pydantic import ValidationError

from app.api.wallet import AccountIn


class AccountSchemaTest(unittest.TestCase):
    def test_chain_from_tonconnect_sdk(self):
        a = AccountIn(address="0:" + "ab" * 32, chain="-239", publicKey="aa" * 32)
        self.assertEqual(a.network, "-239")
        self.assertEqual(a.model_dump()["network"], "-239")

    def test_network_still_accepted(self):
        a = AccountIn(address="0:" + "ab" * 32, network=-3)
        self.assertEqual(a.network, "-3")

    def test_network_wins_over_chain(self):
        a = AccountIn(address="0:" + "ab" * 32, network="-239", chain="-3")
        self.assertEqual(a.network, "-239")

    def test_missing_both_rejected(self):
        with self.assertRaises(ValidationError):
            AccountIn(address="0:" + "ab" * 32)


if __name__ == "__main__":
    unittest.main()
