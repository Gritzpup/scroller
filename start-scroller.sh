#!/bin/bash

# Start Scroller (combined frontend + backend on single port)
set -e

SCROLLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "🚀 Starting Scroller from: $SCROLLER_DIR"

cd "$SCROLLER_DIR"
npm install > /dev/null 2>&1

# Run dev server with Express + Vite
node dev-server.js
