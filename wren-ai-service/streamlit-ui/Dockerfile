# Use the official Python 3.10 slim image as base
FROM python:3.10-slim

# Set the working directory inside the container
WORKDIR /app

# Copy all project files into the container
COPY . .

# Install dependencies listed in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Set environment variables (suppress interactive prompts and configure Streamlit)
ENV PYTHONUNBUFFERED=1
ENV STREAMLIT_SERVER_HEADLESS=true
ENV STREAMLIT_SERVER_PORT=8501
ENV STREAMLIT_SERVER_ENABLECORS=false

# Expose port for Streamlit
EXPOSE 8501

# Start the Streamlit application
CMD ["streamlit", "run", "app.py"]
