FROM node:20-alpine

WORKDIR /app

# Copiar dependencias primero (para aprovechar cache de Docker)
COPY package.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

# Exponer puerto
EXPOSE 3000

# Arrancar
CMD ["node", "index.js"]
