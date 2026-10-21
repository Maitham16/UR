#!/bin/sh
set -eu
mkdir -p /logs/verifier
echo 0 > /logs/verifier/reward.txt
python3 /tests/check.py
echo 1 > /logs/verifier/reward.txt
