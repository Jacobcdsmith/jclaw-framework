#!/bin/bash
set -e

npm install
npm install --prefix web
npm run build --prefix web
npm run build
