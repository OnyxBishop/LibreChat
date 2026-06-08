FROM node:20-bookworm-slim

# Runtimes available to skill scripts: node (base image), python3, bash.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates bash \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 skilluser

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

ENV PORT=8790 \
    SKILLS_DIR=/app/skills

RUN mkdir -p /app/skills && chown -R skilluser:skilluser /app

USER skilluser
EXPOSE 8790

CMD ["node", "server.js"]
