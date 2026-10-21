FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1000 uragent && mkdir -p /app && chown uragent:uragent /app
WORKDIR /app
COPY --chown=uragent:uragent normalize.py /app/normalize.py
USER uragent
