#!/bin/bash

echo "📦 安装 Node.js 依赖..."
npm install

echo "🐍 安装 Python 依赖..."
pip3 install -r requirements.txt

echo "✅ 所有依赖安装完成"