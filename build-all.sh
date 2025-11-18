#!/bin/bash
#
# Build all WrenAI components from source - RepairQ fork
# This includes our Oracle CTE fix in wren-core Rust code
#

set -e

echo "🏗️  Building RepairQ WrenAI from source..."
echo ""
echo "This will build:"
echo "  - wren-engine (Java legacy)"
echo "  - ibis-server (Python + Rust with Oracle CTE fix)"
echo "  - wren-ai-service (Python)"
echo "  - wren-ui (Node.js/Next.js)"
echo ""

# Change to repo root
cd "$(dirname "$0")"

# Build wren-engine (Java legacy)
echo "📦 Step 1/4: Building wren-engine (Java)..."
cd wren-engine/wren-core-legacy
./mvnw clean install -B -DskipTests -P exec-jar
WREN_VERSION=$(./mvnw --quiet help:evaluate -Dexpression=project.version -DforceStdout)
cp ./wren-server/target/wren-server-${WREN_VERSION}-executable.jar ./docker/
cd ../..
echo "✅ wren-engine built successfully"
echo ""

# Build all Docker images
echo "📦 Step 2/4: Building Docker images..."
cd docker
docker compose build --no-cache

echo ""
echo "✅ All components built successfully!"
echo ""
echo "To start the stack:"
echo "  cd docker"
echo "  docker compose up -d"
echo ""
