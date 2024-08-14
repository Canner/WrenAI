#!/bin/bash
set -e

INTERVAL=1
TIMEOUT=60

# Wait for qdrant to be responsive
echo "Waiting for qdrant to start..."
current=0

while ! nc -z $QDRANT_HOST 6333; do
    sleep $INTERVAL
    current=$((current + INTERVAL))
    if [ $current -eq $TIMEOUT ]; then
        echo "Timeout: qdrant did not start within $TIMEOUT seconds"
        exit 1
    fi
done
echo "qdrant has started."

# Start wren-ai-service in the background
uvicorn src.__main__:app --host 0.0.0.0 --port $WREN_AI_SERVICE_PORT --loop uvloop --http httptools &

if [[ -n "$SHOULD_FORCE_DEPLOY" ]]; then

    # Wait for the server to be responsive
    echo "Waiting for wren-ai-service to start..."
    current=0

    while ! nc -z localhost $WREN_AI_SERVICE_PORT; do
        sleep $INTERVAL
        current=$((current + INTERVAL))
        if [ $current -eq $TIMEOUT ]; then
            echo "Timeout: wren-ai-service did not start within $TIMEOUT seconds"
            exit 1
        fi
    done
    echo "wren-ai-service has started."

    # Wait for wren-ui to be responsive
    echo "Waiting for wren-ui to start..."
    current=0

    while ! nc -z wren-ui $WREN_UI_PORT && ! nc -z host.docker.internal $WREN_UI_PORT; do
        sleep $INTERVAL
        current=$((current + INTERVAL))
        if [ $current -eq $TIMEOUT ]; then
            echo "Timeout: wren-ui did not start within $TIMEOUT seconds"
            exit 1
        fi
    done
    echo "wren-ui has started."

    echo "Forcing deployment..."
    python -m src.force_deploy
fi

# Bring wren-ai-service to the foreground
wait
