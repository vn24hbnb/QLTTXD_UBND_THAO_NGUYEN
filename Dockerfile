FROM node:24-alpine

WORKDIR /app

# Thiết lập môi trường sản xuất
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/qlttxd.db

# Sao chép mã nguồn
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY data/ ./data/
COPY docs/ ./docs/
COPY scripts/ ./scripts/

# Tạo thư mục dữ liệu và sao lưu
RUN mkdir -p /app/data/uploads /app/backups

# Nạp dữ liệu ban đầu
RUN node src/db/seed.js

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
