#!/bin/bash
# Double-click on a Mac: gets the latest Safar code ready and opens it in Xcode.
# Needs Xcode (Mac App Store) and Node.js (nodejs.org). Then press ▶︎ in Xcode.
set -e
cd "$(dirname "$0")"
git pull --ff-only 2>/dev/null || true
npm install
npm run sync
npx cap open ios
