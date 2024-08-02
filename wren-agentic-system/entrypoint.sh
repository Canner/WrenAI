#!/bin/bash
set -e

# Start wren-agentic-system in the background
uvicorn src.__main__:app --host 0.0.0.0 --port $WREN_AGENTIC_SYSTEM_PORT --loop uvloop --http httptools &

# Wait for wren-ui to be responsive
echo "Waiting for wren-ui to start..."
while ! nc -z -w 5 wren-ui $WREN_UI_PORT && ! nc -z -w 5 host.docker.internal $WREN_UI_PORT; do   
    sleep 1  # wait for 1 second before check again
done

# Wait for the server to be responsive
echo "Waiting for wren-agentic-system to start..."
while ! nc -z localhost $WREN_AGENTIC_SYSTEM_PORT; do   
    sleep 1  # wait for 1 second before check again
done

echo "wren-agentic-system has started."

python -m src.force_deploy

# Bring wren-agentic-system to the foreground
wait