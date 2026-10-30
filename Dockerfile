FROM python:3.13-slim

WORKDIR /app
COPY app.py ./
COPY public ./public

ENV DOMAIN_CHECKER_HOST=0.0.0.0
ENV DOMAIN_CHECKER_DB=/data/alarms.db
USER 1000:1000

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4)"]

CMD ["python3", "-u", "app.py"]
