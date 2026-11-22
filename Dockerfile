FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Hugging Face Spaces standard port is 7860
ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

CMD ["node", "server.js"]
