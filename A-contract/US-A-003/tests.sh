#!/usr/bin/env bash
set -euo pipefail

echo "==> validator tests"
npm run test:validators
