FROM python:3.12.2-bookworm

RUN pip install poetry==1.7.1

WORKDIR /app

COPY pyproject.toml ./

RUN poetry install --without dev

COPY src/ src/

ENTRYPOINT [ "poetry", "run", "uvicorn", "src.__main__:app", "--host", "0.0.0.0", "--port", "80" ]