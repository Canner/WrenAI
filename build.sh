#!/bin/bash
#
# Build WrenAI Stack from Source - RepairQ Fork
# Includes Oracle CTE fix in Rust code
#

set -e

echo "🏗️  Building RepairQ WrenAI from source..."
echo ""
echo "This includes:"
echo "  ✓ wren-engine (Java) - legacy SQL engine"
echo "  ✓ ibis-server (Python + Rust) - WITH ORACLE CTE FIX"
echo "  ✓ wren-ai-service (Python) - AI/LLM service"  
echo "  ✓ wren-ui (Next.js) - Web interface"
echo ""

cd "$(dirname "$0")"

# Build all services
echo "📦 Building all Docker images..."
echo ""
cd docker

# Build in order (dependencies first)
echo "⚙️  Building wren-engine (Java)..."
docker compose build wren-engine

echo ""
echo "⚙️  Building ibis-server (Python + Rust with Oracle fix)..."
docker compose build ibis-server

echo ""
echo "⚙️  Building wren-ai-service (Python)..."
docker compose build wren-ai-service

echo ""
echo "⚙️  Building wren-ui (Next.js)..."
docker compose build wren-ui

echo ""
echo "✅ All services built successfully!"
echo ""
echo "🚀 To start the stack:"
echo "   cd docker"
echo "   docker compose up -d"
echo ""
echo "📊 Access WrenAI at: http://localhost:3000"
echo ""
