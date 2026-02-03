#!/bin/bash

# Start Scroller (combined frontend + backend)
set -e

SCROLLER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "🚀 Starting Scroller from: $SCROLLER_DIR"

# Start backend in background
echo "📡 Starting backend on port 5178..."
cd "$SCROLLER_DIR/backend"
npm install > /dev/null 2>&1
node src/index.js &
BACKEND_PID=$!
echo "✅ Backend started (PID: $BACKEND_PID)"

# Give backend a moment to start
sleep 2

# Start frontend in foreground (so tilt can monitor it)
echo "🖥️ Starting frontend on port 5177..."
cd "$SCROLLER_DIR"
npm install > /dev/null 2>&1
npm run dev -- --host

# Cleanup on exit
trap "kill $BACKEND_PID 2>/dev/null || true" EXIT
