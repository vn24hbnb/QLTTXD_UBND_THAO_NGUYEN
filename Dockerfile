FROM node:24-alpine

WORKDIR /app

# Chỉ cài dependency chạy thật; sharp cần bản dựng sẵn cho musl.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/ ./src/
COPY public/ ./public/
COPY data/thao_nguyen_geo.json ./data/thao_nguyen_geo.json
COPY scripts/ ./scripts/

# Production dùng PostgreSQL/Supabase (DATABASE_URL, SUPABASE_*, TOTP_ENCRYPTION_KEY)
# truyền qua biến môi trường lúc chạy. Không nạp dữ liệu mẫu và không nhúng bí mật vào image.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
