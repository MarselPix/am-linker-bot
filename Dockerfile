# Gunakan Node.js LTS image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Salin package.json dan package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Salin seluruh kode project
COPY . .

# Expose port 7860
EXPOSE 7860

# Jalankan aplikasi
CMD ["node", "index.js"]
