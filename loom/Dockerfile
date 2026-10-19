# The Loom — THREAD's Host. Build from the repository root:
#   docker build -f loom/Dockerfile -t thread-loom .
FROM node:22-alpine
WORKDIR /app
# Dependencies live in /app/node_modules so both loom/ and shared/ resolve them.
COPY loom/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY shared/ shared/
COPY loom/server.mjs loom/
ENV LOOM_DIR=/vault \
    PORT=7878 \
    HOST=0.0.0.0
RUN mkdir -p /vault && chown node:node /vault
VOLUME ["/vault"]
EXPOSE 7878
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:7878/health || exit 1
CMD ["node", "loom/server.mjs"]
