# Use official slim Python 3.12 base image
FROM python:3.12.0-slim

# -------------------------------
# System Dependencies for Poetry
# -------------------------------
# Install minimal system packages: curl (for downloading), build tools (for native extensions)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential gcc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------
# Install Poetry (Python package manager)
# -------------------------------
ENV POETRY_VERSION=1.8.2
ENV POETRY_HOME="/opt/poetry"
ENV PATH="$POETRY_HOME/bin:$PATH"
ENV POETRY_VIRTUALENVS_CREATE=false  
# Don't use virtualenvs inside the container

RUN curl -sSL https://install.python-poetry.org | python3 - \
    && ln -s $POETRY_HOME/bin/poetry /usr/local/bin/poetry

# -------------------------------
# Set working directory for app
# -------------------------------
WORKDIR /app

# -------------------------------
# Install Python dependencies via Poetry
# -------------------------------
# Copy only dependency files first to leverage Docker layer caching
COPY pyproject.toml poetry.lock ./
RUN poetry install --no-interaction --no-ansi

# -------------------------------
# Copy remaining app code
# -------------------------------
COPY . .

# -------------------------------
# Environment variables for Streamlit
# -------------------------------
ENV PYTHONUNBUFFERED=1
ENV STREAMLIT_SERVER_HEADLESS=true
ENV STREAMLIT_SERVER_PORT=8501
ENV STREAMLIT_SERVER_ENABLECORS=false

# -------------------------------
# Expose Streamlit port
# -------------------------------
EXPOSE 8501

# -------------------------------
# Default command to run the Streamlit app
# -------------------------------
CMD ["streamlit", "run", "app.py"]
